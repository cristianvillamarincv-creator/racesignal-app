/**
 * The between-race prompt rotation: every eligible prompt is used once per cycle in random order (a shuffle without replacement), then
 * the next cycle reshuffles, and the first prompt of a new cycle is never the one that ended the previous cycle.
 *
 * The notifications are scheduled ahead of time, so a prompt is only "shown" once its scheduled moment has passed (delivery cannot be
 * guaranteed, and that is accepted). Future scheduled prompts are remembered as assignments so a reconcile never reshuffles them.
 *
 *  - `drawn`: ids drawn in the current cycle (shown ones and the ones still assigned to a future slot).
 *  - `assigned`: the ordered future slots and the prompt each carries.
 *  - `lastShown`: the most recent prompt whose slot passed (used to avoid a repeat at a cycle boundary when nothing is pending).
 *
 * Pausing (an upcoming race exists) returns the unshown assignments to the pool; resuming draws again from what is unused.
 */
export interface RotationState {
  lastShown: string | null;
  drawn: string[];
  assigned: { slot: string; id: string }[];
}

export const EMPTY_ROTATION: RotationState = { lastShown: null, drawn: [], assigned: [] };

export interface RotationInput {
  /** Prompt ids that may be used now. */
  eligibleIds: string[];
  /** The desired future slots, ascending, as local "YYYY-MM-DDTHH:mm" keys (empty while paused). */
  slots: string[];
  /** The current local minute key: a slot at or before it has passed. */
  nowKey: string;
  rng?: () => number;
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

function removeFirst(list: string[], id: string): string[] {
  const index = list.indexOf(id);
  return index === -1 ? list : [...list.slice(0, index), ...list.slice(index + 1)];
}

export function reconcileRotation(previous: RotationState, input: RotationInput): RotationState {
  const rng = input.rng ?? Math.random;
  const eligible = new Set(input.eligibleIds);
  let lastShown = previous.lastShown;
  let drawn = [...previous.drawn];
  let assigned = previous.assigned.map((entry) => ({ ...entry }));

  // 1. Advance: assigned slots whose time has passed are now "shown".
  while (assigned.length > 0 && assigned[0]!.slot <= input.nowKey) {
    lastShown = assigned.shift()!.id;
  }

  // 2. Prompts that are no longer eligible leave the rotation (and any slot they held).
  drawn = drawn.filter((id) => eligible.has(id));
  assigned = assigned.filter((entry) => eligible.has(entry.id));

  // 3. Paused (no slots): unshown assignments go back to the pool.
  if (input.slots.length === 0) {
    for (const entry of assigned) drawn = removeFirst(drawn, entry.id);
    return { lastShown, drawn, assigned: [] };
  }

  // 4. Keep the assigned order, re-seating each prompt in the (possibly changed) desired slots.
  while (assigned.length > input.slots.length) {
    const dropped = assigned.pop()!;
    drawn = removeFirst(drawn, dropped.id);
  }
  assigned = assigned.map((entry, index) => ({ slot: input.slots[index]!, id: entry.id }));

  // 5. Fill the remaining slots by drawing without replacement.
  for (let index = assigned.length; index < input.slots.length; index++) {
    let candidates = input.eligibleIds.filter((id) => !drawn.includes(id));
    if (candidates.length === 0) {
      // The cycle is complete: reshuffle, and never open the new cycle with the prompt that closed the last one.
      const previousId = drawn.length > 0 ? drawn[drawn.length - 1]! : lastShown;
      drawn = [];
      candidates = input.eligibleIds.length > 1 ? input.eligibleIds.filter((id) => id !== previousId) : [...input.eligibleIds];
    }
    if (candidates.length === 0) break;
    const id = pick(candidates, rng);
    drawn.push(id);
    assigned.push({ slot: input.slots[index]!, id });
  }

  return { lastShown, drawn, assigned };
}

export function normalizeRotation(raw: unknown): RotationState {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const assigned = Array.isArray(input.assigned)
    ? input.assigned
        .filter((entry): entry is { slot: string; id: string } => !!entry && typeof (entry as any).slot === 'string' && typeof (entry as any).id === 'string')
        .map((entry) => ({ slot: entry.slot, id: entry.id }))
    : [];
  return { lastShown: typeof input.lastShown === 'string' ? input.lastShown : null, drawn: strings(input.drawn), assigned };
}

export function sameRotation(a: RotationState, b: RotationState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
