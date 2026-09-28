import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CandidateRace } from '@/lib/raceDiscovery';

const STORAGE_KEY = 'racesignal.findRaces.pendingRetry';

/**
 * FindMyRacesFlow (unlike OnboardingFlow) has no pre-existing "resume after re-authentication"
 * mechanism — it was designed assuming a valid session always already exists, since it's only
 * reachable post-login (Settings > "Find more races"). An `unauthorized` mid-import stop calls for
 * a full sign-out (see FindMyRacesFlow's handleSignInAgain), which unmounts this whole screen —
 * any in-memory retry state would otherwise be lost outright. This is the same
 * "persist just enough to resume, never anything already saved" pattern as onboardingDraft.ts,
 * scoped to this flow.
 */
export interface FindRacesRetryDraft {
  /** The Supabase auth user id of the account this draft's candidates/rows belong to — captured
   *  from the session that was just about to expire, BEFORE signOut() runs. AsyncStorage is
   *  shared device-wide, not scoped per-account: without this, a stale draft could silently
   *  resume (and import candidates into) whichever DIFFERENT account happens to be signed in the
   *  next time this screen mounts — a real cross-account data leak on a shared/reused device, or
   *  after a "delete account, sign up again" recreation. FindMyRacesFlow's resume effect must
   *  reject (and clear) any draft whose athleteId doesn't match the CURRENT session's id. */
  athleteId: string;
  searchName: string;
  providerAthleteName?: string;
  /** Candidates still needing a detail fetch (never attempted, or a network_error that didn't
   *  resolve even after the bounded automatic retry) — never anything already saved. */
  candidates: CandidateRace[];
  /** Rows already detail-fetched but not yet saved (e.g. an insert failure) at the point this
   *  draft was written. */
  rowsAlreadyFetched?: Record<string, unknown>[];
}

export async function saveFindRacesRetryDraft(draft: FindRacesRetryDraft): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft)).catch(() => {});
}

export async function loadFindRacesRetryDraft(): Promise<FindRacesRetryDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FindRacesRetryDraft;
  } catch {
    return null;
  }
}

export async function clearFindRacesRetryDraft(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
