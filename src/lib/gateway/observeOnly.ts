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
