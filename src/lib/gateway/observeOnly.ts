import { useSyncExternalStore } from "react";

/**
 * Capabilities the connected gateway reports in its hello, used to disable
 * controls it would reject.
 * - readOnly: the gateway cannot take instructions (features.readOnly).
 * - approval decisions: which Allow/Deny choices it honors
 *   (features.approvalDecisions). Unset means all of them.
 */
let observeOnly = false;
let approvalDecisions: readonly string[] | null = null;
export type RunnerWorkspace = { id: string; label: string };
export type RunnerOptions = { workspaces: RunnerWorkspace[]; defaultWorkspaceId: string | null };
let runnerOptions: RunnerOptions | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export const setObserveOnly = (next: boolean): void => {
  if (observeOnly === next) return;
  observeOnly = next;
  notify();
};

export const setApprovalDecisions = (next: readonly string[] | null | undefined): void => {
  const normalized = Array.isArray(next) ? next : null;
  if (JSON.stringify(normalized) === JSON.stringify(approvalDecisions)) return;
  approvalDecisions = normalized;
  notify();
};

export const setRunnerOptions = (next: unknown): void => {
  let normalized: RunnerOptions | null = null;
  if (next && typeof next === "object") {
    const raw = next as { workspaces?: unknown; defaultWorkspaceId?: unknown };
    const workspaces = Array.isArray(raw.workspaces)
      ? raw.workspaces.flatMap((entry): RunnerWorkspace[] => {
          const e = entry as { id?: unknown; label?: unknown };
          return typeof e?.id === "string" && e.id
            ? [{ id: e.id, label: typeof e.label === "string" && e.label ? e.label : e.id }]
            : [];
        })
      : [];
    if (workspaces.length > 0) {
      normalized = {
        workspaces,
        defaultWorkspaceId: typeof raw.defaultWorkspaceId === "string" ? raw.defaultWorkspaceId : workspaces[0].id,
      };
    }
  }
  if (JSON.stringify(normalized) === JSON.stringify(runnerOptions)) return;
  runnerOptions = normalized;
  notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useObserveOnly = (): boolean =>
  useSyncExternalStore(subscribe, () => observeOnly, () => false);

/** True unless the gateway explicitly lists decisions without "allow-always". */
export const useAllowAlwaysApproval = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => approvalDecisions === null || approvalDecisions.includes("allow-always"),
    () => true,
  );

/** Workspaces the gateway lets new avatars work in (null when it offers none). */
export const useRunnerOptions = (): RunnerOptions | null =>
  useSyncExternalStore(subscribe, () => runnerOptions, () => null);
