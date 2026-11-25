import { useSyncExternalStore } from "react";

/**
 * Whether the connected gateway is observe-only (reports features.readOnly in
 * its hello). The UI uses this to disable controls that would be rejected.
 */
let observeOnly = false;
const listeners = new Set<() => void>();

export const setObserveOnly = (next: boolean): void => {
  if (observeOnly === next) return;
  observeOnly = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useObserveOnly = (): boolean =>
  useSyncExternalStore(subscribe, () => observeOnly, () => false);
