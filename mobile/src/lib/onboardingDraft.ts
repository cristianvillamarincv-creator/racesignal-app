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
