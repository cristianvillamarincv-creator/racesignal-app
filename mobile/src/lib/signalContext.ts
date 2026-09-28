import type { Race, RaceRank } from '@/fixtures/races';
import { getTopPercentile } from '@/lib/format';
import { canonicalDistanceLabel, getDistancePRStatuses, getHighlightsForRace } from '@/lib/highlights';
import { getCompletedRaces, getUpcomingRaces } from '@/lib/races';

/**
 * Signal's context payload — mirrors (but does not import — separate Deno vs mobile TypeScript
 * projects, same reasoning as raceMapping.ts/normalize.ts) `supabase/functions/signal/types.ts`.
 * Built client-side, since the app already holds and correctly computes this athlete's race data;
 * sent as-is to the `signal` Edge Function, which trusts it except for one server-side ownership
 * check on `seedRace.id` (see the Step 5 plan's "trust model" section).
 *
 * Tiered by SPORT, not by distance: a same-canonical-distance-only rule would demote a real,
 * relevant race (e.g. Eagleman 70.3 when the seed is a full-distance IRONMAN) to a bare compact
 * record on exactly the question it's the evidence for. Same-sport races always get full detail;
 * same-canonical-distance ones are only prioritized in ORDER, never used as an exclusion filter.
 */

export interface SignalRank {
  place: number;
  field?: number;
  percentile?: number;
}

/** A precomputed, already-signed time difference vs the seed race — "app computes facts, model
 *  explains them" for exactly the kind of subtraction a model can get wrong doing it itself (see
 *  the Step 5 stabilization pass: a real eval run miscalculated a run-leg time difference from raw
 *  split seconds). Positive `deltaSeconds` means this race was slower than the seed. */
export interface SignalTimeDelta {
  label: string;
  deltaSeconds: number;
  description: string;
}

export interface SignalRaceDetail {
  id: string;
  name: string;
  sport: string;
  distanceLabel: string;
  eventDate: string;
  location: string;
  finishSeconds?: number;
  splits?: { label: string; elapsedSeconds: number; paceLabel?: string }[];
  overallRank?: SignalRank;
  genderRank?: SignalRank;
  ageGroupRank?: SignalRank;
  highlights: string[];
  notes: string[];
  /** Only present on races in `sameSportDetailed`, and only when a seed race exists — precomputed
   *  Finish + matching-split-label deltas vs the seed, so the model never has to subtract raw
   *  split seconds itself. */
  timeDeltasVsSeed?: SignalTimeDelta[];
}

/** The athlete's single fastest result in each comparable distance group (reusing the same
 *  current-PB logic that powers Stats' real Personal Bests ladder — never a second definition of
 *  "best"), with that group's own percentiles. Exists specifically so the model has one
 *  unambiguous, correctly-scoped percentile per distance to point to, instead of having to recall
 *  and risk generalizing a percentile from one race onto a different distance. */
export interface SignalDistanceBest {
  canonicalDistance: string;
  raceName: string;
  finishSeconds: number;
  overallPercentile?: number;
  ageGroupPercentile?: number;
}

export interface SignalCompactRace {
  id: string;
  name: string;
  sport: string;
  distanceLabel: string;
  eventDate: string;
  location?: string;
  finishSeconds?: number;
}

export interface SignalContext {
  seedRace?: SignalRaceDetail;
  sameSportDetailed: SignalRaceDetail[];
  otherSportsCompact: SignalCompactRace[];
  upcoming: SignalCompactRace[];
  /** One entry per distance group the athlete has raced — see SignalDistanceBest. */
  bestPerDistance: SignalDistanceBest[];
}

function formatSignedDuration(deltaSeconds: number): string {
  if (deltaSeconds === 0) return 'even';
  const abs = Math.abs(deltaSeconds);
  const minutes = Math.floor(abs / 60);
  const seconds = Math.round(abs % 60);
  const magnitude = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return deltaSeconds > 0 ? `${magnitude} slower than the seed race` : `${magnitude} faster than the seed race`;
}

/** Finish + matching-split-label deltas vs the seed race, in seconds — computed once here so the
 *  model only ever reads an already-correct, already-signed difference. */
