import { getTopPercentile } from '@/lib/format';
import {
  filterRacesByName,
  getAvailableSports,
  getAvailableYears,
  getCompletedRaces,
  getNextRace,
  getUpcomingRaces,
  groupCompletedRacesByYear,
} from '@/lib/races';
import {
  getAggregateStats,
  getAverageAgeGroupPercentile,
  getBestAgeGroupPercentile,
  getPersonalBests,
} from '@/lib/stats';
import { getDistancePRStatuses } from '@/lib/highlights';
import { racesPopulated, type Race } from '@/fixtures/races';

function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'status'>): Race {
  return {
    name: 'Test Race',
    sport: 'running',
    distanceLabel: '5K',
    location: 'Nowhere',
    ...overrides,
  };
}

const races: Race[] = [
  race({
    id: 'upcoming-a',
    eventDate: '2027-01-10',
    status: 'registered',
  }),
  race({
    id: 'upcoming-b',
    eventDate: '2026-12-01',
    status: 'considering',
  }),
  race({
    id: 'completed-2025-tri',
    eventDate: '2025-06-01',
    status: 'completed',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    result: {
      finishSeconds: 9000,
      splits: [],
      ageGroupRank: { place: 5, field: 50 },
      sourceStatus: 'self_reported',
    },
  }),
  race({
    id: 'completed-2024-run',
    eventDate: '2024-05-01',
    status: 'completed',
    sport: 'running',
    distanceLabel: '10K',
    result: {
      finishSeconds: 2600,
      splits: [],
      ageGroupRank: { place: 20, field: 100 },
      sourceStatus: 'self_reported',
    },
  }),
];

describe('getUpcomingRaces / getNextRace', () => {
  it('sorts upcoming races soonest-first and picks the soonest as next', () => {
    const upcoming = getUpcomingRaces(races);
    expect(upcoming.map((r) => r.id)).toEqual(['upcoming-b', 'upcoming-a']);
    expect(getNextRace(races)?.id).toBe('upcoming-b');
  });

  it('returns null when there are no upcoming races', () => {
    expect(getNextRace(races.filter((r) => r.status === 'completed'))).toBeNull();
  });
});

describe('getCompletedRaces', () => {
  it('returns only completed races, newest first', () => {
    const completed = getCompletedRaces(races);
    expect(completed.map((r) => r.id)).toEqual(['completed-2025-tri', 'completed-2024-run']);
  });

  it('filters by year', () => {
    expect(getCompletedRaces(races, 2024).map((r) => r.id)).toEqual(['completed-2024-run']);
  });
});

describe('groupCompletedRacesByYear', () => {
  it('groups an already newest-first list into consecutive per-year buckets, preserving order', () => {
    const completed = getCompletedRaces(races);
    const groups = groupCompletedRacesByYear(completed);
    expect(groups.map((g) => g.year)).toEqual([2025, 2024]);
    expect(groups[0]!.races.map((r) => r.id)).toEqual(['completed-2025-tri']);
    expect(groups[1]!.races.map((r) => r.id)).toEqual(['completed-2024-run']);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupCompletedRacesByYear([])).toEqual([]);
  });
});

describe('filterRacesByName', () => {
  it('matches case-insensitively on a substring of the race name', () => {
    const named = [
      race({ id: 'a', eventDate: '2024-01-01', status: 'completed', name: 'Toronto Marathon' }),
      race({ id: 'b', eventDate: '2024-02-01', status: 'completed', name: 'Ottawa 10K' }),
    ];
    expect(filterRacesByName(named, 'toronto').map((r) => r.id)).toEqual(['a']);
    expect(filterRacesByName(named, 'TORONTO').map((r) => r.id)).toEqual(['a']);
    expect(filterRacesByName(named, 'marathon').map((r) => r.id)).toEqual(['a']);
  });

  it('returns every race unchanged for a blank query', () => {
    const named = [race({ id: 'a', eventDate: '2024-01-01', status: 'completed', name: 'Toronto Marathon' })];
    expect(filterRacesByName(named, '   ')).toEqual(named);
  });

  it('returns an empty array when nothing matches', () => {
    const named = [race({ id: 'a', eventDate: '2024-01-01', status: 'completed', name: 'Toronto Marathon' })];
    expect(filterRacesByName(named, 'ottawa')).toEqual([]);
  });
});

