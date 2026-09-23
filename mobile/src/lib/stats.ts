import type { Race, SportCategory } from '@/fixtures/races';
import { getTopPercentile } from '@/lib/format';
import { canonicalDistanceLabel, getDistancePRStatuses } from '@/lib/highlights';
import { getCompletedRaces } from '@/lib/races';

export interface AggregateStats {
  totalRaces: number;
}

function filterBySportAndYear(races: Race[], sport?: SportCategory, year?: number): Race[] {
  return getCompletedRaces(races, year).filter((race) => sport === undefined || race.sport === sport);
}

export function getAggregateStats(races: Race[], sport?: SportCategory, year?: number): AggregateStats {
  return { totalRaces: filterBySportAndYear(races, sport, year).length };
}

function hasCompleteAgeGroupRank(race: Race): boolean {
  const rank = race.result?.ageGroupRank;
  return !race.result?.rankingNeedsConfirmation && rank !== undefined && rank.field !== undefined;
}

/**
 * Best (lowest / most impressive) age-group percentile across races matching the filter, or null
 * if none of them have complete, trustworthy age-group ranking data. One line of arithmetic on
 * existing place/field numbers (see getTopPercentile) — not a fitness or performance-prediction
 * algorithm. Races flagged `rankingNeedsConfirmation` are excluded until their source data is
 * confirmed.
 */
export function getBestAgeGroupPercentile(
  races: Race[],
  sport?: SportCategory,
  year?: number,
): number | null {
  const percentiles = filterBySportAndYear(races, sport, year)
    .filter(hasCompleteAgeGroupRank)
    .map((race) => getTopPercentile(race.result!.ageGroupRank!.place, race.result!.ageGroupRank!.field!));

  return percentiles.length === 0 ? null : Math.min(...percentiles);
}

export interface AverageAgeGroupPercentile {
  percentile: number | null;
  raceCount: number;
}

/**
 * Averages the RAW place/field ratios across every qualifying race, then rounds once at the end
 * (ceil, matching getTopPercentile's "never overstate" convention) — not an average of
 * already-rounded per-race percentages. Only races with both a known age-group place AND field
 * size count, and only where the ranking data isn't flagged `rankingNeedsConfirmation`.
 */
export function getAverageAgeGroupPercentile(
  races: Race[],
  sport?: SportCategory,
  year?: number,
): AverageAgeGroupPercentile {
  const qualifying = filterBySportAndYear(races, sport, year).filter(hasCompleteAgeGroupRank);
  if (qualifying.length === 0) return { percentile: null, raceCount: 0 };

  const averageRatio =
    qualifying.reduce((sum, race) => {
      const rank = race.result!.ageGroupRank!;
      return sum + rank.place / rank.field!;
    }, 0) / qualifying.length;

  return { percentile: Math.max(1, Math.ceil(averageRatio * 100)), raceCount: qualifying.length };
}

export interface PersonalBest {
  distanceLabel: string;
  race: Race;
}

/** Shortest-to-longest reading order, matching how an athlete would naturally scan their PR ladder. */
const DISTANCE_ORDER = ['5K', '10K', 'Half Marathon', 'Marathon', 'Sprint', 'Olympic', '70.3', 'IRONMAN'];

function distanceOrderIndex(distanceLabel: string): number {
  const index = DISTANCE_ORDER.indexOf(distanceLabel);
  return index === -1 ? DISTANCE_ORDER.length : index;
}

/**
 * One entry per distance category currently holding a Current PB, matching the active sport/year
 * filter, ordered shortest-to-longest. This is the "Personal Bests" ladder — distinct from a
 * historical "PR Performance," which can belong to a race that's since been beaten.
 */
export function getPersonalBests(races: Race[], sport?: SportCategory, year?: number): PersonalBest[] {
  const currentPBs = getDistancePRStatuses(races)
    .filter((status) => status.isCurrentPB)
    .map((status) => status.race);
  return filterBySportAndYear(currentPBs, sport, year)
    .map((race) => ({ distanceLabel: canonicalDistanceLabel(race.distanceLabel), race }))
    .sort((a, b) => distanceOrderIndex(a.distanceLabel) - distanceOrderIndex(b.distanceLabel));
}

/**
 * Count of distinct distance categories with a Current PB — the "Personal Bests" headline metric.
 * Deliberately not called "PRs": see the A.3 plan's terminology section for why the yearly "PRs
 * this year" metric (count of PR Performances, in lib/highlights.ts) is a different number.
 */
export function getPersonalBestsCount(races: Race[], sport?: SportCategory, year?: number): number {
  return getPersonalBests(races, sport, year).length;
}
