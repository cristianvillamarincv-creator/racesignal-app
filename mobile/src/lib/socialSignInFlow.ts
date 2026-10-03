import type { SocialProvider, SocialSignInResult } from '@/lib/socialAuthTypes';
import { PROVIDER_LABEL } from '@/lib/socialAuthTypes';

/**
 * What OnboardingFlow does with a native Apple/Google sign-in. Extracted from the component so the
 * branching (the part that decides where an athlete lands and whether anything is imported) can be
 * tested without rendering the 2,000-line flow.
 *
 *  - Pending race selections are written to the draft BEFORE the provider sheet opens, exactly like the
 *    email path, so nothing is lost if the sheet is cancelled or fails.
 *  - Cancelling is not an error: nothing changes, nothing is shown.
 *  - From "Already have an account? Sign in" the athlete always goes the returning-user way (Stats, or
 *    onboarding if that account never finished it).
 *  - Otherwise the saved draft is resumed. That is where an account that ALREADY finished onboarding (for
 *    example one Supabase linked to this provider by verified email) is recognised: its selections are kept and
 *    the athlete chooses "Review selected races" or "Skip", and nothing is imported over the existing profile
 *    (see OnboardingFlow.resumeFromDraftAndImport). A brand-new account runs the normal onboarding import.
 */
export interface SocialFlowDeps {
  isReturningUserFlow: boolean;
  persistDraft: () => Promise<void>;
  signIn: (provider: SocialProvider) => Promise<SocialSignInResult>;
  resumeReturningUser: (userId: string) => Promise<void>;
  resumeFromDraftAndImport: (userId: string) => Promise<void>;
}

export type SocialFlowOutcome = { kind: 'cancelled' } | { kind: 'signedIn' } | { kind: 'error'; message: string };

export async function runSocialSignIn(provider: SocialProvider, deps: SocialFlowDeps): Promise<SocialFlowOutcome> {
  await deps.persistDraft();
  const result = await deps.signIn(provider);
  if (result.status === 'cancelled') return { kind: 'cancelled' };
  if (result.status === 'unavailable') {
    return { kind: 'error', message: `${PROVIDER_LABEL[provider]} sign-in isn’t available in this build. Please use your email instead.` };
  }
  if (result.status === 'error') return { kind: 'error', message: result.message };

  try {
    if (deps.isReturningUserFlow) {
      await deps.resumeReturningUser(result.userId);
    } else {
      await deps.resumeFromDraftAndImport(result.userId);
    }
    return { kind: 'signedIn' };
  } catch (err) {
    console.warn('[SocialAuth] post-sign-in handling failed unexpectedly:', err);
    return { kind: 'error', message: 'Signed in, but something went wrong finishing up. Please try again.' };
  }
}
