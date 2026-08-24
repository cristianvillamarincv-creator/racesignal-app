import type { Achievement, Race, SportCategory } from '@/fixtures/races';
import { getTopPercentile } from '@/lib/format';
import type { IconName } from '@/lib/icons';
import { getCompletedRaces } from '@/lib/races';

export interface AggregateStats {
  totalRaces: number;
  podiums: number;
  prCount: number;
}

function filterBySportAndYear(races: Race[], sport?: SportCategory, year?: number): Race[] {
  return getCompletedRaces(races, year).filter((race) => sport === undefined || race.sport === sport);
}

export function getAggregateStats(races: Race[], sport?: SportCategory, year?: number): AggregateStats {
  const completed = filterBySportAndYear(races, sport, year);
  return {
    totalRaces: completed.length,
    podiums: completed.filter((race) => race.result?.podium).length,
    prCount: completed.filter((race) => race.result?.isDistancePR).length,
  };
}

/**
 * Best (lowest / most impressive) age-group percentile across races matching the filter, or null
 * if none of them have age-group ranking data. One line of arithmetic on existing place/field
 * numbers (see getTopPercentile) — not a fitness or performance-prediction algorithm.
 */
export function getBestAgeGroupPercentile(
  races: Race[],
  sport?: SportCategory,
  year?: number,
): number | null {
  const percentiles = filterBySportAndYear(races, sport, year)
    .map((race) => race.result?.ageGroupRank)
    .filter((rank): rank is NonNullable<typeof rank> => rank !== undefined)
    .map((rank) => getTopPercentile(rank.place, rank.field));

  return percentiles.length === 0 ? null : Math.min(...percentiles);
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
 * One entry per distance the athlete has a current PR at, matching the active sport/year filter,
 * ordered shortest-to-longest rather than by race date.
 */
export function getPersonalBests(races: Race[], sport?: SportCategory, year?: number): PersonalBest[] {
  return filterBySportAndYear(races, sport, year)
    .filter((race) => race.result?.isDistancePR)
    .map((race) => ({ distanceLabel: race.distanceLabel, race }))
    .sort((a, b) => distanceOrderIndex(a.distanceLabel) - distanceOrderIndex(b.distanceLabel));
}

export interface AchievementHighlight {
  race: Race;
  achievement: Achievement;
}

/** Flattened list of authored achievements for the active sport/year filter. */
export function getAchievementHighlights(
  races: Race[],
  sport?: SportCategory,
  year?: number,
): AchievementHighlight[] {
  return filterBySportAndYear(races, sport, year).flatMap((race) =>
    (race.result?.achievements ?? []).map((achievement) => ({ race, achievement })),
  );
}

/**
 * PR > podium > course-best > everything else. Lets Season/Stats rows show only the 1-2 most
 * meaningful badges instead of every achievement a race happens to have.
 */
const ACHIEVEMENT_ICON_PRIORITY: IconName[] = [
  'trophy',
  'medal',
  'flag-checkered',
  'star',
  'lightning-bolt',
  'party-popper',
  'fire',
];

function achievementPriority(achievement: Achievement): number {
  const index = ACHIEVEMENT_ICON_PRIORITY.indexOf(achievement.icon);
  return index === -1 ? ACHIEVEMENT_ICON_PRIORITY.length : index;
}

export function pickTopAchievements(achievements: Achievement[], max = 2): Achievement[] {
  return [...achievements].sort((a, b) => achievementPriority(a) - achievementPriority(b)).slice(0, max);
}

/** Same priority order applied to {race, achievement} pairs, for Stats' Highlight cards. */
export function pickTopHighlights(highlights: AchievementHighlight[], max = 6): AchievementHighlight[] {
  return [...highlights]
    .sort((a, b) => achievementPriority(a.achievement) - achievementPriority(b.achievement))
    .slice(0, max);
}
