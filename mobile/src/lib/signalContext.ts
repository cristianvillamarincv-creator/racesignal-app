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
  /** `legRank` (the athlete's rank in that leg against the same race field) mirrors the Edge Function's optional field. The
   *  app's race model carries no per-leg rankings, so nothing here populates it today; suggestion eligibility reads it so a
   *  strongest-discipline question appears only once such evidence actually exists in the context. */
  splits?: { label: string; elapsedSeconds: number; paceLabel?: string; legRank?: SignalRank }[];
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

/** True when some race in the context carries the athlete's swim, bike, and run leg ranks against the same race field: the
 *  only evidence that can support a strongest-discipline answer. Duration, overall placement, and standalone running
 *  results do not qualify. The race model has no per-leg rankings today, so this is false for every real account. */
export function hasComparableLegRanks(context: SignalContext): boolean {
  const races = [...(context.seedRace ? [context.seedRace] : []), ...context.sameSportDetailed];
  return races.some((race) => ['swim', 'bike', 'run'].every((leg) => race.splits?.some((split) => split.label.toLowerCase() === leg && split.legRank)));
}

/** Completed races with a finish time, grouped by sport and canonical distance; only groups with two or more races are
 *  comparable like for like. */
function sameDistanceGroups(races: Race[]): Race[][] {
  const groups = new Map<string, Race[]>();
  for (const race of getCompletedRaces(races)) {
    if (race.result?.finishSeconds === undefined) continue;
    const key = `${race.sport}|${canonicalDistanceLabel(race.distanceLabel)}`;
    groups.set(key, [...(groups.get(key) ?? []), race]);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

/** Completed history Signal can reason from for a next-race question: at least one completed race with a finish time. */
export function hasCompletedResults(races: Race[]): boolean {
  return getCompletedRaces(races).some((race) => race.result?.finishSeconds !== undefined);
}

const MAX_PERSONAL_BEST_PROMPTS = 2;

/**
 * Deterministic, template-based suggested prompts, never model-generated. A question is offered only when the evidence it
 * needs is present in the context Signal would actually receive (buildSignalContext for the same races and seed): nothing
 * fills an empty slot, and a custom question is always available in the composer.
 *
 *  - strongest discipline: comparable swim, bike, and run leg ranks (hasComparableLegRanks)
 *  - improvement or comparison: two or more completed results at the same sport and distance
 *  - where did I lose time: two or more splits on the race
 *  - personal best / race summary: a completed race with a finish time
 *  - next-race questions: an upcoming race plus completed history to reason from
 */
export function getSuggestedPrompts(races: Race[], seedRaceId?: string): string[] {
  const seedRace = seedRaceId ? races.find((race) => race.id === seedRaceId) : undefined;
  const context = buildSignalContext(races, seedRaceId);
  const completed = getCompletedRaces(races).filter((race) => race.result?.finishSeconds !== undefined);
  const nextRace = getUpcomingRaces(races)[0];

  if (!seedRace) {
    const prompts: string[] = [];
    if (hasComparableLegRanks(context)) prompts.push("What's my strongest discipline?");
    if (sameDistanceGroups(races).length > 0) prompts.push('Have I been improving year over year?');
    // Personal-best questions for the distances raced most recently (only distances that have a current PB in the context).
    const recentFirst = [...completed].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
    const distances: string[] = [];
    for (const race of recentFirst) {
      const distance = canonicalDistanceLabel(race.distanceLabel);
      if (!distances.includes(distance) && context.bestPerDistance.some((best) => best.canonicalDistance === distance)) distances.push(distance);
    }
    for (const distance of distances.slice(0, MAX_PERSONAL_BEST_PROMPTS)) prompts.push(`What's my ${distance} personal best?`);
    const mostRecent = recentFirst[0];
    if (mostRecent) prompts.push(`How did my ${mostRecent.name} go?`);
    if (nextRace && completed.length > 0) prompts.push(`What does my history suggest for ${nextRace.name}?`);
    return prompts;
  }

  if (seedRace.status !== 'completed') {
    // A prediction needs completed history to reason from; without it there is nothing to suggest.
    if (completed.length === 0) return [];
    return ['What does my history suggest for this race?', 'What evidence would improve this prediction?'];
  }

  const prompts: string[] = [];
  if (seedRace.result?.finishSeconds !== undefined) prompts.push('Analyze this race', 'What went well?');

  const splits = seedRace.result?.splits ?? [];
  if (splits.length > 1) prompts.push('Where did I lose the most time?');

  const seedDetail = context.seedRace;
  if (seedDetail && hasComparableLegRanks({ ...context, sameSportDetailed: [], seedRace: seedDetail })) {
    prompts.push('What was my strongest discipline?');
  }

  const seedKey = `${seedRace.sport}|${canonicalDistanceLabel(seedRace.distanceLabel)}`;
  const hasComparableResult = sameDistanceGroups(races).some(
    (group) => group.some((race) => race.id === seedRace.id) && `${group[0]!.sport}|${canonicalDistanceLabel(group[0]!.distanceLabel)}` === seedKey,
  );
  if (hasComparableResult) prompts.push(`How does this compare with my other ${seedRace.distanceLabel} races?`);

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
