import { supabase } from '@/lib/supabaseClient';
import { withTimeout } from '@/lib/timeout';

/** Same bound as every other Supabase call on the app-launch critical path (see db/races.ts). */
const QUERY_TIMEOUT_MS = 20000;

export type InitialPaywallSeenStatus =
  | { status: 'seen' }
  | { status: 'not_seen' }
  /** A failed/timed-out read — treated the same as "seen" at the call site (see
   *  lib/initialPaywall.ts), never as "not yet seen". A transient network hiccup must never cause
   *  the one-time paywall to appear; the only way it appears is a genuine, confirmed null read. */
  | { status: 'unknown' };

/**
 * The one-time post-onboarding Premium paywall's "have we shown this athlete the initial paywall
 * yet" signal (migrations/0009_initial_paywall_seen_at.sql).
 */
export async function fetchInitialPaywallSeenStatus(athleteId: string): Promise<InitialPaywallSeenStatus> {
  try {
    const { data, error } = await withTimeout(
      supabase.from('athlete_profiles').select('initial_paywall_seen_at').eq('id', athleteId).maybeSingle(),
      QUERY_TIMEOUT_MS,
      'fetchInitialPaywallSeenStatus',
    );
    if (error) {
      console.warn('[db/paywall] fetchInitialPaywallSeenStatus failed:', error.message);
      return { status: 'unknown' };
    }
    return data?.initial_paywall_seen_at ? { status: 'seen' } : { status: 'not_seen' };
  } catch (err) {
    console.warn('[db/paywall] fetchInitialPaywallSeenStatus did not complete:', err);
    return { status: 'unknown' };
  }
}

/** Set once the paywall has genuinely been shown and resolved (purchased, restored, or dismissed)
 *  — never on a technical presentation failure. See lib/initialPaywall.ts. */
export async function markInitialPaywallSeen(athleteId: string): Promise<void> {
  try {
    const { error } = await withTimeout(
      supabase.from('athlete_profiles').update({ initial_paywall_seen_at: new Date().toISOString() }).eq('id', athleteId),
      QUERY_TIMEOUT_MS,
      'markInitialPaywallSeen',
    );
    if (error) console.warn('[db/paywall] markInitialPaywallSeen failed:', error.message);
  } catch (err) {
    console.warn('[db/paywall] markInitialPaywallSeen did not complete:', err);
  }
}
