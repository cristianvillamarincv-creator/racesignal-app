import { EMPTY_ROTATION, reconcileRotation, type RotationState } from '@/lib/notifications/rotation';

/** Shuffle without replacement, no repeat across a cycle boundary, persisted assignments, pause and resume. */

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
// Weekly slots as simple ascending keys.
const weekly = (count: number) => Array.from({ length: count }, (_, i) => `2026-${String(10 + Math.floor((i * 7 + 10) / 30)).padStart(2, '0')}-${String(((i * 7 + 10) % 30) + 1).padStart(2, '0')}T16:00`);
const NOW_BEFORE = '2026-10-07T10:00';

const ids = (state: RotationState) => state.assigned.map((a) => a.id);

describe('shuffle without replacement', () => {
  it('uses every eligible prompt once before any repeats', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const state = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(6), nowKey: NOW_BEFORE, rng: seeded(seed) });
      expect([...ids(state)].sort()).toEqual([...IDS].sort());
    }
  });

  it('reshuffles after a complete cycle and never repeats a prompt across the cycle boundary', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(8), nowKey: NOW_BEFORE, rng: seeded(seed) });
      const sequence = ids(state);
      expect(sequence).toHaveLength(8);
      expect([...sequence.slice(0, 6)].sort()).toEqual([...IDS].sort()); // the first cycle is complete
      expect(sequence[6]).not.toBe(sequence[5]); // the new cycle does not open with the prompt that closed the last
      expect(sequence[7]).not.toBe(sequence[6]);
    }
  });

  it('keeps going across several cycles with no adjacent repeat', () => {
    const state = reconcileRotation(EMPTY_ROTATION, { eligibleIds: ['a', 'b', 'c'], slots: weekly(8), nowKey: NOW_BEFORE, rng: seeded(7) });
    const sequence = ids(state);
    for (let i = 1; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 1]);
    expect(new Set(sequence.slice(0, 3)).size).toBe(3);
    expect(new Set(sequence.slice(3, 6)).size).toBe(3);
  });

  it('with a single eligible prompt a repeat is unavoidable but still allowed', () => {
    const state = reconcileRotation(EMPTY_ROTATION, { eligibleIds: ['only'], slots: weekly(3), nowKey: NOW_BEFORE, rng: seeded(1) });
    expect(ids(state)).toEqual(['only', 'only', 'only']);
  });
});

describe('persisted assignments', () => {
  it('never reshuffles prompts that are already scheduled', () => {
    const first = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(6), nowKey: NOW_BEFORE, rng: seeded(3) });
    const again = reconcileRotation(first, { eligibleIds: IDS, slots: weekly(8), nowKey: '2026-10-08T09:00', rng: seeded(99) });
    expect(ids(again).slice(0, 6)).toEqual(ids(first));
    expect(again.assigned.slice(0, 6).map((a) => a.slot)).toEqual(first.assigned.map((a) => a.slot));
  });

  it('future scheduled prompts do not count as shown; passed slots advance the rotation', () => {
    const first = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(6), nowKey: NOW_BEFORE, rng: seeded(5) });
    expect(first.lastShown).toBeNull();
    const firstSlot = first.assigned[0]!.slot;
    const after = reconcileRotation(first, { eligibleIds: IDS, slots: weekly(6).slice(1), nowKey: firstSlot, rng: seeded(5) });
    expect(after.lastShown).toBe(first.assigned[0]!.id);
    expect(ids(after).slice(0, 5)).toEqual(ids(first).slice(1));
    // The new cycle's first draw is not the prompt that was just shown or the one that closed the previous cycle.
    expect(ids(after)[5]).not.toBe(ids(first)[5]);
  });

  it('re-seats the same prompts, in order, when the day or time changes', () => {
    const first = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(6), nowKey: NOW_BEFORE, rng: seeded(11) });
    const moved = weekly(6).map((slot) => slot.replace('T16:00', 'T09:30'));
    const changed = reconcileRotation(first, { eligibleIds: IDS, slots: moved, nowKey: NOW_BEFORE, rng: seeded(12) });
    expect(ids(changed)).toEqual(ids(first));
    expect(changed.assigned.map((a) => a.slot)).toEqual(moved);
  });
});

describe('pause and resume', () => {
  it('pausing (no slots) returns unshown prompts to the pool and keeps what was already shown', () => {
    const first = reconcileRotation(EMPTY_ROTATION, { eligibleIds: IDS, slots: weekly(6), nowKey: NOW_BEFORE, rng: seeded(21) });
    const slot0 = first.assigned[0]!.slot;
    const slot1 = first.assigned[1]!.slot;
    // Two slots have passed, then an upcoming race pauses the rotation.
    const paused = reconcileRotation(first, { eligibleIds: IDS, slots: [], nowKey: slot1, rng: seeded(22) });
    expect(paused.assigned).toEqual([]);
    expect(paused.lastShown).toBe(first.assigned[1]!.id);
    expect(paused.drawn.sort()).toEqual([first.assigned[0]!.id, first.assigned[1]!.id].sort()); // only the shown ones stay drawn
    expect(slot0 < slot1).toBe(true);
    // Resuming draws from the unused prompts first, and does not open with a prompt already used in this cycle.
    const resumed = reconcileRotation(paused, { eligibleIds: IDS, slots: weekly(6).slice(2), nowKey: slot1, rng: seeded(23) });
    const used = new Set([first.assigned[0]!.id, first.assigned[1]!.id]);
    for (const entry of resumed.assigned.slice(0, 4)) expect(used.has(entry.id)).toBe(false);
    expect(new Set(ids(resumed).slice(0, 4)).size).toBe(4);
  });
});

describe('eligibility changes', () => {
  it('drops prompts that stop being eligible, and adds ones that become eligible to the pool', () => {
    const forward = ['a', 'b', 'c'];
    const first = reconcileRotation(EMPTY_ROTATION, { eligibleIds: forward, slots: weekly(3), nowKey: NOW_BEFORE, rng: seeded(4) });
    const grown = reconcileRotation(first, { eligibleIds: ['a', 'b', 'c', 'd', 'e'], slots: weekly(5), nowKey: NOW_BEFORE, rng: seeded(5) });
    expect(ids(grown).slice(0, 3)).toEqual(ids(first)); // existing assignments untouched
    expect(new Set(ids(grown)).size).toBe(5);
    const shrunk = reconcileRotation(grown, { eligibleIds: ['a', 'b', 'c'], slots: weekly(5), nowKey: NOW_BEFORE, rng: seeded(6) });
    for (const id of ids(shrunk)) expect(['a', 'b', 'c']).toContain(id);
  });
});
