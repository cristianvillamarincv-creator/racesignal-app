import type { Race, RaceSplit, SportCategory } from '@/fixtures/races';
import { formatFinishTime, formatOrdinal, getTopPercentile } from '@/lib/format';
import type { IconName } from '@/lib/icons';
import { yearOf } from '@/lib/races';

/**
 * Every highlight here is COMPUTED from the real race list, never authored — with real numbers,
 * a hand-written "PR" label risks silently disagreeing with the data. Every highlight references
 * the specific race it came from (`race`), per the product requirement that highlights must be
 * traceable to a source result.
 */
export interface Highlight {
  race: Race;
  icon: IconName;
  label: string;
  value?: string;
}

/** Distances that aren't comparable to anything else in the dataset — never enter a PR ladder. */
const EXCLUDED_FROM_PR_LADDER = new Set<string>(['Custom — 2K/55K/15K']);

/**
 * `distanceLabel` is either Sportstats' own raw category text (`rlbl`) or whatever the athlete
 * free-typed on the manual-add form — never something the app itself standardizes at write time.
 * Confirmed directly against this athlete's data: the SAME real-world distance can show up under
 * more than one exact string ("10k" from a manual entry vs "10km" from Sportstats; "70.3" for one
 * Sportstats race vs "70.3 Results" for another; "Olympic" (manual) vs "Olympic Triathlon"
 * (Sportstats)). Every PR/PB/fastest-split comparison below groups races by this label — grouping
 * by the raw string let a lone race in a mis-spelled variant's group trivially "win" that group
 * (e.g. a manual 10K entered as "10k" became the 10K PB purely because no real Sportstats "10k"
 * race existed to compare it against, even though a real "10km" race was 10 minutes faster).
 *
 * This maps ONLY exact, case-insensitive matches against variants actually observed in real data
 * to one canonical label — never fuzzy/similarity matching, so two genuinely different formats
 * (e.g. "Long Course Triathlon", which is NOT confirmed to be 70.3-equivalent) are never merged on
 * a guess. Anything not in this table passes through unchanged.
 */
const CANONICAL_DISTANCE_ALIASES: Record<string, string> = {
  '5k': '5K',
  '5km': '5K',
  '5 km': '5K',
  '10k': '10K',
  '10km': '10K',
  '70.3': '70.3',
  '70.3 results': '70.3',
  olympic: 'Olympic',
  'olympic triathlon': 'Olympic',
};

/** The one place a raw `distanceLabel` becomes a comparison-group key — used for PR/PB/fastest-
 *  split grouping and their labels, never for a per-race detail screen's own display of what its
 *  source actually recorded (that stays literal). */
export function canonicalDistanceLabel(distanceLabel: string): string {
  const normalized = distanceLabel.trim().toLowerCase();
  return CANONICAL_DISTANCE_ALIASES[normalized] ?? distanceLabel;
}

