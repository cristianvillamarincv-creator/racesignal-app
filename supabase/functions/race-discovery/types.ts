// Shared types for the race-discovery Edge Function. Mirrors (but does not import — Deno vs the
// mobile app are separate TypeScript projects) the shapes documented in the B.1 architecture and
// validated end-to-end in spikes/race-recovery/.

export interface AthleteIdentity {
  /** Sportstats' internal athlete id ("nid") — opaque, provider-specific. */
  providerAthleteId: string;
  displayName: string;
}

export interface CandidateRace {
  provider: 'sportstats';
  providerResultId: string;
  /** Sportstats' per-athlete participant id ("pid") for this race — required to fetch detail. */
  providerAthleteResultId: string;
  sourceUrl: string;
  eventName: string;
  category: string;
  /** ISO 'YYYY-MM-DD' when known; null when the provider only gave a date (Sportstats always
   *  gives a full date for its own results, so this is null only in theory — kept nullable so the
   *  contract doesn't silently break if that ever isn't true). */
  eventDate: string | null;
  eventYear: number;
}

export interface RaceRankPayload {
  place: number;
  field?: number;
}

export interface RaceSplitPayload {
  label: string;
  splitSeconds?: number;
  totalSeconds: number;
  pace?: string;
}

export interface RaceDetailPayload {
  bib?: string;
  ageGroupCategory?: string;
  finishSeconds?: number;
  overallRank?: RaceRankPayload;
  genderRank?: RaceRankPayload;
  ageGroupRank?: RaceRankPayload;
  splits: RaceSplitPayload[];
}

export type UnavailableReason =
  | 'disabled'
  | 'rate_limited'
  | 'provider_blocked'
  | 'not_found'
  | 'unauthorized'
  | 'bad_request';

export type DiscoveryResponse<T> = { available: true; data: T } | { available: false; reason: UnavailableReason };
