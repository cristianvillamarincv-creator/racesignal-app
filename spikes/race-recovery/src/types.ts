/**
 * Shapes mirror the B.0 architecture proposal (AthleteSearchRequest / RaceCandidate). This spike
 * only implements the Sportstats provider — the shape is provider-agnostic so a future adapter
 * (Athlinks, RunSignup, etc.) could populate the same structure.
 */

export interface AthleteSearchRequest {
  racingName: string;
  birthYear?: number;
  /** Used only as match evidence for selecting which candidates to fetch full detail for —
   *  never as identity proof. */
  knownRaces?: KnownRaceAnchor[];
}

export interface KnownRaceAnchor {
  /** Free-text substring to match against a candidate's event name, e.g. "Toronto Marathon". */
  eventQuery: string;
  approximateYear: number;
}

export type ProviderName = 'sportstats';

export interface RaceRank {
  place: number;
  field?: number;
}

export interface RaceSplit {
  label: string;
  splitTime?: string;
  totalTime?: string;
  pace?: string;
}

/**
 * One discovered candidate race. `detail` is populated only for candidates we chose to fetch
 * full result pages for (the two anchors, in this run) — everything else stays a lightweight
 * candidate (event/date/link only), matching the "search -> lightweight list -> user selects ->
 * fetch full detail only for selected races" architecture.
 */
export interface RaceCandidate {
  provider: ProviderName;
  providerResultId: string;
  sourceUrl: string;
  athleteName: string;
  eventName: string;
  /** As shown by the provider, e.g. "2026 May 03" — not reformatted/parsed into ISO here, to
   *  avoid silently misreading an ambiguous date format. */
  eventDateRaw: string;
  category: string;
  claimedOnProvider: boolean;
  matchEvidence: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  detail?: RaceCandidateDetail;
}

export interface RaceCandidateDetail {
  bib?: string;
  ageGroupCategory?: string;
  finishTime?: string;
  overallRank?: RaceRank;
  genderRank?: RaceRank;
  ageGroupRank?: RaceRank;
  splits: RaceSplit[];
}

export interface AthleteSearchMatch {
  nid: string;
  displayName: string;
  /** Raw "nc" field from the provider — observed to correlate with race count, not documented,
   *  so we surface it as-is rather than asserting what it means. */
  providerCount?: string;
}

/** Emitted instead of throwing when the provider responds with something that looks like a
 *  block/challenge — the caller must stop, not retry, rotate, or fall back automatically. */
export interface ProviderBlocked {
  blocked: true;
  reason: string;
  httpStatus?: number;
  url: string;
}
