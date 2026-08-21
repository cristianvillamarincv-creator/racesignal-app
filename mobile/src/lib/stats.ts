import type { Race, SportCategory } from '@/fixtures/races';
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

export interface PersonalBest {
  distanceLabel: string;
  race: Race;
}

/** One entry per distance the athlete has a current PR at, matching the active sport/year filter. */
export function getPersonalBests(races: Race[], sport?: SportCategory, year?: number): PersonalBest[] {
  return filterBySportAndYear(races, sport, year)
    .filter((race) => race.result?.isDistancePR)
    .map((race) => ({ distanceLabel: race.distanceLabel, race }));
}

export interface AchievementHighlight {
  race: Race;
  achievement: string;
}

/** Flattened list of authored achievement tags for the active sport/year filter. */
export function getAchievementHighlights(
  races: Race[],
  sport?: SportCategory,
  year?: number,
): AchievementHighlight[] {
  return filterBySportAndYear(races, sport, year).flatMap((race) =>
    (race.result?.achievements ?? []).map((achievement) => ({ race, achievement })),
  );
}