function completedWithResult(races: Race[]) {
  return races.filter((race) => race.status === 'completed' && race.result);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

export interface DistancePRStatus {
  race: Race;
  groupKey: string;
  /** No prior race exists at this distance — never automatically labeled a "PR." */
  isFirstRecorded: boolean;
  /** Beat every race before it (chronologically) at this distance — true "at the time," even if
   *  a later race has since gone faster. */
  isPRPerformance: boolean;
  /** The single fastest race of all time at this distance — what the Personal Bests ladder shows. */
  isCurrentPB: boolean;
}

/**
 * Walks each comparable-distance group in chronological order tracking the running-best time.
 * This is the one piece of real "history" logic in the app — distinguishing "current PB" from
 * "was a PR at the time" is exactly what lets yearly Highlights answer "did I PR in 2024?" even
 * after a later race moved the current best elsewhere.
 */
export function getDistancePRStatuses(races: Race[]): DistancePRStatus[] {
  const eligible = completedWithResult(races).filter(
    (race) => !EXCLUDED_FROM_PR_LADDER.has(canonicalDistanceLabel(race.distanceLabel)),
  );
  const groups = groupBy(eligible, (race) => canonicalDistanceLabel(race.distanceLabel));

  const statuses: DistancePRStatus[] = [];
  for (const [groupKey, groupRaces] of groups) {
    const sorted = [...groupRaces].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    const overallBestSeconds = Math.min(...sorted.map((race) => race.result!.finishSeconds));
    let runningBestSeconds = Infinity;

    sorted.forEach((race, index) => {
      const seconds = race.result!.finishSeconds;
      const isFirstRecorded = index === 0;
      const isPRPerformance = !isFirstRecorded && seconds < runningBestSeconds;
      if (seconds < runningBestSeconds) runningBestSeconds = seconds;
      const isCurrentPB = seconds === overallBestSeconds;
      statuses.push({ race, groupKey, isFirstRecorded, isPRPerformance, isCurrentPB });
    });
  }
  return statuses;
}

function distancePRHighlight(status: DistancePRStatus): Highlight | null {
  if (status.isCurrentPB) {
    return { race: status.race, icon: 'trophy', label: `${status.groupKey} PR` };
  }
  if (status.isPRPerformance) {
    return { race: status.race, icon: 'trending-up', label: `${status.groupKey} PR Performance` };
  }
  if (status.isFirstRecorded) {
    return { race: status.race, icon: 'flag-outline', label: `First recorded ${status.groupKey}` };
  }
  return null;
}

/** Races that beat every prior race at their distance and fall within `year` — "PRs this year." */
export function getPRPerformancesInYear(races: Race[], year: number): Race[] {
  return getDistancePRStatuses(races)
    .filter((status) => status.isPRPerformance && yearOf(status.race.eventDate) === year)
    .map((status) => status.race);
}

/** Fastest time at the exact same event name — only meaningful with 2+ visits to that venue. */
export function getCourseBests(races: Race[]): Race[] {
  const groups = groupBy(completedWithResult(races), (race) => race.name);
  const bests: Race[] = [];
  for (const groupRaces of groups.values()) {
    if (groupRaces.length < 2) continue;
    bests.push(groupRaces.reduce((a, b) => (a.result!.finishSeconds <= b.result!.finishSeconds ? a : b)));
  }
  return bests;
}

/** Age-group place 1-3 — only needs a place, never requires a known field size. */
export function getAgeGroupPodiums(races: Race[]): Race[] {
  return completedWithResult(races).filter((race) => {
    const place = race.result?.ageGroupRank?.place;
    return place !== undefined && place <= 3;
  });
}

/**
 * Fastest swim/bike/run split within a comparable-distance group (2+ members with that split
 * present). Skips a winner that's already the group's current PB, since that's covered by the
 * distance-PR highlight — this is specifically for split-level standouts in an otherwise-ordinary
 * race (e.g. your fastest Olympic run wasn't necessarily your best overall Olympic result).
 */
export function getFastestSplitHighlights(races: Race[], currentPBRaceIds: Set<string>): Highlight[] {
  const eligible = completedWithResult(races).filter(
    (race) => !EXCLUDED_FROM_PR_LADDER.has(canonicalDistanceLabel(race.distanceLabel)),
  );
  const groups = groupBy(eligible, (race) => canonicalDistanceLabel(race.distanceLabel));
  const highlights: Highlight[] = [];

  for (const [distanceLabel, groupRaces] of groups) {
    if (groupRaces.length < 2) continue;
    for (const disciplineLabel of ['Swim', 'Bike', 'Run']) {
      const withSplit = groupRaces
        .map((race) => ({ race, split: race.result!.splits.find((s) => s.label === disciplineLabel) }))
        .filter((entry): entry is { race: Race; split: RaceSplit } => entry.split !== undefined);
      if (withSplit.length < 2) continue;

      const fastest = withSplit.reduce((a, b) => (a.split.elapsedSeconds <= b.split.elapsedSeconds ? a : b));
      if (currentPBRaceIds.has(fastest.race.id)) continue;

      highlights.push({
        race: fastest.race,
        icon: 'lightning-bolt',
        label: `Fastest ${distanceLabel} ${disciplineLabel.toLowerCase()}`,
        value: formatFinishTime(fastest.split.elapsedSeconds),
      });
    }
  }
  return highlights;
}

/**
 * A strong age-group percentile, only where both place and field are known and trustworthy.
 *
 * `excludeRaceIds` dedupes by ranking dimension, not by blanket "one highlight per race": a race
 * whose age-group result already earned an age-group podium highlight shouldn't also earn a
 * separate "notable age-group finish" card — same dimension (age-group), same underlying fact,
 * just a less specific way of saying it. A race's Overall percentile (a different dimension) is
 * unaffected and, when that highlight type exists, may still appear alongside a suppressed AG one.
 */
export function getNotablePercentileHighlights(
  races: Race[],
  thresholdPercent = 20,
  excludeRaceIds: Set<string> = new Set(),
): Highlight[] {
  const highlights: Highlight[] = [];
  for (const race of completedWithResult(races)) {
    if (race.result!.rankingNeedsConfirmation) continue;
    if (excludeRaceIds.has(race.id)) continue;
    const rank = race.result!.ageGroupRank;
    if (!rank || rank.field === undefined) continue;
    const percentile = getTopPercentile(rank.place, rank.field);
    if (percentile <= thresholdPercent) {
      highlights.push({ race, icon: 'star', label: 'Notable age-group finish', value: `Top ${percentile}%` });
    }
  }
  return highlights;
}

/** Every highlight type, unfiltered — the base list other views filter down from. */
export function getAllHighlightsUnfiltered(races: Race[]): Highlight[] {
  const distanceStatuses = getDistancePRStatuses(races);
  const currentPBRaceIds = new Set(
    distanceStatuses.filter((status) => status.isCurrentPB).map((status) => status.race.id),
  );

  const distanceHighlights = distanceStatuses
    .map(distancePRHighlight)
    .filter((highlight): highlight is Highlight => highlight !== null);

  const courseBestHighlights: Highlight[] = getCourseBests(races).map((race) => ({
    race,
    icon: 'flag-checkered',
    label: `Course best — ${race.name}`,
  }));

  const podiumHighlights: Highlight[] = getAgeGroupPodiums(races).map((race) => {
    const place = race.result!.ageGroupRank!.place;
    const field = race.result!.ageGroupRank!.field;
    return {
      race,
      icon: 'medal',
      label: 'Age-group podium',
      value: field !== undefined ? `${place} / ${field}` : formatOrdinal(place),
    };
  });

  const splitHighlights = getFastestSplitHighlights(races, currentPBRaceIds);
  const agPodiumRaceIds = new Set(getAgeGroupPodiums(races).map((race) => race.id));
  const percentileHighlights = getNotablePercentileHighlights(races, 20, agPodiumRaceIds);

  return [...distanceHighlights, ...courseBestHighlights, ...podiumHighlights, ...splitHighlights, ...percentileHighlights];
}

/** Highlights matching the active sport/year filter (Stats' Highlights section). */
export function getAllHighlights(races: Race[], sport?: SportCategory, year?: number): Highlight[] {
  return getAllHighlightsUnfiltered(races).filter(
    (highlight) =>
      (sport === undefined || highlight.race.sport === sport) &&
      (year === undefined || yearOf(highlight.race.eventDate) === year),
  );
}

/** Every highlight belonging to one specific race, regardless of any active filter — used for
 *  per-row badges on the Races tab and Result detail's top highlight row. */
export function getHighlightsForRace(races: Race[], raceId: string): Highlight[] {
  return getAllHighlightsUnfiltered(races).filter((highlight) => highlight.race.id === raceId);
}

const HIGHLIGHT_ICON_PRIORITY: IconName[] = [
  'trophy',
  'medal',
  'trending-up',
  'lightning-bolt',
  'flag-checkered',
  'star',
  'flag-outline',
];

function highlightPriority(highlight: Highlight): number {
  const index = HIGHLIGHT_ICON_PRIORITY.indexOf(highlight.icon);
  return index === -1 ? HIGHLIGHT_ICON_PRIORITY.length : index;
}

/** Most-meaningful-first, capped — PR/podium outrank a lesser split highlight. */
export function pickTopHighlights(highlights: Highlight[], max = 6): Highlight[] {
  return [...highlights].sort((a, b) => highlightPriority(a) - highlightPriority(b)).slice(0, max);
}

/**
 * The Races tab's row/card view is a browse surface, not a second Stats screen — a race with
 * several highlights (podium + a fastest split + a notable percentile, say) shouldn't grow taller
 * or busier than one with none. This picks the single most-meaningful highlight for that compact
 * display; it never discards the others (Stats' Highlights section and Result detail still read
 * every highlight via getAllHighlights/getHighlightsForRace).
 *
 * "First recorded [distance]" is deliberately excluded — it's a historical marker, not something
 * that reads as an accomplishment worth calling out in a one-badge-per-row context.
 */
const PRIMARY_ROW_BADGE_PRIORITY: IconName[] = ['medal', 'trophy', 'trending-up', 'flag-checkered', 'lightning-bolt', 'star'];

export function pickPrimaryHighlight(highlights: Highlight[]): Highlight | undefined {
  const eligible = highlights.filter((highlight) => PRIMARY_ROW_BADGE_PRIORITY.includes(highlight.icon));
  if (eligible.length === 0) return undefined;
  return [...eligible].sort(
    (a, b) => PRIMARY_ROW_BADGE_PRIORITY.indexOf(a.icon) - PRIMARY_ROW_BADGE_PRIORITY.indexOf(b.icon),
  )[0];
}
