import type { AppleRevocationCodeResult, ConnectedProvider } from '@/lib/socialAuthTypes';

/**
 * Decides what happens with Sign in with Apple when an athlete deletes their account.
 *
 * Apple requires revoking the athlete's Apple tokens on deletion, which needs a fresh single-use code from
 * Apple. That code can never become a barrier to deletion:
 *   - no Apple sign-in on the account            -> nothing to do
 *   - Apple gives a code                          -> send it so the server can revoke
 *   - the athlete cancels Apple's sheet           -> ask once whether to delete anyway (UI), never forced
 *   - Apple unavailable / errors / wrong Apple ID -> proceed without revocation
 * and a server-side revocation failure is reported afterwards but the account is deleted regardless.
 */
export type AppleDeletionPlan =
  | { kind: 'none' }
  | { kind: 'revoke'; authorizationCode: string }
  | { kind: 'cancelled' }
  | { kind: 'skipped' };

export async function planAppleRevocation(
  identities: ConnectedProvider[] | null,
  providersFromSession: string[],
  requestCode: (expectedAppleUser?: string | null) => Promise<AppleRevocationCodeResult>,
): Promise<AppleDeletionPlan> {
  const appleIdentity = identities?.find((identity) => identity.provider === 'apple');
  const hasApple = Boolean(appleIdentity) || (identities === null && providersFromSession.includes('apple'));
  if (!hasApple) return { kind: 'none' };
  const result = await requestCode(appleIdentity?.providerUserId ?? null);
  if (result.status === 'code') return { kind: 'revoke', authorizationCode: result.authorizationCode };
  if (result.status === 'cancelled') return { kind: 'cancelled' };
  return { kind: 'skipped' };
}

/** True when an Apple account was involved but its tokens were not revoked, so the athlete should be told
 *  how to remove RaceSignal from their Apple ID themselves. */
export function needsManualAppleRemovalNotice(plan: AppleDeletionPlan, revocation: 'revoked' | 'failed' | 'not_attempted'): boolean {
  return plan.kind !== 'none' && revocation !== 'revoked';
}

export const APPLE_MANUAL_REMOVAL_MESSAGE =
  'Your RaceSignal account is deleted. We couldn’t disconnect Sign in with Apple automatically. You can remove RaceSignal any time in Settings > your name > Sign-In & Security > Sign in with Apple.';
