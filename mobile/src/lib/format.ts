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

/**
 * Known standardized race distances, for DISPLAY only — mirrors (but does not import; separate
 * mobile vs Deno projects) the same category table used server-side in
 * supabase/functions/race-discovery/normalize.ts to compute pace. Matching is substring-based,
 * case-insensitive, most-specific-first ("half marathon" checked before "marathon", since the
 * latter is a substring of the former). Returns undefined for an unrecognized/custom category —
 * never invents a distance we don't actually have a trustworthy mapping for.
 */
const KNOWN_RUNNING_DISTANCE_LABELS: [match: string, label: string][] = [
  ['half marathon', '21.1 km'],
  ['marathon', '42.2 km'],
  ['10km', '10 km'],
  ['10k', '10 km'],
  ['5km', '5 km'],
  ['5k', '5 km'],
];

export function getKnownRunningDistanceLabel(category: string | undefined): string | undefined {
  if (!category) return undefined;
  const normalized = category.toLowerCase();
  return KNOWN_RUNNING_DISTANCE_LABELS.find(([match]) => normalized.includes(match))?.[1];
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

/** Compact relative-time label for a full timestamp (not a bare race date) — "Just now", "5m ago",
 *  "3h ago", "Yesterday", "4d ago", or a short date beyond a week. Used for Signal's "Recent
 *  Signals" conversation metadata. */
export function formatRelativeDate(isoDateTime: string, now: Date = new Date()): string {
  const then = new Date(isoDateTime);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
