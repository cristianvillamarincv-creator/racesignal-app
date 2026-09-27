import type { InitialPaywallSeenStatus } from '@/lib/db/paywall';
import { PAYWALL_RESULT } from '@/lib/purchases';

/**
 * Whether the one-time post-onboarding Premium paywall (Step 8 Build 9) should be attempted, given
 * a freshly-read server-side seen status. The in-memory "have we already attempted this launch"
 * guard lives separately, as a ref in InitialPaywallGate, checked and set synchronously BEFORE this
 * status is even fetched — so by the time this function runs, the launch-level guard has already
 * been satisfied and this is purely the server-side "not yet seen" check.
 */
export function shouldAttemptInitialPaywall(seenStatus: InitialPaywallSeenStatus): boolean {
  return seenStatus.status === 'not_seen';
}

/**
 * Whether a resolved PAYWALL_RESULT should mark the paywall seen server-side. Only a genuine
 * technical failure (ERROR) is excluded — purchase, restore, and a plain dismissal (CANCELLED) all
 * count as "the athlete saw it and it resolved," matching the product requirement that dismissal
 * marks seen. NOT_PRESENTED (the athlete already holds `premium`, e.g. from a prior restore) is
 * also treated as seen — there's nothing left to show them.
 */
export function shouldMarkInitialPaywallSeen(result: PAYWALL_RESULT): boolean {
  return result !== PAYWALL_RESULT.ERROR;
}
