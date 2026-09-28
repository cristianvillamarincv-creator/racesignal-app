// Ported from spikes/race-recovery/src/normalize.ts (B.0). Same parsing approach — the athlete
// history page embeds its candidate list as JSON in a Next.js RSC payload rather than needing a
// second request; getsingleresult is real JSON, not HTML. Output here differs from the spike in
// one deliberate way: times are seconds (numbers), not "H:MM:SS" strings — the mobile app's data
// model already stores finishSeconds as a number and formats at render time, so we match that
// instead of introducing a second time representation.

import type { CandidateRace, RaceDetailPayload, RaceRankPayload, RaceSplitPayload } from './types.ts';
import type { RawSingleResult } from './sportstatsClient.ts';

interface RawCandidateEntry {
  rid: string;
  dts: string;
  nid: string;
  rlbl: string;
  elbl: string;
  pid: string;
}

/** See spikes/race-recovery/src/normalize.ts for the full reasoning — the athlete-history page's
 *  candidate list is embedded, double-escaped, as `"initialResults":[...]` inside a Next.js RSC
 *  flight script. We bracket-match to the closing `]` and unescape before parsing. */
export function extractInitialResults(html: string): RawCandidateEntry[] {
  const marker = '\\"initialResults\\":[';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find embedded initialResults data in athlete history page — page shape may have changed.');
  }

  const bracketStart = markerIndex + marker.length - 1;
  let depth = 0;
  let bracketEnd = -1;
  for (let i = bracketStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) {
        bracketEnd = i;
        break;
      }
    }
  }
  if (bracketEnd === -1) {
    throw new Error('Could not find the end of embedded initialResults data (unbalanced brackets).');
  }

  const rawSlice = html.slice(bracketStart, bracketEnd + 1);
  const unescaped = rawSlice.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return JSON.parse(unescaped) as RawCandidateEntry[];
}

