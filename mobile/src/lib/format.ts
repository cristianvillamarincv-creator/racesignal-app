/**
 * Pure formatting/calculation helpers, kept dependency-free so they're cheap to unit test.
 */

/** Whole calendar days between `today` and `isoDate` (ignoring time-of-day). Negative if past. */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const to = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

/** Turns a day count into the countdown copy used on the next-race card. */
export function formatCountdown(days: number): string {
  if (days < 0) return 'Completed';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

export interface ChecklistItemLike {
  isComplete: boolean;
}

/** Percentage (0-100, rounded) of complete checklist items. 0 for an empty list. */
export function checklistProgress(items: ChecklistItemLike[]): number {
  if (items.length === 0) return 0;
  const completeCount = items.filter((item) => item.isComplete).length;
  return Math.round((completeCount / items.length) * 100);
}

/** Formats a finish time in seconds as H:MM:SS (or M:SS under an hour). */
export function formatFinishTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => value.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * One line of arithmetic on numbers we already have (place/field) — not a scoring engine.
 * place=18, field=120 -> 15 ("Top 15%"). Rounds up so "Top 15%" never overstates the result.
 */
export function getTopPercentile(place: number, field: number): number {
  if (field <= 0) return 0;
  return Math.max(1, Math.ceil((place / field) * 100));
}

/** "33" -> "33rd". No Intl dependency (Hermes' Intl.PluralRules support is inconsistent). */
export function formatOrdinal(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export type RaceDateDisplay =
  | { precision: 'day'; month: string; day: number; full: string }
  | { precision: 'year'; year: string };

/**
 * A race's `eventDate` is either a full `YYYY-MM-DD` or a bare `YYYY` when the source only
 * recorded the year (e.g. IRONMAN 70.3 Syracuse 2018). Never invents a day/month for the latter —
 * callers get a `year`-precision result instead and should show that plainly rather than
 * constructing a `Date` from it.
 */
export function formatRaceDate(eventDate: string): RaceDateDisplay {
  if (!eventDate.includes('-')) {
    return { precision: 'year', year: eventDate };
  }
  const date = new Date(`${eventDate}T00:00:00`);
  const month = date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  const day = date.getDate();
  const full = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return { precision: 'day', month, day, full };
}
