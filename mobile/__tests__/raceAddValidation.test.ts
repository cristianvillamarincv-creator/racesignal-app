import type { Race } from '@/fixtures/races';
import { canSaveManualRace, categoryPlaceholderFor, hmsToSeconds, initialSportForManualRace } from '@/lib/manualRaceForm';

describe('initialSportForManualRace', () => {
  it('starts unselected (null) for a brand-new manual race', () => {
    expect(initialSportForManualRace(undefined)).toBeNull();
  });

  it('preserves the existing sport when editing a race', () => {
    const race = { sport: 'running' } as Race;
    expect(initialSportForManualRace(race)).toBe('running');
  });
});

describe('canSaveManualRace', () => {
  it('is false with no sport chosen, even with a valid event name', () => {
    expect(canSaveManualRace({ eventName: 'Sporting Life 10K', sport: null, isSaving: false })).toBe(false);
  });

  it('is false with an empty event name, even with a sport chosen', () => {
    expect(canSaveManualRace({ eventName: '  ', sport: 'running', isSaving: false })).toBe(false);
  });

  it('is false while a save is already in flight', () => {
    expect(canSaveManualRace({ eventName: 'Sporting Life 10K', sport: 'running', isSaving: true })).toBe(false);
  });

  it('is true once a name and a sport are both present', () => {
    expect(canSaveManualRace({ eventName: 'Sporting Life 10K', sport: 'running', isSaving: false })).toBe(true);
  });

  it('has no completed-vs-upcoming distinction — mode is not part of the save gate at all', () => {
    // canSaveManualRace's own signature has no `mode` parameter — a completed race with no finish
    // time entered is a valid, saveable state (see results/[id].tsx's own handling of exactly that
    // case), so name+sport is the entire gate regardless of Upcoming vs Already completed.
    const base = { eventName: 'Sporting Life 10K', sport: 'running' as const, isSaving: false };
    expect(canSaveManualRace(base)).toBe(true);
  });
});

describe('hmsToSeconds', () => {
  it('returns undefined when all three fields are blank (no finish time, not zero)', () => {
    expect(hmsToSeconds('', '', '')).toBeUndefined();
    expect(hmsToSeconds('  ', ' ', '')).toBeUndefined();
  });

  it('treats blank fields as zero once at least one field is filled', () => {
    expect(hmsToSeconds('', '30', '')).toBe(30 * 60);
    expect(hmsToSeconds('1', '', '')).toBe(3600);
  });

  it('computes total seconds correctly for a fully-specified time', () => {
    expect(hmsToSeconds('1', '30', '45')).toBe(1 * 3600 + 30 * 60 + 45);
  });

  it('rejects negative or non-numeric values', () => {
    expect(hmsToSeconds('-1', '0', '0')).toBeUndefined();
    expect(hmsToSeconds('abc', '0', '0')).toBeUndefined();
  });
});

describe('categoryPlaceholderFor', () => {
  it('suggests running distances for Running', () => {
    expect(categoryPlaceholderFor('running')).toBe('e.g. 5K, 10K, Half Marathon');
  });

  it('suggests triathlon distances for Triathlon', () => {
    expect(categoryPlaceholderFor('triathlon')).toBe('e.g. Sprint, Olympic, 70.3');
  });

  it('has no contextual placeholder for other sports or when unselected', () => {
    expect(categoryPlaceholderFor('cycling')).toBeUndefined();
    expect(categoryPlaceholderFor('swimming')).toBeUndefined();
    expect(categoryPlaceholderFor('duathlon')).toBeUndefined();
    expect(categoryPlaceholderFor('other')).toBeUndefined();
    expect(categoryPlaceholderFor(null)).toBeUndefined();
  });
});
