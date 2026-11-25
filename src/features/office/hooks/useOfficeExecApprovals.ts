import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  resolveExecApprovalAgentId,
} from "@/features/agents/approvals/execApprovalEvents";
import type { ExecApprovalDecision, PendingExecApproval } from "@/features/agents/approvals/types";
import type { AgentState } from "@/features/agents/state/store";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

/**
 * Lightweight exec-approval handling for the 3D office screen.
 *
 * The /agents screen pauses the run on an approval (chat.abort) and resends a
 * follow-up after "allow". That fits gateways that end the run at an approval.
 * Gateways that hold the tool call open while waiting (the Claude Code runner)
 * need the opposite: show the request, send the decision, touch nothing else.
 */
export const useOfficeExecApprovals = (params: { client: GatewayClient; agents: AgentState[] }) => {
  const { client, agents } = params;
  const [approvals, setApprovals] = useState<PendingExecApproval[]>([]);
  const agentsRef = useRef(agents);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    return client.onEvent((event) => {
      const requested = parseExecApprovalRequested(event);
      if (requested) {
        const agentId = resolveExecApprovalAgentId({ requested, agents: agentsRef.current });
        const approval: PendingExecApproval = {
          id: requested.id,
          agentId,
          sessionKey: requested.request.sessionKey,
          command: requested.request.command,
          cwd: requested.request.cwd,
          host: requested.request.host,
          security: requested.request.security,
          ask: requested.request.ask,
          resolvedPath: requested.request.resolvedPath,
          createdAtMs: requested.createdAtMs,
          expiresAtMs: requested.expiresAtMs,
          resolving: false,
          error: null,
        };
        setApprovals((current) =>
          current.some((entry) => entry.id === approval.id) ? current : [...current, approval],
        );
        return;
      }
      const resolved = parseExecApprovalResolved(event);
      if (resolved) {
        setApprovals((current) => current.filter((entry) => entry.id !== resolved.id));
      }
    });
  }, [client]);

  const resolve = useCallback(
    async (id: string, decision: ExecApprovalDecision) => {
      const mark = (resolving: boolean, error: string | null) =>
        setApprovals((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, resolving, error } : entry)),
        );
      mark(true, null);
      try {
        await client.call("exec.approval.resolve", { id, decision });
        setApprovals((current) => current.filter((entry) => entry.id !== id));
      } catch (err) {
        mark(false, err instanceof Error ? err.message : "Failed to resolve approval.");
      }
    },
    [client],
  );

  const forAgent = useCallback(
    (agentId: string) => approvals.filter((entry) => entry.agentId === agentId),
    [approvals],
  );

  return { approvals, resolve, forAgent };
};
