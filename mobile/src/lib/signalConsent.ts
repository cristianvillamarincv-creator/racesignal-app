import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'racesignal.signal.consentAcknowledged';

/**
 * Bump this whenever the disclosure sheet's copy changes in a way that alters what's actually
 * disclosed (a new data field sent, a new third party, etc.) — an athlete who agreed to an older
 * version must be re-prompted, never treated as having agreed to the new one.
 */
export const SIGNAL_CONSENT_DISCLOSURE_VERSION = 1;

/**
 * Same "single fixed AsyncStorage key, account id lives in the payload, checked against the
 * current session at read time" pattern as findRacesRetryDraft.ts — see that file's doc comment
 * for the full reasoning. A record whose `athleteId` doesn't match the athlete asking right now is
 * never treated as consent, whether that's a genuinely different account on a shared device or the
 * same device after a sign-out/sign-in-as-someone-else cycle. This does mean a second account's
 * consent overwrites the first's record in storage (there's only one fixed key) — if that first
 * account signs back in, it's re-prompted despite having agreed before. That's a one-time,
 * harmless bit of extra friction, never a safety gap: nothing is ever sent to Anthropic without a
 * pass through `hasAgreedToSignalDisclosure` for the CURRENT session's own athlete id.
 */
export interface SignalConsentRecord {
  athleteId: string;
  version: number;
  agreedAt: string;
}

export async function saveSignalConsent(record: SignalConsentRecord): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record)).catch(() => {});
}

export async function loadSignalConsent(): Promise<SignalConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SignalConsentRecord;
  } catch {
    return null;
  }
}

export async function clearSignalConsent(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/** The one check every Signal-sending path must pass before it's allowed to transmit anything —
 *  true only when THIS athlete agreed to the CURRENT disclosure version. */
export async function hasAgreedToSignalDisclosure(athleteId: string): Promise<boolean> {
  const record = await loadSignalConsent();
  return !!record && record.athleteId === athleteId && record.version >= SIGNAL_CONSENT_DISCLOSURE_VERSION;
}