describe('getAvailableSports / getAvailableYears', () => {
  it('only returns sports actually present in the data', () => {
    expect(getAvailableSports(races).sort()).toEqual(['running', 'triathlon'].sort());
  });

  it('only returns years with a completed race, newest first', () => {
    expect(getAvailableYears(races)).toEqual([2025, 2024]);
  });
});

describe('getAggregateStats', () => {
  it('counts races matching the filter', () => {
    expect(getAggregateStats(races)).toEqual({ totalRaces: 2 });
    expect(getAggregateStats(races, 'triathlon')).toEqual({ totalRaces: 1 });
    expect(getAggregateStats(races, 'running', 2024)).toEqual({ totalRaces: 1 });
  });
});

describe('getPersonalBests', () => {
  it('lists one entry per distance PR matching the filter, ordered shortest-to-longest', () => {
    expect(getPersonalBests(races).map((pb) => pb.distanceLabel)).toEqual(['10K', 'Olympic']);
    expect(getPersonalBests(races, 'running').map((pb) => pb.distanceLabel)).toEqual(['10K']);
  });
});

describe('getTopPercentile', () => {
  it('computes a rounded-up top percentage from place/field', () => {
    expect(getTopPercentile(18, 120)).toBe(15);
    expect(getTopPercentile(1, 100)).toBe(1);
    expect(getTopPercentile(350, 1400)).toBe(25);
  });

  it('never returns 0, even for a very small place/field ratio', () => {
    expect(getTopPercentile(1, 10000)).toBe(1);
  });
});

describe('getBestAgeGroupPercentile', () => {
  it('returns the best (lowest) percentile across matching races', () => {
    // 2025 triathlon: 5/50 -> top 10%. 2024 running: 20/100 -> top 20%. Best overall is 10%.
    expect(getBestAgeGroupPercentile(races)).toBe(10);
    expect(getBestAgeGroupPercentile(races, 'running')).toBe(20);
  });

  it('returns null when nothing in the filter has age-group ranking data', () => {
    expect(getBestAgeGroupPercentile(races.filter((r) => r.status !== 'completed'))).toBeNull();
  });
});

describe('getDistancePRStatuses', () => {
  const distanceRaces: Race[] = [
    race({
      id: 'first',
      eventDate: '2020-01-01',
      status: 'completed',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 3000, splits: [], sourceStatus: 'self_reported' },
    }),
    race({
      id: 'slower-than-first',
      eventDate: '2021-01-01',
      status: 'completed',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 3200, splits: [], sourceStatus: 'self_reported' },
    }),
    race({
      id: 'beats-first',
      eventDate: '2022-01-01',
      status: 'completed',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 2900, splits: [], sourceStatus: 'self_reported' },
    }),
    race({
      id: 'beats-again-current-pb',
      eventDate: '2023-01-01',
      status: 'completed',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 2800, splits: [], sourceStatus: 'self_reported' },
    }),
  ];

  it('labels the earliest race in a distance group as first-recorded, never a PR', () => {
    const statuses = getDistancePRStatuses(distanceRaces);
    const first = statuses.find((s) => s.race.id === 'first')!;
    expect(first.isFirstRecorded).toBe(true);
    expect(first.isPRPerformance).toBe(false);
  });

  it('does not flag a slower-than-everything-so-far race as a PR performance', () => {
    const statuses = getDistancePRStatuses(distanceRaces);
    const slower = statuses.find((s) => s.race.id === 'slower-than-first')!;
    expect(slower.isFirstRecorded).toBe(false);
    expect(slower.isPRPerformance).toBe(false);
    expect(slower.isCurrentPB).toBe(false);
  });

  it('flags a race that beats the running-best-so-far as a PR performance, even if later superseded', () => {
    const statuses = getDistancePRStatuses(distanceRaces);
    const beatsFirst = statuses.find((s) => s.race.id === 'beats-first')!;
    expect(beatsFirst.isPRPerformance).toBe(true);
    expect(beatsFirst.isCurrentPB).toBe(false); // later beaten by 'beats-again-current-pb'
  });

  it('flags the single fastest-of-all-time race as the current PB, and also a PR performance', () => {
    const statuses = getDistancePRStatuses(distanceRaces);
    const currentPb = statuses.find((s) => s.race.id === 'beats-again-current-pb')!;
    expect(currentPb.isCurrentPB).toBe(true);
    expect(currentPb.isPRPerformance).toBe(true);
    expect(currentPb.isFirstRecorded).toBe(false);
  });

  it('excludes a one-off custom distance (e.g. Kingston) from the PR ladder entirely', () => {
    const withCustomDistance: Race[] = [
      ...distanceRaces,
      race({
        id: 'kingston-like',
        eventDate: '2024-01-01',
        status: 'completed',
        distanceLabel: 'Custom — 2K/55K/15K',
        result: { finishSeconds: 14769, splits: [], sourceStatus: 'self_reported' },
      }),
    ];
    const statuses = getDistancePRStatuses(withCustomDistance);
    expect(statuses.some((s) => s.race.id === 'kingston-like')).toBe(false);
  });
});

