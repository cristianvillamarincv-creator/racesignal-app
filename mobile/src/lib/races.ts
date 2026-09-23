import type { Race, SportCategory } from '@/fixtures/races';

/** Year is read from the leading YYYY of the ISO date string, avoiding timezone edge cases. */
export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

export function getUpcomingRaces(races: Race[]): Race[] {
  return races
    .filter((race) => race.status !== 'completed')
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

/** Soonest upcoming race, or null if the athlete has none queued up. */
export function getNextRace(races: Race[]): Race | null {
  return getUpcomingRaces(races)[0] ?? null;
}

export function getCompletedRaces(races: Race[], year?: number): Race[] {
  return races
    .filter((race) => race.status === 'completed')
    .filter((race) => year === undefined || yearOf(race.eventDate) === year)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
}

/** Only sports actually present in the data — never a hardcoded generic list. */
export function getAvailableSports(races: Race[]): SportCategory[] {
  return Array.from(new Set(races.map((race) => race.sport)));
}

/** Years with at least one completed race, newest first. */
export function getAvailableYears(races: Race[]): number[] {
  const years = new Set(getCompletedRaces(races).map((race) => yearOf(race.eventDate)));
  return Array.from(years).sort((a, b) => b - a);
}

export interface RaceYearGroup {
  year: number;
  races: Race[];
}

/**
 * Groups an already-sorted (newest-first) completed-race list into consecutive per-year buckets,
 * preserving order — the Races screen's replacement for a separate year-filter control: scrolling
 * through the grouped list with visible year headers does that job instead of a pill row.
 */
export function groupCompletedRacesByYear(races: Race[]): RaceYearGroup[] {
  const groups: RaceYearGroup[] = [];
  for (const race of races) {
    const year = yearOf(race.eventDate);
    const current = groups[groups.length - 1];
    if (current && current.year === year) {
      current.races.push(race);
    } else {
      groups.push({ year, races: [race] });
    }
  }
  return groups;
}

/**
 * Local, in-memory filter by event name — case-insensitive substring match. Deliberately not a
 * remote/provider search: this only ever filters races already loaded into the app.
 */
export function filterRacesByName(races: Race[], query: string): Race[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return races;
  return races.filter((race) => race.name.toLowerCase().includes(trimmed));
}
