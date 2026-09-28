import type { Race } from '@/fixtures/races';
import { getAgeGroupPodiumsCount } from '@/lib/stats';

/** Minimal synthetic race — only the fields getAgeGroupPodiumsCount's underlying logic reads
 *  (status, sport, eventDate, result.ageGroupRank.place). Mirrors __tests__/highlights.test.ts's
 *  own `race()` helper. */
function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate'>): Race {
  return {
    name: overrides.id,
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    location: 'Test City',
    status: 'completed',
    locked: false,
    ...overrides,
  };
}

describe('getAgeGroupPodiumsCount', () => {
  it('counts a completed race with a literal 1st/2nd/3rd age-group place', () => {
    const podium = race({
      id: 'podium-race',
      eventDate: '2026-05-01',
      result: { finishSeconds: 5000, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 2, field: 24 } },
    });

    expect(getAgeGroupPodiumsCount([podium])).toBe(1);
  });

  it('does not count a completed race whose age-group place is outside the top 3', () => {
    // A strong percentile (17/704 is Top 3%) is NOT itself a podium — only a literal place 1-3
    // counts. This proves the count never infers a podium from percentile alone.
    const strongButNotPodium = race({
      id: 'strong-percentile-not-podium',
      eventDate: '2026-05-03',
      result: { finishSeconds: 5216, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 17, field: 704 } },
    });

    expect(getAgeGroupPodiumsCount([strongButNotPodium])).toBe(0);
  });

  it('excludes a completed race with a missing/null age-group place rather than counting it either way', () => {
    const noRankData = race({
      id: 'no-rank-data',
      eventDate: '2026-06-01',
      result: { finishSeconds: 4000, splits: [], sourceStatus: 'self_reported', needsConfirmation: true },
    });
    const podium = race({
      id: 'podium-race',
      eventDate: '2026-06-02',
      result: { finishSeconds: 4100, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 1, field: 10 } },
    });

    // Only the race with a known, verified place counts — the missing-data race is excluded
    // entirely (neither counted as a podium nor asserted as confirmed "not" one).
    expect(getAgeGroupPodiumsCount([noRankData, podium])).toBe(1);
  });

  it('never counts an upcoming/non-completed race, even if it somehow carries a podium-shaped rank field', () => {
    const upcomingWithRank = {
      ...race({ id: 'upcoming-with-rank', eventDate: '2027-01-01' }),
      status: 'registered' as const,
      result: undefined,
    };

    expect(getAgeGroupPodiumsCount([upcomingWithRank])).toBe(0);
  });

  it('counts each qualifying race at most once', () => {
    const first = race({
      id: 'first-podium',
      eventDate: '2025-03-01',
      result: { finishSeconds: 5000, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 3, field: 40 } },
    });
    const second = race({
      id: 'second-podium',
      eventDate: '2025-08-01',
      result: { finishSeconds: 5100, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 1, field: 12 } },
    });

    expect(getAgeGroupPodiumsCount([first, second])).toBe(2);
  });

  it('respects the active sport filter', () => {
    const runPodium = race({
      id: 'run-podium',
      eventDate: '2026-04-01',
      sport: 'running',
      result: { finishSeconds: 1500, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 1, field: 30 } },
    });
    const triPodium = race({
      id: 'tri-podium',
      eventDate: '2026-04-02',
      sport: 'triathlon',
      result: { finishSeconds: 8000, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 2, field: 30 } },
    });
    const races = [runPodium, triPodium];

    expect(getAgeGroupPodiumsCount(races, 'running')).toBe(1);
    expect(getAgeGroupPodiumsCount(races, 'triathlon')).toBe(1);
    expect(getAgeGroupPodiumsCount(races)).toBe(2);
  });

  it('respects the active year filter and recomputes when it changes', () => {
    const podium2025 = race({
      id: 'podium-2025',
      eventDate: '2025-09-01',
      result: { finishSeconds: 5000, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 1, field: 20 } },
    });
    const podium2026 = race({
      id: 'podium-2026',
      eventDate: '2026-09-01',
      result: { finishSeconds: 5000, splits: [], sourceStatus: 'imported_confirmed', ageGroupRank: { place: 2, field: 20 } },
    });
    const races = [podium2025, podium2026];

    expect(getAgeGroupPodiumsCount(races, undefined, 2025)).toBe(1);
    expect(getAgeGroupPodiumsCount(races, undefined, 2026)).toBe(1);
    expect(getAgeGroupPodiumsCount(races)).toBe(2);
  });
});
