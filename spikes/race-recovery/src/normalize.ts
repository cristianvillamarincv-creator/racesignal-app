import type { KnownRaceAnchor, RaceCandidate, RaceCandidateDetail, RaceRank, RaceSplit } from './types.js';
import type { RawSingleResult } from './sportstatsClient.js';

interface RawCandidateEntry {
  rid: string;
  dts: string;
  slug: string;
  lo1?: string;
  lo2?: string;
  lo3?: string;
  nid: string;
  eid: string;
  rlbl: string;
  elbl: string;
  pid: string;
  pdn: string;
}

/**
 * The athlete-history page embeds its full candidate list as a JSON array inside a Next.js RSC
 * flight script, double-escaped (the page is itself a JS string literal containing JSON). We
 * locate `"initialResults":[` (still escaped) and bracket-match to the closing `]`, then unescape
 * before parsing. This is reading data the server already put in the response — not calling any
 * additional endpoint, not executing the page's JS.
 */
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

function formatDateFromUnixSeconds(dtsSeconds: string): string {
  const date = new Date(Number(dtsSeconds) * 1000);
  // Use UTC components: the provider's timestamp isn't guaranteed to align with the runner's
  // local timezone, and we only need a calendar date, not a moment in time.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function matchesKnownRace(entry: RawCandidateEntry, anchor: KnownRaceAnchor): boolean {
  const nameMatch = entry.elbl.toLowerCase().includes(anchor.eventQuery.toLowerCase());
  const year = new Date(Number(entry.dts) * 1000).getUTCFullYear();
  return nameMatch && year === anchor.approximateYear;
}

/**
 * Raw candidates -> RaceCandidate[]. Dedup rule per B.0 approval: only collapse EXACT duplicate
 * `rid` values. Two different result IDs that look like the same event/category (e.g. a "10km"
 * and an "Infinite Mile" entry on the same date) are both kept as separate candidates — no
 * semantic/fuzzy dedup in this spike.
 */
export function toRaceCandidates(
  rawEntries: RawCandidateEntry[],
  searchedName: string,
  knownRaces: KnownRaceAnchor[] = [],
): RaceCandidate[] {
  const seenResultIds = new Set<string>();
  const candidates: RaceCandidate[] = [];

  for (const entry of rawEntries) {
    if (seenResultIds.has(entry.rid)) continue;
    seenResultIds.add(entry.rid);

    const matchedAnchor = knownRaces.find((anchor) => matchesKnownRace(entry, anchor));
    const matchEvidence = [`listed under Sportstats athlete profile for "${searchedName}" (nid=${entry.nid})`];
    let confidence: RaceCandidate['confidence'] = 'MEDIUM';
    if (matchedAnchor) {
      matchEvidence.push(`matches known anchor "${matchedAnchor.eventQuery}" ~${matchedAnchor.approximateYear}`);
      confidence = 'HIGH';
    }

    candidates.push({
      provider: 'sportstats',
      providerResultId: entry.rid,
      sourceUrl: `https://sportstats.one/results/${entry.rid}?focus=${entry.pid}&type=pid`,
      athleteName: entry.pdn,
      eventName: entry.elbl,
      eventDateRaw: formatDateFromUnixSeconds(entry.dts),
      category: entry.rlbl,
      claimedOnProvider: false, // every entry on this page was observed as "Unclaimed" in manual testing
      matchEvidence,
      confidence,
    });
  }

  return candidates;
}

