import { getTopPercentile } from '@/lib/format';
import {
  getAvailableSports,
  getAvailableYears,
  getCompletedRaces,
  getNextRace,
  getUpcomingRaces,
} from '@/lib/races';
import { getAggregateStats, getBestAgeGroupPercentile, getPersonalBests } from '@/lib/stats';
import { getTrainingTotals } from '@/lib/training';
import type { Race } from '@/fixtures/races';
import type { TrainingBlock } from '@/fixtures/training';

function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'status'>): Race {
  return {
    name: 'Test Race',
    sport: 'running',
    distanceLabel: '5K',
    location: 'Nowhere',
    locked: false,
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
      ageGroupRank: { place: 5, field: 50, ageGroup: 'M35-39' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: true,
      achievements: [{ icon: 'trophy', label: 'Olympic distance PR' }],
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
      ageGroupRank: { place: 20, field: 100, ageGroup: 'M35-39' },
      sourceStatus: 'self_reported',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: [{ icon: 'trophy', label: '10K PR' }],
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

describe('getAvailableSports / getAvailableYears', () => {
  it('only returns sports actually present in the data', () => {
    expect(getAvailableSports(races).sort()).toEqual(['running', 'triathlon'].sort());
  });

  it('only returns years with a completed race, newest first', () => {
    expect(getAvailableYears(races)).toEqual([2025, 2024]);
  });
});

describe('getAggregateStats', () => {
  it('counts races, podiums, and PRs matching the filter', () => {
    expect(getAggregateStats(races)).toEqual({ totalRaces: 2, podiums: 1, prCount: 2 });
    expect(getAggregateStats(races, 'triathlon')).toEqual({ totalRaces: 1, podiums: 1, prCount: 1 });
    expect(getAggregateStats(races, 'running', 2024)).toEqual({ totalRaces: 1, podiums: 0, prCount: 1 });
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

const trainingBlocks: TrainingBlock[] = [
  { id: 'b1', year: 2025, sportCategory: 'triathlon', sessions: 100, hours: 120, swimKm: 50, bikeKm: 2000, runKm: 400 },
  { id: 'b2', year: 2025, sportCategory: 'running', sessions: 40, hours: 45, swimKm: 0, bikeKm: 0, runKm: 350 },
  { id: 'b3', year: 2024, sportCategory: 'running', sessions: 30, hours: 35, swimKm: 0, bikeKm: 0, runKm: 300 },
];

describe('getTrainingTotals', () => {
  it('sums every block for "overall, all time" with no filter', () => {
    const totals = getTrainingTotals(trainingBlocks);
    expect(totals.sessions).toBe(170);
    expect(totals.hours).toBe(200);
  });

  it('does not double-count: overall for a year equals the sum of that year\'s sport-specific blocks', () => {
    const overall2025 = getTrainingTotals(trainingBlocks, { year: 2025 });
    const tri2025 = getTrainingTotals(trainingBlocks, { year: 2025, sportCategory: 'triathlon' });
    const run2025 = getTrainingTotals(trainingBlocks, { year: 2025, sportCategory: 'running' });

    expect(overall2025.sessions).toBe(tri2025.sessions + run2025.sessions);
    expect(overall2025.hours).toBe(tri2025.hours + run2025.hours);
    expect(overall2025.totalDistanceKm).toBe(tri2025.totalDistanceKm + run2025.totalDistanceKm);
  });

  it('filters by sport and year together', () => {
    const totals = getTrainingTotals(trainingBlocks, { sportCategory: 'running', year: 2024 });
    expect(totals).toEqual({ sessions: 30, hours: 35, swimKm: 0, bikeKm: 0, runKm: 300, totalDistanceKm: 300 });
  });
});