describe('getAverageAgeGroupPercentile', () => {
  it('averages raw place/field ratios and rounds up once at the end', () => {
    // 1/4 -> 0.25, 1/3 -> 0.3333...; averaging the raw ratios (0.29167) and ceiling once gives 30%.
    const sample: Race[] = [
      race({
        id: 'a',
        eventDate: '2024-01-01',
        status: 'completed',
        result: { finishSeconds: 1000, splits: [], ageGroupRank: { place: 1, field: 4 }, sourceStatus: 'self_reported' },
      }),
      race({
        id: 'b',
        eventDate: '2024-02-01',
        status: 'completed',
        result: { finishSeconds: 1000, splits: [], ageGroupRank: { place: 1, field: 3 }, sourceStatus: 'self_reported' },
      }),
    ];
    const result = getAverageAgeGroupPercentile(sample);
    expect(result.raceCount).toBe(2);
    expect(result.percentile).toBe(30);
  });

  it('excludes races with no field size and races flagged rankingNeedsConfirmation', () => {
    const sample: Race[] = [
      race({
        id: 'complete',
        eventDate: '2024-01-01',
        status: 'completed',
        result: { finishSeconds: 1000, splits: [], ageGroupRank: { place: 1, field: 4 }, sourceStatus: 'self_reported' },
      }),
      race({
        id: 'place-only',
        eventDate: '2024-02-01',
        status: 'completed',
        result: { finishSeconds: 1000, splits: [], ageGroupRank: { place: 33 }, sourceStatus: 'self_reported' },
      }),
      race({
        id: 'flagged',
        eventDate: '2024-03-01',
        status: 'completed',
        result: {
          finishSeconds: 1000,
          splits: [],
          ageGroupRank: { place: 1, field: 2 },
          sourceStatus: 'self_reported',
          rankingNeedsConfirmation: true,
        },
      }),
    ];
    const result = getAverageAgeGroupPercentile(sample);
    expect(result.raceCount).toBe(1);
    expect(result.percentile).toBe(25);
  });

  it('matches the worked example against the real race history (4 races with complete AG data -> 12%)', () => {
    // Eagleman 2026 (14/205), Niagara Falls Barrelman 2025 (5/17), Bracebridge 2026 (2/24), and
    // Toronto Marathon Half 2026 (17/704) are the only real races with both AG place and field
    // known and no rankingNeedsConfirmation flag:
    // (14/205 + 5/17 + 2/24 + 17/704) / 4 = 0.11747... -> ceil -> 12%.
    const result = getAverageAgeGroupPercentile(racesPopulated);
    expect(result.raceCount).toBe(4);
    expect(result.percentile).toBe(12);
  });

  it('returns null/0 when nothing in the filter has complete age-group data', () => {
    expect(getAverageAgeGroupPercentile(races.filter((r) => r.status !== 'completed'))).toEqual({
      percentile: null,
      raceCount: 0,
    });
  });
});
