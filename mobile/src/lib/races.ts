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
