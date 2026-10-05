// Race prediction basis: the ONE deterministic calculation behind Signal's historical reference ranges.
//
// THIS FILE EXISTS IN TWO PLACES, BYTE FOR BYTE:
//   supabase/functions/signal/racePrediction.ts   <- source of truth (the Edge Function derives every basis from it)
//   mobile/src/lib/racePrediction.ts              <- mirror (the app uses it only to decide which suggestions to show)
// The two projects (Deno and Expo) cannot import across each other, so the file has NO imports and a Jest test
// (mobile/__tests__/racePredictionParity.test.ts) fails if the copies differ. Edit the supabase copy, then run:
//   cp supabase/functions/signal/racePrediction.ts mobile/src/lib/racePrediction.ts
//
// What it produces is a HISTORICAL REFERENCE RANGE: the fastest and slowest recorded time among the athlete's own
// recent results at the same sport and the same standard distance as an upcoming race. It is not a validated forecast,
// has no center, padding, score or probability, and says nothing about current fitness. Every number the model may
// quote (times, dates, the spread, how long ago an older result was) is computed here and handed over; the model never
// does arithmetic.
//
// Rules, all applied here and nowhere else:
//  - A comparable result is a COMPLETED race with a recorded finish time (a whole number of seconds above zero), the
//    same sport and the same standard distance as the target, and a date that is not in the future. Rows without a
//    finish time are unusable. The import has no DNF/DNS detection: a result is used because it has a recorded time,
//    not because it was identified as a finish.
//  - Distance comes ONLY from the distance label, matched exactly (after trimming, lower-casing and collapsing spaces)
//    against a table scoped by sport. The event name is never read. Anything not in the table (a bare "Ironman",
//    "Sprint", custom distances, other sports) has no standard distance and gets no estimate.
//  - Recent means within 24 calendar months before today, inclusive. A year-only date counts as recent only when the
//    whole year (from January 1) is inside the window. Up to five most recent recent results are used.
//  - Two records are counted once only when sport, distance, normalized event name, date and finish time are all
//    identical. Different events that share a date and time are never merged. A merge is reported (`recordCount`).
//  - Two or more recent results give a range. One gives a dated reference. Older results are references only and never
//    enter a range. With none, there is no estimate. Considering and registered races are treated identically.

export type PredictionRaceStatus = 'considering' | 'registered' | 'completed';

/** The minimal race shape the calculation reads. Mobile and server each map their own rows onto it. */
export interface PredictionRaceInput {
  id: string;
  name: string;
  sport: string;
  /** The free-text distance/category label, exactly as stored. The only source of distance. */
  distanceLabel: string;
  /** Full `YYYY-MM-DD`, or a bare `YYYY` when only the year is recorded. */
  eventDate: string;
  status: PredictionRaceStatus | string;
  finishSeconds?: number | null;
}

export const PREDICTION_WINDOW_MONTHS = 24;
export const PREDICTION_MAX_RESULTS = 5;
export const PREDICTION_MAX_OLDER = 3;
export const PREDICTION_MAX_TARGETS = 5;

export interface PredictionResultRef {
  raceId: string;
  name: string;
  /** As recorded: `YYYY-MM-DD`, or `YYYY` when only the year is known. */
  date: string;
  dateIsYearOnly: boolean;
  finishSeconds: number;
  /** `H:MM:SS`, or `M:SS` under an hour. */
  finishText: string;
  /** More than one means identical records (same event, date and time) were counted once. */
  recordCount: number;
}

export interface PredictionOlderRef extends PredictionResultRef {
  /** Whole months between the result and today; absent when only the year is known. */
  monthsAgo?: number;
  /** Ready-to-say wording, e.g. "over 3 years ago" or "recorded as 2018 only". */
  ageText: string;
}

export type PredictionKind =
  /** Two or more recent results: a historical reference range. */
  | 'range'
  /** Exactly one recent result: a dated reference only. */
  | 'single'
  /** No recent result, but older ones: dated references only. */
  | 'older_only'
  /** No comparable result at all. */
  | 'none'
  /** The race's distance is not a recognized standard distance for its sport. */
  | 'unsupported_distance';