function computeDeltasVsSeed(race: Race, seedRace: Race): SignalTimeDelta[] {
  const deltas: SignalTimeDelta[] = [];
  if (race.result?.finishSeconds !== undefined && seedRace.result?.finishSeconds !== undefined) {
    const deltaSeconds = race.result.finishSeconds - seedRace.result.finishSeconds;
    deltas.push({ label: 'Finish', deltaSeconds, description: formatSignedDuration(deltaSeconds) });
  }

  const seedSplitSeconds = new Map((seedRace.result?.splits ?? []).map((split) => [split.label, split.elapsedSeconds]));
  for (const split of race.result?.splits ?? []) {
    const seedSeconds = seedSplitSeconds.get(split.label);
    if (seedSeconds === undefined) continue;
    const deltaSeconds = split.elapsedSeconds - seedSeconds;
    deltas.push({ label: split.label, deltaSeconds, description: formatSignedDuration(deltaSeconds) });
  }
  return deltas;
}

/** Reuses getDistancePRStatuses (the same current-PB logic behind Stats' real Personal Bests
 *  ladder) rather than a second "what's fastest" definition — one entry per distance group, each
 *  with only that group's own percentiles. */
function computeBestPerDistance(races: Race[]): SignalDistanceBest[] {
  return getDistancePRStatuses(races)
    .filter((status) => status.isCurrentPB)
    .map((status) => {
      const result = status.race.result!;
      return {
        canonicalDistance: status.groupKey,
        raceName: status.race.name,
        finishSeconds: result.finishSeconds,
        overallPercentile: result.overallRank?.field !== undefined ? getTopPercentile(result.overallRank.place, result.overallRank.field) : undefined,
        ageGroupPercentile: result.ageGroupRank?.field !== undefined ? getTopPercentile(result.ageGroupRank.place, result.ageGroupRank.field) : undefined,
      };
    });
}

function toSignalRank(rank?: RaceRank): SignalRank | undefined {
  if (!rank) return undefined;
  return {
    place: rank.place,
    field: rank.field,
    percentile: rank.field !== undefined ? getTopPercentile(rank.place, rank.field) : undefined,
  };
}

function toDetailed(race: Race, races: Race[], seedRace?: Race): SignalRaceDetail {
  const highlights = getHighlightsForRace(races, race.id).map((highlight) => highlight.label);
  const notes: string[] = [...(race.result?.sourceNotes ?? [])];
  if (race.result?.needsConfirmation) {
    notes.push('The source gave no usable rank/placement data for this race.');
  }
  if (race.result?.rankingNeedsConfirmation) {
    notes.push("This race's rank numbers look internally inconsistent in the source — treat with caution.");
  }

  return {
    id: race.id,
    name: race.name,
    sport: race.sport,
    distanceLabel: race.distanceLabel,
    eventDate: race.eventDate,
    location: race.location,
    finishSeconds: race.result?.finishSeconds,
    splits: race.result?.splits.map((split) => ({
      label: split.label,
      elapsedSeconds: split.elapsedSeconds,
      paceLabel: split.paceLabel,
    })),
    overallRank: toSignalRank(race.result?.overallRank),
    genderRank: toSignalRank(race.result?.genderRank),
    ageGroupRank: toSignalRank(race.result?.ageGroupRank),
    highlights,
    notes,
    timeDeltasVsSeed: seedRace && seedRace.id !== race.id ? computeDeltasVsSeed(race, seedRace) : undefined,
  };
}

function toCompact(race: Race): SignalCompactRace {
  return {
    id: race.id,
    name: race.name,
    sport: race.sport,
    distanceLabel: race.distanceLabel,
    eventDate: race.eventDate,
    location: race.location || undefined,
    finishSeconds: race.result?.finishSeconds,
  };
}

/**
 * @param seedRaceId The race the conversation was opened from, if any (Result Detail / upcoming
 *   Race Detail). Undefined for an unseeded chat (the Signal tab's plain "Ask Signal" CTA).
 */
export function buildSignalContext(races: Race[], seedRaceId?: string): SignalContext {
  const seedRace = seedRaceId ? races.find((race) => race.id === seedRaceId) : undefined;
  const otherCompleted = getCompletedRaces(races).filter((race) => race.id !== seedRace?.id);
  const upcoming = getUpcomingRaces(races);

  let sameSportRaces: Race[];
  let otherSportsRaces: Race[];

  if (seedRace) {
    sameSportRaces = otherCompleted.filter((race) => race.sport === seedRace.sport);
    otherSportsRaces = otherCompleted.filter((race) => race.sport !== seedRace.sport);

    const seedDistance = canonicalDistanceLabel(seedRace.distanceLabel);
    sameSportRaces = [...sameSportRaces].sort((a, b) => {
      const aMatches = canonicalDistanceLabel(a.distanceLabel) === seedDistance ? 0 : 1;
      const bMatches = canonicalDistanceLabel(b.distanceLabel) === seedDistance ? 0 : 1;
      return aMatches - bMatches;
    });
  } else {
    // No seed race: this athlete's history is small enough that every completed race can get full
    // detail without a sport to bias toward — nothing left over for the "other sports" tier.
    sameSportRaces = otherCompleted;
    otherSportsRaces = [];
  }

  return {
    seedRace: seedRace ? toDetailed(seedRace, races) : undefined,
    sameSportDetailed: sameSportRaces.map((race) => toDetailed(race, races, seedRace)),
    otherSportsCompact: otherSportsRaces.map(toCompact),
    upcoming: upcoming.map(toCompact),
    bestPerDistance: computeBestPerDistance(races),
  };
}