function isoDateFromUnixSeconds(dtsSeconds: string): string {
  const date = new Date(Number(dtsSeconds) * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toCandidateRaces(rawEntries: RawCandidateEntry[]): CandidateRace[] {
  const candidates = rawEntries.map((entry) => {
    const isoDate = isoDateFromUnixSeconds(entry.dts);
    return {
      provider: 'sportstats',
      providerResultId: entry.rid,
      providerAthleteResultId: entry.pid,
      sourceUrl: `https://sportstats.one/results/${entry.rid}?focus=${entry.pid}&type=pid`,
      eventName: entry.elbl,
      category: entry.rlbl,
      eventDate: isoDate,
      eventYear: Number(isoDate.slice(0, 4)),
    };
  });
  // Newest-first everywhere a candidate list is shown (onboarding search and Find My Races) — the
  // athlete's most recent races are the ones they're most likely to recognize and want to import.
  return candidates.sort((a, b) => b.eventDate.localeCompare(a.eventDate));
}

function secondsFromMs(ms: number): number {
  // Sportstats' own UI rounds split/finish times UP to the next whole second — verified against
  // the B.0 manual benchmark (a raw 10053.03s duration displays as 2:47:34, not :33).
  return Math.ceil(ms / 1000);
}

export function parseSingleResultDetail(raw: RawSingleResult, category?: string): RaceDetailPayload {
  const participant = (raw.participantData as Record<string, unknown>[] | undefined)?.[0];
  if (!participant) {
    throw new Error('getsingleresult response had no participantData[0] — nothing to parse.');
  }

  const finishers = raw.finishers as
    | { total?: number; genders?: { finished: number; lbl: string }[]; cats?: { finished: number; lbl: string }[] }
    | undefined;

  const gender = participant.pg as string | undefined;
  const ageGroupCategory = participant.pc as string | undefined;
  const ranks = (participant.ranks as Record<string, Record<string, number | null>> | undefined)?.chip;

  const overallField = finishers?.total;
  const genderField = finishers?.genders?.find((g) => g.lbl === gender)?.finished;
  const categoryField = finishers?.cats?.find((c) => c.lbl === ageGroupCategory)?.finished;

  const overallRank: RaceRankPayload | undefined = ranks?.ro != null ? { place: ranks.ro, field: overallField } : undefined;
  const genderRank: RaceRankPayload | undefined = ranks?.rg != null ? { place: ranks.rg, field: genderField } : undefined;
  const ageGroupRank: RaceRankPayload | undefined = ranks?.rc != null ? { place: ranks.rc, field: categoryField } : undefined;

  const finishSeconds = typeof participant.ot === 'number' ? secondsFromMs(participant.ot as number) : undefined;
  const splits = parseSplits(participant.data as Record<string, Record<string, unknown>> | undefined, category);

  return {
    bib: participant.bib as string | undefined,
    ageGroupCategory,
    finishSeconds,
    overallRank,
    genderRank,
    ageGroupRank,
    splits,
  };
}

/**
 * Distance for a discipline is only ever taken from `category` — Sportstats' own event-distance
 * label, passed in by the mobile client from the candidate list (the ONE distance figure that
 * isn't derived from the same per-checkpoint `opd` odometer proven unreliable below) — matched
 * against known standardized race distances. This is deliberately NOT the provider's raw
 * cumulative-distance field on any individual checkpoint: see the single-checkpoint-only trust
 * rule in `groupIntoDisciplines` for why. Matching is substring-based, case-insensitive, since
 * Sportstats' own labels vary ("IRONMAN 70.3 Eagleman" vs "70.3", "Olympic Triathlon" vs
 * "Olympic"). Order matters — check the more specific "70.3" before "olympic" etc. never overlap.
 */
const KNOWN_TRIATHLON_DISTANCES_M: [match: string, distances: { swim: number; bike: number; run: number }][] = [
  ['70.3', { swim: 1900, bike: 90000, run: 21097 }],
  ['half iron', { swim: 1900, bike: 90000, run: 21097 }],
  ['olympic', { swim: 1500, bike: 40000, run: 10000 }],
  ['sprint', { swim: 750, bike: 20000, run: 5000 }],
];

const KNOWN_RUNNING_DISTANCES_M: [match: string, meters: number][] = [
  ['half marathon', 21097],
  ['marathon', 42195],
  ['10km', 10000],
  ['10k', 10000],
  ['5km', 5000],
  ['5k', 5000],
];

function matchKnownDistance<T>(category: string | undefined, table: [string, T][]): T | undefined {
  if (!category) return undefined;
  const normalized = category.toLowerCase();
  return table.find(([match]) => normalized.includes(match))?.[1];
}

/** "4:23" — minutes:seconds per kilometre. */
function formatPacePerKm(durationMs: number, meters: number): string | undefined {
  if (!(meters > 0) || !(durationMs > 0)) return undefined;
  const totalSecPerKm = Math.round((durationMs / 1000 / (meters / 1000)));
  const minutes = Math.floor(totalSecPerKm / 60);
  const seconds = totalSecPerKm % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`;
}

/** "2:03/100m" — swim pace, matching the convention already used elsewhere in the app. */
function formatSwimPace(durationMs: number, meters: number): string | undefined {
  if (!(meters > 0) || !(durationMs > 0)) return undefined;
  const totalSecPer100m = Math.round(durationMs / 1000 / (meters / 100));
  const minutes = Math.floor(totalSecPer100m / 60);
  const seconds = totalSecPer100m % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}/100m`;
}

/** "34.0 km/h avg" — bike speed, matching the convention already used elsewhere in the app. */
function formatBikeSpeed(durationMs: number, meters: number): string | undefined {
  if (!(meters > 0) || !(durationMs > 0)) return undefined;
  const kmh = (meters / 1000) / (durationMs / 1000 / 3600);
  if (!Number.isFinite(kmh) || kmh <= 0) return undefined;
  return `${kmh.toFixed(1)} km/h avg`;
}

interface ParsedSegment {
  cd: number;
  hasDistance: boolean;
  opd?: number;
}

interface SegmentRun {
  hasDistance: boolean;
  segments: ParsedSegment[];
}

/** Groups a chronologically-sorted segment list into maximal runs of consecutive
 *  same-`hasDistance` segments — the one structural signal proven reliable across every real
 *  payload inspected (Barrelman/Olympic, Eagleman/70.3, Toronto/Half): a segment with no `opd`
 *  (cumulative-distance) field is a discipline-transition marker, regardless of how many raw
 *  checkpoints exist within the disciplines on either side of it (Eagleman's multi-lap 70.3 bike
 *  course reports 11+ distance checkpoints for one bike leg alone — segment COUNT alone cannot
 *  tell you leg boundaries, but this hasDistance signal still can). */
function groupIntoRuns(segments: ParsedSegment[]): SegmentRun[] {
  const runs: SegmentRun[] = [];
  for (const seg of segments) {
    const current = runs[runs.length - 1];
    if (current && current.hasDistance === seg.hasDistance) {
      current.segments.push(seg);
    } else {
      runs.push({ hasDistance: seg.hasDistance, segments: [seg] });
    }
  }
  return runs;
}

interface DisciplineGrouping {
  swim: ParsedSegment[];
  /** The instant the T1 mat was crossed — from T1's OWN segment(s), never from the first bike
   *  checkpoint. Those are not the same instant: Barrelman's bike leg has exactly one checkpoint,
   *  placed at the bike's END, so treating "first bike checkpoint" as "T1 boundary" silently
   *  swallowed the entire bike leg into T1 in an earlier version of this logic. */
  t1MarkerCd: number;
  bike: ParsedSegment[];
  t2MarkerCd: number;
  /** The real run-leg checkpoints (trueRuns[2]) — kept ungrouped-with-the-finish so the trust
   *  check below can tell "exactly one checkpoint, which IS the finish" (Barrelman: trustworthy)
   *  apart from "many checkpoints, collapsed down to one Run row" (Eagleman: not trustworthy),
   *  which a pre-collapsed array can no longer distinguish. */
  runCheckpoints: ParsedSegment[];
  finishCd: number;
}

/**
 * Discipline-level triathlon grouping. A structural quirk confirmed against the real Eagleman
 * 70.3 payload: an extra no-distance "blip" checkpoint can appear between the last run-leg
 * checkpoint and the true finish line (not a real transition — just provider timing noise), which
 * would otherwise be misread as a 4th discipline. Fix: once the 3rd (Run) discipline begins, its
 * end is always the LAST segment in the whole result (`finishCd`), absorbing any such trailing
 * noise — a race can't have a transition after its final discipline starts, so nothing past that
 * point is ever a new leg.
 *
 * Relies on `groupIntoRuns` producing strictly alternating hasDistance runs (guaranteed by
 * construction — consecutive same-flag segments are always merged into one run), so once the
 * first true-run is found, the run immediately after it is always the T1 transition and the run
 * two further along is always Bike, by position — no separate lookup needed.
 */
function groupIntoDisciplines(segments: ParsedSegment[]): DisciplineGrouping | null {
  const runs = groupIntoRuns(segments);
  const trueRunIndices = runs.reduce<number[]>((acc, run, index) => {
    if (run.hasDistance) acc.push(index);
    return acc;
  }, []);
  if (trueRunIndices.length < 3) return null;

  const [swimIndex, bikeIndex, runIndex] = trueRunIndices;
  const t1Index = swimIndex! + 1;
  const t2Index = bikeIndex! + 1;
  // Confirms the expected T,F,T,F,T shape rather than assuming it — guaranteed true whenever
  // bikeIndex/runIndex land exactly 2 runs after the previous true-run (i.e. exactly one
  // transition run separates them), which alternation makes automatic in every real payload seen,
  // but this still bails out safely to the generic fallback below if that shape doesn't hold.
  if (bikeIndex !== swimIndex! + 2 || runIndex !== bikeIndex! + 2 || runs[t1Index]?.hasDistance || runs[t2Index]?.hasDistance) {
    return null;
  }

  return {
    swim: runs[swimIndex!]!.segments,
    t1MarkerCd: runs[t1Index]!.segments[runs[t1Index]!.segments.length - 1]!.cd,
    bike: runs[bikeIndex!]!.segments,
    t2MarkerCd: runs[t2Index]!.segments[runs[t2Index]!.segments.length - 1]!.cd,
    runCheckpoints: runs[runIndex!]!.segments,
    finishCd: segments[segments.length - 1]!.cd,
  };
}

function elapsedMs(fromCd: number, toCd: number): number {
  return toCd - fromCd;
}

/**
 * Best-effort split parsing. See B1_ARCHITECTURE.md / the P1-8 investigation notes for the full
 * reasoning against real Barrelman (Olympic), Eagleman (70.3), and Toronto Marathon (Half)
 * payloads — the short version:
 *
 * - `st` ("split time") is NOT consistently "time since the previous checkpoint" — confirmed
 *   against Eagleman's raw payload it's sometimes "time since the current discipline started"
 *   instead, with no way to tell which from the field alone. Every duration below is computed
 *   from `cd` (cumulative time), which IS reliably monotonic in every payload inspected.
 * - `opd` (cumulative distance) is NOT trustworthy for a discipline with more than one checkpoint
 *   — Eagleman's multi-lap bike course reports `opd` values far beyond the real 90km bike leg,
 *   and Toronto's half-marathon checkpoints report km values beyond the real 21.1km course
 *   (course markers shared with the full-marathon route). It IS trustworthy for a
 *   single-checkpoint discipline (Barrelman's swim/bike/run each cross exactly one mat, and the
 *   resulting distances match the Olympic-standard 1.5K/40K/10K exactly) — so single-checkpoint
 *   provider distance is trusted; anything else falls back to a known standardized category
 *   distance, and if the category isn't recognized, no pace/speed is computed at all.
 */
function parseSplits(data: Record<string, Record<string, unknown>> | undefined, category?: string): RaceSplitPayload[] {
  if (!data) return [];

  const segments: ParsedSegment[] = Object.values(data)
    .map((seg) => {
      const cd = seg.cd as number | undefined;
      const st = seg.st as number | null | undefined;
      const opd = (seg.pace as Record<string, unknown> | undefined)?.opd as number | undefined;
      // `pace.opd` (cumulative provider distance) was the original discipline-transition signal —
      // still honored when present (e.g. cached fixtures). Confirmed against 7 real payloads
      // fetched live on 2026-09-28 (Eagleman/Gulf Coast/Syracuse 70.3s, two Olympic-distance
      // Barrelman-style races, two running races): the live public endpoint no longer returns a
      // `pace` object on any checkpoint at all, which previously made every checkpoint look like a
      // transition marker and collapsed every triathlon race to a flat "Checkpoint N" list. `ps` (a
      // numeric pace/rank figure, never a distance) is reliably present on every real in-discipline
      // checkpoint and absent on every real transition marker in all 7 live payloads, so it's used
      // as a fallback structural signal only — never as a distance. `opd` itself is left untouched
      // (still sourced only from `pace.opd`), so a leg's actual distance/pace is only ever computed
      // from provider data proven trustworthy, never guessed from `ps`.
      const ps = seg.ps as number | null | undefined;
      const hasDistance = typeof opd === 'number' || typeof ps === 'number';
      return { cd, st, hasDistance, opd };
    })
    // Drop the race-start marker (cd=0, conveys nothing beyond "zero elapsed at the start") and
    // any entry with neither a duration nor a distance (confirmed against Barrelman's raw
    // payload: a synthetic "overall average pace" entry shares the finish line's timestamp but
    // carries no usable data of its own).
    .filter((seg): seg is ParsedSegment & { cd: number } => typeof seg.cd === 'number' && seg.cd > 0 && (seg.st != null || seg.hasDistance))
    .map((seg) => ({ cd: seg.cd, hasDistance: seg.hasDistance, opd: seg.opd }))
    .sort((a, b) => a.cd - b.cd);

  if (segments.length === 0) return [];

  const disciplines = groupIntoDisciplines(segments);

  if (disciplines) {
    const triDistances = matchKnownDistance(category, KNOWN_TRIATHLON_DISTANCES_M);
    const { swim, t1MarkerCd, bike, t2MarkerCd, runCheckpoints, finishCd } = disciplines;

    const swimEndCd = swim[swim.length - 1]!.cd;
    const bikeEndCd = bike[bike.length - 1]!.cd;

    const swimMs = elapsedMs(0, swimEndCd);
    const t1Ms = elapsedMs(swimEndCd, t1MarkerCd);
    const bikeMs = elapsedMs(t1MarkerCd, bikeEndCd);
    const t2Ms = elapsedMs(bikeEndCd, t2MarkerCd);
    const runMs = elapsedMs(t2MarkerCd, finishCd);

    // Trust the provider's own cumulative distance only when exactly one checkpoint marks the
    // whole discipline AND that checkpoint actually carries a real `opd` (see the function-level
    // comment) — otherwise fall back to the known category distance, and if that's not recognized
    // either, show no pace at all rather than guess. For Run specifically, that one checkpoint must
    // also BE the finish (a lone mid-run checkpoint followed by more unaccounted-for noise isn't
    // the same as a mat placed at the true finish line).
    //
    // The `typeof ... === 'number'` guards matter now that `hasDistance`/leg-boundary detection can
    // succeed from `ps` alone with no `opd` on any checkpoint (the current live payload shape) — a
    // single-checkpoint leg with no real opd must fall back to `triDistances` exactly like a
    // multi-checkpoint one, never silently show no pace when a perfectly good category distance is
    // available.
    const swimEndOpd = swim[swim.length - 1]!.opd;
    const bikeEndOpd = bike[bike.length - 1]!.opd;
    const swimDistanceM = swim.length === 1 && typeof swim[0]!.opd === 'number' ? swim[0]!.opd : triDistances?.swim;
    const bikeDistanceM =
      bike.length === 1 && typeof bike[0]!.opd === 'number' && typeof swimEndOpd === 'number'
        ? bike[0]!.opd! - swimEndOpd
        : triDistances?.bike;
    const runDistanceM =
      runCheckpoints.length === 1 &&
      runCheckpoints[0]!.cd === finishCd &&
      typeof runCheckpoints[0]!.opd === 'number' &&
      typeof bikeEndOpd === 'number'
        ? runCheckpoints[0]!.opd! - bikeEndOpd
        : triDistances?.run;

    return [
      { label: 'Swim', splitSeconds: secondsFromMs(swimMs), totalSeconds: secondsFromMs(swimEndCd), pace: swimDistanceM ? formatSwimPace(swimMs, swimDistanceM) : undefined },
      { label: 'T1', splitSeconds: secondsFromMs(t1Ms), totalSeconds: secondsFromMs(t1MarkerCd) },
      { label: 'Bike', splitSeconds: secondsFromMs(bikeMs), totalSeconds: secondsFromMs(bikeEndCd), pace: bikeDistanceM ? formatBikeSpeed(bikeMs, bikeDistanceM) : undefined },
      { label: 'T2', splitSeconds: secondsFromMs(t2Ms), totalSeconds: secondsFromMs(t2MarkerCd) },
      { label: 'Run', splitSeconds: secondsFromMs(runMs), totalSeconds: secondsFromMs(finishCd), pace: runDistanceM ? formatPacePerKm(runMs, runDistanceM) : undefined },
    ];
  }

  // Not a recognizable triathlon shape (0 or 1 transition markers) — a running race, or data too
  // sparse/unusual to safely assume a 3-leg structure. Show real checkpoints with real elapsed
  // times, but never a provider km label (proven misleading on a shared-course race like Toronto's
  // half marathon) — only the Finish gets a distance/pace, and only from a known category, never
  // from the per-checkpoint `opd` odometer.
  const runningDistanceM = matchKnownDistance(category, KNOWN_RUNNING_DISTANCES_M);
  let previousCd = 0;
  return segments.map((seg, index) => {
    const isLast = index === segments.length - 1;
    const splitMs = elapsedMs(previousCd, seg.cd);
    previousCd = seg.cd;
    return {
      label: isLast ? 'Finish' : `Checkpoint ${index + 1}`,
      splitSeconds: secondsFromMs(splitMs),
      totalSeconds: secondsFromMs(seg.cd),
      pace: isLast && runningDistanceM ? formatPacePerKm(seg.cd, runningDistanceM) : undefined,
    };
  });
}