export interface PredictionBasis {
  raceId: string;
  raceName: string;
  raceDate: string;
  raceStatus: 'registered' | 'considering';
  /** The standard distance used for matching (e.g. "Olympic", "Half Marathon"); null when unsupported. */
  distance: string | null;
  kind: PredictionKind;
  /** The recent results used, most recent first, at most five. */
  recent: PredictionResultRef[];
  /** Up to three most recent older results; only filled when there is no range. */
  olderReferences: PredictionOlderRef[];
  /** Range only: the fastest and slowest of `recent`. */
  fastest?: PredictionResultRef;
  slowest?: PredictionResultRef;
  /** Range only: slowest minus fastest, and the same in words ("22 seconds"). 0 when the times are identical. */
  spreadSeconds?: number;
  spreadText?: string;
}

// --- Distance matching ------------------------------------------------------------------------------------------

const RUNNING_DISTANCES: readonly (readonly [string, string])[] = [
  ['5k', '5K'],
  ['5km', '5K'],
  ['5 km', '5K'],
  ['10k', '10K'],
  ['10km', '10K'],
  ['10 km', '10K'],
  ['half marathon', 'Half Marathon'],
  ['half-marathon', 'Half Marathon'],
  ['21.1k', 'Half Marathon'],
  ['21.1km', 'Half Marathon'],
  ['21.1 km', 'Half Marathon'],
  ['13.1', 'Half Marathon'],
  ['13.1 mi', 'Half Marathon'],
  ['13.1 miles', 'Half Marathon'],
  ['marathon', 'Marathon'],
  ['full marathon', 'Marathon'],
  ['42.2k', 'Marathon'],
  ['42.2km', 'Marathon'],
  ['42.2 km', 'Marathon'],
  ['26.2', 'Marathon'],
  ['26.2 mi', 'Marathon'],
  ['26.2 miles', 'Marathon'],
];

// "Sprint" is deliberately absent: sprint triathlon distances vary by event, and a result carries no distance data that
// could establish two sprints are comparable. A bare "Ironman" is absent for the same reason (it names a brand, not a
// distance).
const TRIATHLON_DISTANCES: readonly (readonly [string, string])[] = [
  ['olympic', 'Olympic'],
  ['olympic triathlon', 'Olympic'],
  ['olympic distance', 'Olympic'],
  ['70.3', '70.3'],
  ['70.3 results', '70.3'],
  ['ironman 70.3', '70.3'],
  ['half ironman', '70.3'],
  ['half-ironman', '70.3'],
  ['140.6', '140.6'],
  ['140.6 results', '140.6'],
  ['ironman 140.6', '140.6'],
  ['full ironman', '140.6'],
  ['full distance', '140.6'],
  ['full distance triathlon', '140.6'],
  ['full-distance triathlon', '140.6'],
];

const DISTANCE_TABLES = new Map<string, Map<string, string>>([
  ['running', new Map(RUNNING_DISTANCES)],
  ['triathlon', new Map(TRIATHLON_DISTANCES)],
]);

/** The standard distance for a sport and distance label, or null when it is not a recognized one. Matches the whole
 *  label only (never part of it, never the event name), and only within the sport's own table. */
export function predictionDistanceKey(sport: string, distanceLabel: string): string | null {
  const table = DISTANCE_TABLES.get(sport);
  if (!table) return null;
  const normalized = distanceLabel.trim().toLowerCase().replace(/\s+/g, ' ');
  return table.get(normalized) ?? null;
}

// --- Dates (plain strings, no timezone math) --------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface Ymd {
  year: number;
  month: number;
  day: number;
}

