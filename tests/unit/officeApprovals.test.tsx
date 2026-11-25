import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PendingExecApproval } from "@/features/agents/approvals/types";
import { OfficeApprovalTray } from "@/features/office/components/OfficeApprovalTray";
import { useOfficeExecApprovals } from "@/features/office/hooks/useOfficeExecApprovals";
import { setApprovalDecisions } from "@/lib/gateway/observeOnly";

const approval = (over: Partial<PendingExecApproval> = {}): PendingExecApproval => ({
  id: "a1",
  agentId: "run-1",
  sessionKey: "agent:run-1:main",
  command: 'Write {"file_path":"/w/done.txt"}',
  cwd: "/w",
  host: null,
  security: null,
  ask: null,
  resolvedPath: null,
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 125_000,
  resolving: false,
  error: null,
  ...over,
});

afterEach(() => {
  cleanup();
  setApprovalDecisions(null);
  document.title = "";
});

describe("OfficeApprovalTray", () => {
  it("renders nothing without approvals", () => {
    render(<OfficeApprovalTray approvals={[]} agentName={() => "x"} onResolve={() => {}} />);
    expect(screen.queryByTestId("office-approval-tray")).toBeNull();
  });

  it("shows the agent, command and remaining time, and resolves with the chosen decision", () => {
    const onResolve = vi.fn();
    render(<OfficeApprovalTray approvals={[approval()]} agentName={() => "Builder"} onResolve={onResolve} />);
    expect(screen.getByText(/Builder/)).toBeInTheDocument();
    expect(screen.getByText(/done\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/2:0\d left/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Allow once/ }));
    expect(onResolve).toHaveBeenCalledWith("a1", "allow-once");
    fireEvent.click(screen.getByRole("button", { name: /Deny/ }));
    expect(onResolve).toHaveBeenLastCalledWith("a1", "deny");
  });

  it("hides Always allow when the gateway does not support it", () => {
    setApprovalDecisions(["allow-once", "deny"]);
    render(<OfficeApprovalTray approvals={[approval()]} agentName={() => "B"} onResolve={() => {}} />);
    expect(screen.queryByRole("button", { name: /Always allow/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Allow once/ })).toBeInTheDocument();
  });

  it("prefixes the tab title while approvals are pending and restores it after", () => {
    document.title = "Agent Office";
    const { rerender } = render(
      <OfficeApprovalTray approvals={[approval(), approval({ id: "a2" })]} agentName={() => "B"} onResolve={() => {}} />,
    );
    expect(document.title).toBe("(2) Approval needed · Agent Office");
    rerender(<OfficeApprovalTray approvals={[]} agentName={() => "B"} onResolve={() => {}} />);
    expect(document.title).toBe("Agent Office");
  });
});

describe("useOfficeExecApprovals", () => {
  const makeClient = () => {
    let handler: ((e: unknown) => void) | null = null;
    return {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {
          handler = null;
        };
      }),
      call: vi.fn(async () => ({})),
      emit: (e: unknown) => handler?.(e),
    };
  };
  const requested = (id: string, agentId = "run-1") => ({
    type: "event",
    event: "exec.approval.requested",
    payload: {
      id,
      request: { command: "Write x", cwd: "/w", agentId, sessionKey: `agent:${agentId}:main` },
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    },
  });

  it("adds requests, removes them when resolved by the gateway, and filters per agent", () => {
    const client = makeClient();
    const agents = [{ agentId: "run-1", sessionKey: "agent:run-1:main" }] as never;
    const { result } = renderHook(() => useOfficeExecApprovals({ client: client as never, agents }));

    act(() => client.emit(requested("a1")));
    act(() => client.emit(requested("a2", "other")));
    expect(result.current.approvals.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(result.current.forAgent("run-1").map((a) => a.id)).toEqual(["a1"]);

    act(() => client.emit({ type: "event", event: "exec.approval.resolved", payload: { id: "a1", decision: "deny", ts: Date.now() } }));
    expect(result.current.approvals.map((a) => a.id)).toEqual(["a2"]);
  });

  it("sends the decision through exec.approval.resolve and keeps the card with an error on failure", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useOfficeExecApprovals({ client: client as never, agents: [] as never }));
    act(() => client.emit(requested("a1")));

    await act(async () => {
      await result.current.resolve("a1", "allow-once");
    });
    expect(client.call).toHaveBeenCalledWith("exec.approval.resolve", { id: "a1", decision: "allow-once" });
    expect(result.current.approvals).toHaveLength(0);

    act(() => client.emit(requested("a3")));
    client.call.mockRejectedValueOnce(new Error("gateway down"));
    await act(async () => {
      await result.current.resolve("a3", "deny");
    });
    expect(result.current.approvals[0]).toMatchObject({ id: "a3", resolving: false, error: "gateway down" });
  });
});