/**
 * Deterministic, template-based suggested prompts — never model-generated — keyed off the seed
 * race's own shape. No seed race (the Signal tab's unseeded "Ask Signal" entry) gets generic
 * questions instead.
 */
export function getSuggestedPrompts(races: Race[], seedRaceId?: string): string[] {
  const seedRace = seedRaceId ? races.find((race) => race.id === seedRaceId) : undefined;

  if (!seedRace) {
    return [
      "What's my strongest discipline overall?",
      'Have I been improving year over year?',
      'What would most improve my next race?',
    ];
  }

  if (seedRace.status !== 'completed') {
    return [
      'What does my history suggest for this race?',
      'What should I expect going in?',
      'What evidence would improve this prediction?',
    ];
  }

  const prompts = ['Analyze this race', 'What went well?'];

  // Task 3.2 (chip relevance) — a detailed "where did I lose time" question implies real split
  // data to point to; without any splits at all there's nothing for Signal to break down, so never
  // offer it. Checked before anything else that also depends on `splits` below.
  const splits = seedRace.result?.splits ?? [];
  if (splits.length > 0) prompts.push('Where did I lose the most time?');

  // A discipline-breakdown question ("swim/bike/run") only ever makes sense for a genuinely
  // multi-discipline race — never for a standalone running/cycling/swimming race, even though this
  // same athlete may also have triathlons elsewhere in their history (that's a different race, not
  // this one). Distinct split LABELS alone isn't enough either: a running race can have several
  // checkpoint splits (e.g. "5K"/"10K"/"Half"), and — the B.12 device-QA regression — a triathlon
  // whose provider payload didn't classify into disciplines falls back to per-checkpoint labels
  // ("Checkpoint 1", "Checkpoint 2", ...), which are all mutually distinct too. Neither case is a
  // real discipline breakdown, so this counts actual Swim/Bike/Run-labeled splits specifically
  // (matching the same label convention results/[id].tsx uses to lay out the primary splits row),
  // not just "how many differently-labeled rows exist."
  const isMultiDisciplineSport = seedRace.sport === 'triathlon' || seedRace.sport === 'duathlon';
  const PRIMARY_DISCIPLINE_LABELS = ['Swim', 'Bike', 'Run'];
  const disciplineCount = new Set(
    splits.map((split) => split.label).filter((label) => PRIMARY_DISCIPLINE_LABELS.some((discipline) => label.startsWith(discipline))),
  ).size;
  if (isMultiDisciplineSport && disciplineCount > 1) prompts.push('What was my strongest discipline?');

  const hasComparableRace = getCompletedRaces(races).some(
    (race) => race.id !== seedRace.id && race.sport === seedRace.sport,
  );
  if (hasComparableRace) prompts.push(`How does this compare with my other ${seedRace.sport} races?`);

  const nextRace = getUpcomingRaces(races)[0];
  if (nextRace) prompts.push(`What does this suggest for ${nextRace.name}?`);

  return prompts;
}

const CONVERSATION_TITLE_MAX_LENGTH = 60;

/**
 * Deterministic V1 conversation title — never a separate model call just to title a chat.
 * Computed once, when a conversation is first persisted (see signal.tsx): a seeded completed race
 * gets "[Race name] race analysis", a seeded upcoming race gets the bare race name, and an
 * unseeded conversation is titled from the athlete's own first message, safely truncated.
 */
export function buildConversationTitle(seedRace: Race | undefined, firstUserMessage: string): string {
  if (seedRace) {
    return seedRace.status === 'completed' ? `${seedRace.name} race analysis` : seedRace.name;
  }
  const trimmed = firstUserMessage.trim();
  if (trimmed.length <= CONVERSATION_TITLE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, CONVERSATION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
