import { useSyncExternalStore } from 'react';

/**
 * A tiny registry of full-screen interruptions that other overlays must wait for (the initial paywall, the Signal consent sheet), so the
 * notification invitation never appears on top of, or in the middle of, one of them.
 */
const blockers = new Set<string>();
const listeners = new Set<() => void>();

export function setOverlayBlocked(key: string, active: boolean): void {
  const before = blockers.size;
  if (active) blockers.add(key);
  else blockers.delete(key);
  if (blockers.size !== before) listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => blockers.size > 0;

/** True while any registered overlay is showing. */
export function useOverlayBlocked(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** For tests. */
export function resetOverlayBlockers(): void {
  blockers.clear();
  listeners.forEach((listener) => listener());
}