function msToClock(ms: number): string {
  // Sportstats' own UI displays split/finish times rounded UP to the next whole second (verified
  // against the manual benchmark: e.g. a raw 10053.03s duration displays as 2:47:34, not :33) —
  // matched here with Math.ceil rather than nearest-rounding.
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Parses the `getsingleresult` JSON into our normalized detail shape. This endpoint's fields are
 * undocumented (single-letter keys), so every read here was reverse-mapped by comparing against
 * the manual browser benchmark (see acceptanceCheck.ts) rather than assumed from a spec:
 *   - participantData[0].bib, .pc (category), .ranks.chip.{ro,rg,rc} (overall/gender/category
 *     place), .ot (total elapsed ms)
 *   - finishers.total / finishers.genders[] / finishers.cats[] for the matching field sizes
 *   - participantData[0].data{} = one entry per timing segment, keyed by an opaque segment ID
 */
export function parseSingleResultDetail(raw: RawSingleResult): RaceCandidateDetail {
  const participant = (raw.participantData as Record<string, unknown>[] | undefined)?.[0];
  if (!participant) {
    throw new Error('getsingleresult response had no participantData[0] — nothing to parse.');
  }

  const finishers = raw.finishers as
    | { total?: number; genders?: { finished: number; lbl: string }[]; cats?: { finished: number; lbl: string }[] }
    | undefined;

  const gender = participant.pg as string | undefined;
  const category = participant.pc as string | undefined;
  const ranks = (participant.ranks as Record<string, Record<string, number | null>> | undefined)?.chip;

  const overallField = finishers?.total;
  const genderField = finishers?.genders?.find((g) => g.lbl === gender)?.finished;
  const categoryField = finishers?.cats?.find((c) => c.lbl === category)?.finished;

  const overallRank: RaceRank | undefined =
    ranks?.ro != null ? { place: ranks.ro, field: overallField } : undefined;
  const genderRank: RaceRank | undefined =
    ranks?.rg != null ? { place: ranks.rg, field: genderField } : undefined;
  const ageGroupRank: RaceRank | undefined =
    ranks?.rc != null ? { place: ranks.rc, field: categoryField } : undefined;

  const finishTime = typeof participant.ot === 'number' ? msToClock(participant.ot as number) : undefined;

  const splits = parseSplits(participant.data as Record<string, Record<string, unknown>> | undefined);

  return {
    bib: participant.bib as string | undefined,
    ageGroupCategory: category,
    finishTime,
    overallRank,
    genderRank,
    ageGroupRank,
    splits,
  };
}

/**
 * Best-effort split labeling. Segments are sorted by cumulative duration (`cd`). A segment with a
 * `pace.opd` (cumulative distance) is a timed "leg"; one without is a transition. When the shape
 * matches a standard triathlon (3 legs + 2 transitions + a final duplicate finish node — verified
 * against the Barrelman benchmark), we label Swim/T1/Bike/T2/Run/Finish. Otherwise (e.g. a
 * single-sport running race with distance checkpoints) we fall back to generic, still-honest
 * labels rather than guessing race-specific checkpoint names we can't verify.
 */
function parseSplits(data: Record<string, Record<string, unknown>> | undefined): RaceSplit[] {
  if (!data) return [];

  const segments = Object.values(data)
    .map((seg) => ({
      cd: seg.cd as number | undefined,
      st: seg.st as number | null | undefined,
      hasDistance: typeof (seg.pace as Record<string, unknown> | undefined)?.opd === 'number',
      opd: (seg.pace as Record<string, unknown> | undefined)?.opd as number | undefined,
      pace: (seg.pace as Record<string, unknown> | undefined)?.pkm as string | undefined,
    }))
    .filter((seg): seg is typeof seg & { cd: number } => typeof seg.cd === 'number')
    .sort((a, b) => a.cd - b.cd);

  if (segments.length === 0) return [];

  const legCount = segments.filter((s) => s.hasDistance).length;
  const isStandardTriathlonShape = segments.length === 6 && legCount === 3;
  const triathlonLabels = ['Swim', 'T1', 'Bike', 'T2', 'Run', 'Finish'];

  return segments.map((seg, index) => {
    const isLast = index === segments.length - 1;
    let label: string;
    if (isStandardTriathlonShape) {
      label = triathlonLabels[index] ?? `Split ${index + 1}`;
    } else if (isLast) {
      label = 'Finish';
    } else if (seg.hasDistance && seg.opd) {
      label = `${(seg.opd / 1000).toFixed(1)} km`;
    } else {
      label = `Split ${index + 1}`;
    }

    const splitMs = seg.st ?? seg.cd;
    return {
      label,
      splitTime: splitMs != null ? msToClock(splitMs) : undefined,
      totalTime: msToClock(seg.cd),
      pace: seg.pace,
    };
  });
}
