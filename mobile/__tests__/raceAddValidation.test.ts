import type { Race } from '@/fixtures/races';
import { canSaveManualRace, categoryPlaceholderFor, initialSportForManualRace } from '@/lib/manualRaceForm';

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
