import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CandidateRace } from '@/lib/raceDiscovery';

const STORAGE_KEY = 'racesignal.onboarding.pendingDraft';

/**
 * Google OAuth hands control to an external browser and back — the app can be backgrounded or
 * (on Android especially) killed while that's happening. Everything needed to resume the bulk
 * import after the redirect gets written here right before `signInWithGoogle()` starts, and
 * cleared once the import finishes (success or not) — never left lying around indefinitely.
 */
export interface OnboardingDraft {
  racingName: string;
  birthYearHint: string;
  candidates: CandidateRace[];
  selectedResultIds: string[];
  /** The provider's display name for whichever identity was selected during discovery, if any —
   *  carried through so a resumed-after-redirect import can still record it on provenance. */
  providerAthleteName?: string;
  /** Set when this draft came from the "Already have an account? Sign in" entry point rather than
   *  the normal discovery flow — on resume, this must NEVER trigger runImport (there's no real
   *  racingName/candidates here, and upserting athlete_profiles with them would overwrite the
   *  returning athlete's actual profile). See OnboardingFlow.tsx's resumeReturningUser(). */
  isReturningUserSignIn?: boolean;
  /** Rows already detail-fetched but not yet saved (e.g. an insert failure) at the point this
   *  draft was written — carried through re-authentication the same way `selectedResultIds` is,
   *  so a session-expiry mid-import (see handleSignInAgain) doesn't just re-fetch the still-
   *  pending candidates but also finishes saving whatever was already fetched, without needing a
   *  second, separate retry action for it. */
  rowsAlreadyFetched?: Record<string, unknown>[];
  /** The Supabase auth user id of the account this draft's mid-import candidates/rows belong to —
   *  set ONLY by handleSignInAgain's session-expiry recovery (captured from the expiring session
   *  BEFORE signOut() runs), since that's the one case where this draft is genuinely
   *  account-specific rather than pre-auth. Undefined for the ordinary fresh-onboarding/
   *  returning-user-sign-in paths, where no account is signed in yet when the draft is written
   *  (nothing to bind to, same as before this field existed). When set, resumeFromDraftAndImport
   *  must refuse to run the real import for a NEWLY-signed-in session whose user id doesn't match
   *  — AsyncStorage is shared device-wide, so a stale draft must never silently import one
   *  account's candidates into whichever different account happens to complete sign-in next
   *  (a shared/reused device, or a "delete account, sign up again" recreation — a new account
   *  gets a new auth user id even for the same email). */
  originAthleteId?: string;
}

export async function saveOnboardingDraft(draft: OnboardingDraft): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft)).catch(() => {});
}

export async function loadOnboardingDraft(): Promise<OnboardingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingDraft;
  } catch {
    return null;
  }
}

export async function clearOnboardingDraft(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
