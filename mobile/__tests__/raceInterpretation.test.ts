import type { Race, RaceSplit } from '@/fixtures/races';
import { buildRaceInterpretation } from '@/lib/raceInterpretation';

/** Minimal synthetic completed race — only the fields buildRaceInterpretation actually reads. */
function completedRace(
  overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'distanceLabel'> & { finishSeconds: number; splits?: RaceSplit[] },
): Race {
  return {
    name: overrides.id,
    sport: 'triathlon',
    location: 'Test City',
    status: 'completed',
    locked: false,
    ...overrides,
    result: {
      finishSeconds: overrides.finishSeconds,
      splits: overrides.splits ?? [],
      sourceStatus: 'official_confirmed',
    },
  };
}

describe('buildRaceInterpretation', () => {
  it('returns null for a race with no result', () => {
    const race: Race = {
      id: 'r1',
      name: 'Upcoming',
      sport: 'triathlon',
      distanceLabel: '70.3',
      eventDate: '2026-06-14',
      location: 'Cambridge, MD',
      status: 'registered',
      locked: false,
    };
    expect(buildRaceInterpretation([race], race)).toBeNull();
  });

  it('returns null when the race is not the current PB for its distance', () => {
    const older = completedRace({ id: 'older', eventDate: '2025-01-01', distanceLabel: '70.3', finishSeconds: 17000 });
    const notPB = completedRace({ id: 'notPB', eventDate: '2026-06-14', distanceLabel: '70.3', finishSeconds: 18000 });
    expect(buildRaceInterpretation([older, notPB], notPB)).toBeNull();
  });

  it('returns the plain PB sentence when no discipline split is verifiably fastest', () => {
    const older = completedRace({ id: 'older', eventDate: '2025-01-01', distanceLabel: '70.3', finishSeconds: 18000 });
    const pb = completedRace({ id: 'pb', eventDate: '2026-06-14', distanceLabel: '70.3', finishSeconds: 17698 });
    expect(buildRaceInterpretation([older, pb], pb)).toBe('Your fastest 70.3 to date.');
  });

  it('names a single discipline when this exact race holds the fastest split for it', () => {
    const older = completedRace({
      id: 'older',
      eventDate: '2025-01-01',
      distanceLabel: '70.3',
      finishSeconds: 18000,
      splits: [{ label: 'Bike', elapsedSeconds: 12000 }],
    });
    const pb = completedRace({
      id: 'pb',
      eventDate: '2026-06-14',
      distanceLabel: '70.3',
      finishSeconds: 17698,
      splits: [{ label: 'Bike', elapsedSeconds: 11000 }],
    });
    expect(buildRaceInterpretation([older, pb], pb)).toBe('Your fastest 70.3 to date, with your fastest bike split.');
  });

  it('joins two disciplines with "and", never claiming more than two verified splits allow', () => {
    const older = completedRace({
      id: 'older',
      eventDate: '2025-01-01',
      distanceLabel: '70.3',
      finishSeconds: 18000,
      splits: [
        { label: 'Bike', elapsedSeconds: 12000 },
        { label: 'Run', elapsedSeconds: 8000 },
      ],
    });
    const pb = completedRace({
      id: 'pb',
      eventDate: '2026-06-14',
      distanceLabel: '70.3',
      finishSeconds: 17698,
      splits: [
        { label: 'Bike', elapsedSeconds: 11000 },
        { label: 'Run', elapsedSeconds: 7000 },
      ],
    });
    expect(buildRaceInterpretation([older, pb], pb)).toBe(
      'Your fastest 70.3 to date, with your fastest bike and run splits.',
    );
  });

  it('never credits a split that another race still holds', () => {
    const other = completedRace({
      id: 'other',
      eventDate: '2025-06-01',
      distanceLabel: '70.3',
      finishSeconds: 18500,
      splits: [{ label: 'Bike', elapsedSeconds: 10500 }],
    });
    const pb = completedRace({
      id: 'pb',
      eventDate: '2026-06-14',
      distanceLabel: '70.3',
      finishSeconds: 17698,
      splits: [{ label: 'Bike', elapsedSeconds: 11000 }],
    });
    expect(buildRaceInterpretation([other, pb], pb)).toBe('Your fastest 70.3 to date.');
  });

  it('never mentions a discipline split shared by only one race (nothing to compare against)', () => {
    const pb = completedRace({
      id: 'pb',
      eventDate: '2026-06-14',
      distanceLabel: '70.3',
      finishSeconds: 17698,
      splits: [{ label: 'Bike', elapsedSeconds: 11000 }],
    });
    expect(buildRaceInterpretation([pb], pb)).toBe('Your fastest 70.3 to date.');
  });
});