function parseDay(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function toIso(date: Ymd): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** The same calendar day `months` earlier, clamped to the end of a shorter month. */
function subtractMonths(date: Ymd, months: number): Ymd {
  const index = date.year * 12 + (date.month - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Whole months from `earlier` to `later`. */
function monthsBetween(earlier: Ymd, later: Ymd): number {
  const months = (later.year - earlier.year) * 12 + (later.month - earlier.month);
  return later.day < earlier.day ? months - 1 : months;
}

interface DatedResult {
  race: PredictionRaceInput;
  finishSeconds: number;
  yearOnly: boolean;
  /** The day used for ordering and the window: the real day, or January 1 of a year-only result. */
  sortKey: string;
  start: Ymd;
}

function parseResultDate(eventDate: string): { start: Ymd; yearOnly: boolean } | null {
  const day = parseDay(eventDate);
  if (day) return { start: day, yearOnly: false };
  if (/^\d{4}$/.test(eventDate)) return { start: { year: Number(eventDate), month: 1, day: 1 }, yearOnly: true };
  return null;
}

// --- Formatting -------------------------------------------------------------------------------------------------

/** `H:MM:SS` once past an hour, otherwise `M:SS`, matching the app's finish-time display. */
export function formatPredictionDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
  return `${minutes}:${pad(seconds, 2)}`;
}

function unit(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A difference in words, zero units omitted: "22 seconds", "6 minutes 25 seconds", "1 hour 2 minutes". */
export function describePredictionSpread(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'no difference';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(unit(hours, 'hour'));
  if (minutes > 0) parts.push(unit(minutes, 'minute'));
  if (seconds > 0) parts.push(unit(seconds, 'second'));
  return parts.join(' ');
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// --- The calculation --------------------------------------------------------------------------------------------

function isUsableFinish(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Newest first; equal days fall back to id so the order (and the five-result cap) is stable. */
function newestFirst(a: DatedResult, b: DatedResult): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
  return a.race.id < b.race.id ? -1 : a.race.id > b.race.id ? 1 : 0;
}

interface CountedResult {
  result: DatedResult;
  recordCount: number;
}

/** Merges records only when sport, distance, normalized event name, date and finish time are all identical. */
function collapseIdentical(results: DatedResult[]): CountedResult[] {
  const byKey = new Map<string, CountedResult>();
  for (const result of [...results].sort(newestFirst)) {
    const key = [normalizeName(result.race.name), result.race.eventDate, result.finishSeconds].join('|');
    const existing = byKey.get(key);
    if (existing) {
      existing.recordCount += 1;
    } else {
      byKey.set(key, { result, recordCount: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => newestFirst(a.result, b.result));
}

function toRef(counted: CountedResult): PredictionResultRef {
  const { result, recordCount } = counted;
  return {
    raceId: result.race.id,
    name: result.race.name,
    date: result.race.eventDate,
    dateIsYearOnly: result.yearOnly,
    finishSeconds: result.finishSeconds,
    finishText: formatPredictionDuration(result.finishSeconds),
    recordCount,
  };
}

function ageWording(months: number): string {
  if (months < 24) return unit(months, 'month') + ' ago';
  return `over ${unit(Math.floor(months / 12), 'year')} ago`;
}

function toOlderRef(counted: CountedResult, today: Ymd): PredictionOlderRef {
  const base = toRef(counted);
  if (counted.result.yearOnly) {
    return { ...base, ageText: `recorded as ${counted.result.race.eventDate} only` };
  }
  const monthsAgo = monthsBetween(counted.result.start, today);
  return { ...base, monthsAgo, ageText: ageWording(monthsAgo) };
}

/** An upcoming race Signal can reason about: registered or considering, with a full date of today or later. */
function isTarget(race: PredictionRaceInput, today: Ymd): boolean {
  if (race.status !== 'registered' && race.status !== 'considering') return false;
  const day = parseDay(race.eventDate);
  if (!day) return false;
  return toIso(day) >= toIso(today);
}

function buildBasis(target: PredictionRaceInput, races: PredictionRaceInput[], today: Ymd): PredictionBasis {
  const raceStatus = target.status as 'registered' | 'considering';
  const distance = predictionDistanceKey(target.sport, target.distanceLabel);
  const common = { raceId: target.id, raceName: target.name, raceDate: target.eventDate, raceStatus, distance };
  if (distance === null) {
    return { ...common, kind: 'unsupported_distance', recent: [], olderReferences: [] };
  }

  const todayIso = toIso(today);
  const windowStartIso = toIso(subtractMonths(today, PREDICTION_WINDOW_MONTHS));

  const valid: DatedResult[] = [];
  for (const race of races) {
    if (race.status !== 'completed' || race.id === target.id) continue;
    if (!isUsableFinish(race.finishSeconds)) continue;
    if (race.sport !== target.sport || predictionDistanceKey(race.sport, race.distanceLabel) !== distance) continue;
    const parsed = parseResultDate(race.eventDate);
    if (!parsed) continue;
    const sortKey = toIso(parsed.start);
    if (parsed.yearOnly ? parsed.start.year > today.year : sortKey > todayIso) continue; // dated in the future: unusable
    valid.push({ race, finishSeconds: race.finishSeconds, yearOnly: parsed.yearOnly, sortKey, start: parsed.start });
  }

  const counted = collapseIdentical(valid);
  const recentAll = counted.filter((entry) => entry.result.sortKey >= windowStartIso);
  const olderAll = counted.filter((entry) => entry.result.sortKey < windowStartIso);
  const recent = recentAll.slice(0, PREDICTION_MAX_RESULTS);
  const recentRefs = recent.map(toRef);

  if (recent.length >= 2) {
    // Fastest and slowest of the results used; ties keep the more recent one.
    let fastest = recentRefs[0]!;
    let slowest = recentRefs[0]!;
    for (const ref of recentRefs) {
      if (ref.finishSeconds < fastest.finishSeconds) fastest = ref;
      if (ref.finishSeconds > slowest.finishSeconds) slowest = ref;
    }
    const spreadSeconds = slowest.finishSeconds - fastest.finishSeconds;
    return {
      ...common,
      kind: 'range',
      recent: recentRefs,
      olderReferences: [],
      fastest,
      slowest,
      spreadSeconds,
      spreadText: describePredictionSpread(spreadSeconds),
    };
  }

  const olderReferences = olderAll.slice(0, PREDICTION_MAX_OLDER).map((entry) => toOlderRef(entry, today));
  if (recent.length === 1) return { ...common, kind: 'single', recent: recentRefs, olderReferences };
  if (olderReferences.length > 0) return { ...common, kind: 'older_only', recent: [], olderReferences };
  return { ...common, kind: 'none', recent: [], olderReferences: [] };
}

/**
 * The basis for each upcoming race (nearest first, at most five), plus `includeRaceId` when it is a valid target that
 * the cap would otherwise drop. `today` is a plain `YYYY-MM-DD` supplied by the caller so the result is deterministic.
 * Returns an empty list for an invalid `today`.
 */
export function buildPredictionBases(races: PredictionRaceInput[], today: string, includeRaceId?: string): PredictionBasis[] {
  const day = parseDay(today);
  if (!day) return [];
  const targets = races
    .filter((race) => isTarget(race, day))
    .sort((a, b) => (a.eventDate === b.eventDate ? (a.id < b.id ? -1 : 1) : a.eventDate < b.eventDate ? -1 : 1));
  const chosen = targets.slice(0, PREDICTION_MAX_TARGETS);
  const extra = includeRaceId ? targets.find((race) => race.id === includeRaceId) : undefined;
  if (extra && !chosen.includes(extra)) chosen.push(extra);
  return chosen.map((target) => buildBasis(target, races, day));
}

/** The basis for one race, or null when it is not an upcoming race Signal can reason about. */
export function buildPredictionBasisFor(races: PredictionRaceInput[], raceId: string, today: string): PredictionBasis | null {
  const day = parseDay(today);
  const target = races.find((race) => race.id === raceId);
  if (!day || !target || !isTarget(target, day)) return null;
  return buildBasis(target, races, day);
}

/**
 * Whether Signal should proactively suggest a next-race question for this race: it must be REGISTERED (not just
 * considering) with a date of today or later, and have a historical range, meaning at least two recent comparable
 * results. A custom question is never gated by this.
 */
export function isPredictionSuggestionEligible(races: PredictionRaceInput[], raceId: string, today: string): boolean {
  const basis = buildPredictionBasisFor(races, raceId, today);
  return basis !== null && basis.raceStatus === 'registered' && basis.kind === 'range';
}
