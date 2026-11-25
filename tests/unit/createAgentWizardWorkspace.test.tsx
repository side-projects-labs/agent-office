import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCreateWizardModal } from "@/features/agents/components/AgentCreateWizardModal";
import { setRunnerOptions } from "@/lib/gateway/observeOnly";

// The avatar step (shown after "Create and continue") measures with ResizeObserver, which jsdom lacks.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  act(() => setRunnerOptions(null));
});

const renderWizard = (onCreateAgent = vi.fn<(identity: unknown) => Promise<string>>(async () => "agent-1")) => {
  render(
    <AgentCreateWizardModal
      open
      suggestedName="Helper"
      onClose={() => {}}
      onCreateAgent={onCreateAgent}
      onFinishWizard={async () => {}}
    />,
  );
  return onCreateAgent;
};

describe("create agent wizard workspace picker", () => {
  it("is hidden when the gateway offers no workspaces", () => {
    renderWizard();
    expect(screen.queryByTestId("create-agent-workspace")).toBeNull();
  });

  it("lists the offered workspaces with the default selected and sends the choice on create", async () => {
    act(() =>
      setRunnerOptions({
        workspaces: [
          { id: "web", label: "web-app" },
          { id: "api", label: "api-server" },
        ],
        defaultWorkspaceId: "api",
      }),
    );
    const onCreate = renderWizard();
    const select = screen.getByTestId("create-agent-workspace") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["web-app", "api-server"]);
    expect(select.value).toBe("api");

    fireEvent.change(select, { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ name: "Helper", workspaceId: "web" });
  });

  it("sends the default workspace when the user does not touch the picker, and nothing without a runner", async () => {
    act(() => setRunnerOptions({ workspaces: [{ id: "only", label: "only" }], defaultWorkspaceId: "only" }));
    const withRunner = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }));
    await waitFor(() => expect(withRunner).toHaveBeenCalled());
    expect(withRunner.mock.calls[0][0]).toMatchObject({ workspaceId: "only" });
    cleanup();

    act(() => setRunnerOptions(null));
    const without = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }));
    await waitFor(() => expect(without).toHaveBeenCalled());
    expect(without.mock.calls[0][0]).not.toHaveProperty("workspaceId");
  });
});
