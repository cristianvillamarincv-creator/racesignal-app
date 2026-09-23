import { supabase } from '@/lib/supabaseClient';

/**
 * Thin client for the `race-discovery` Edge Function. Mirrors (but does not import — separate
 * Deno vs RN TypeScript projects) supabase/functions/race-discovery/types.ts. `search`/`history`
 * work before the athlete signs in; `detail` requires a session (supabase-js attaches the current
 * session's access token automatically once one exists — see lib/auth.tsx).
 */

export interface AthleteIdentity {
  providerAthleteId: string;
  displayName: string;
}

export interface CandidateRace {
  provider: 'sportstats';
  providerResultId: string;
  providerAthleteResultId: string;
  sourceUrl: string;
  eventName: string;
  category: string;
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
  | 'bad_request'
  | 'network_error';

export type DiscoveryResult<T> = { available: true; data: T } | { available: false; reason: UnavailableReason };

async function invoke<T>(body: Record<string, unknown>): Promise<DiscoveryResult<T>> {
  const { data, error } = await supabase.functions.invoke('race-discovery', { body });
  if (error) {
    console.warn('[raceDiscovery] functions.invoke failed for action', body.action, '—', error.message ?? error);
    return { available: false, reason: 'network_error' };
  }
  return data as DiscoveryResult<T>;
}

export function searchAthletes(racingName: string): Promise<DiscoveryResult<AthleteIdentity[]>> {
  return invoke({ action: 'search', racingName });
}

export function fetchCandidateHistory(providerAthleteId: string): Promise<DiscoveryResult<CandidateRace[]>> {
  return invoke({ action: 'history', providerAthleteId });
}

/** `category` is the candidate's own event-distance label (e.g. "70.3", "Olympic", "Half
 *  Marathon") — already known client-side from search/history. Passed through only as a fallback
 *  distance source for split pace/speed when the provider's own per-checkpoint data isn't
 *  trustworthy (see the Edge Function's normalize.ts); optional, detail fetch still works without
 *  it. */
export function fetchRaceDetail(
  providerResultId: string,
  providerAthleteResultId: string,
  category?: string,
): Promise<DiscoveryResult<RaceDetailPayload>> {
  return invoke({ action: 'detail', providerResultId, providerAthleteResultId, category });
}
