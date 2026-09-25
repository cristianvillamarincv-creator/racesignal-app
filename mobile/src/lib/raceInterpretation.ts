import type { Race } from '@/fixtures/races';
import { canonicalDistanceLabel, getDistancePRStatuses } from '@/lib/highlights';

const DISCIPLINES = ['Swim', 'Bike', 'Run'] as const;

/**
 * Is `race`'s split for `disciplineLabel` the fastest among every completed race at the same
 * canonical distance (2+ needed to compare, matching highlights.ts's own convention)? This is a
 * narrower re-check of the same underlying facts `getFastestSplitHighlights` already computes —
 * not reused directly, because that function deliberately excludes a group's current-PB race from
 * its own badge list ("that's already covered by the distance-PR highlight"), which is exactly the
 * wrong exclusion here: we're asking whether the fact is true for the PB race itself. Exported so
 * the completed race detail screen can attach a small earned-medal indicator directly to a Swim/
 * Bike/Run split label when it's genuinely the fastest — same underlying fact this module already
 * uses for the hero interpretation sentence, not a second, separately-computed notion of "fastest."
 */
export function isFastestSplitInGroup(races: Race[], race: Race, groupKey: string, disciplineLabel: string): boolean {
  const split = race.result?.splits.find((s) => s.label === disciplineLabel);
  if (!split) return false;

  const comparableSplits = races
    .filter((r) => r.status === 'completed' && r.result && canonicalDistanceLabel(r.distanceLabel) === groupKey)
    .map((r) => r.result!.splits.find((s) => s.label === disciplineLabel))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (comparableSplits.length < 2) return false;
  const fastest = Math.min(...comparableSplits.map((s) => s.elapsedSeconds));
  return split.elapsedSeconds === fastest;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * A strictly deterministic, conservative one-line interpretation for the completed race detail's
 * hero — never a subjective claim ("strongest", "best combination"), only phrasing already-computed
 * facts. Renders nothing unless this race is a genuine current PB for its distance (not merely "was
 * a PR at the time" — see DistancePRStatus.isPRPerformance vs. isCurrentPB); optionally names
 * exactly which discipline splits verifiably belong to it. No new data, no new backend logic —
 * everything here is derived from races already loaded client-side.
 */
export function buildRaceInterpretation(races: Race[], race: Race): string | null {
  if (!race.result) return null;

  const groupKey = canonicalDistanceLabel(race.distanceLabel);
  const status = getDistancePRStatuses(races).find((s) => s.race.id === race.id);
  if (!status?.isCurrentPB) return null;

  const fastestDisciplines = DISCIPLINES.filter((label) => isFastestSplitInGroup(races, race, groupKey, label));
  const base = `Your fastest ${groupKey} to date.`;
  if (fastestDisciplines.length === 0) return base;

  const joined = joinWithAnd(fastestDisciplines.map((label) => label.toLowerCase()));
  const plural = fastestDisciplines.length > 1 ? 'splits' : 'split';
  return `Your fastest ${groupKey} to date, with your fastest ${joined} ${plural}.`;
}
