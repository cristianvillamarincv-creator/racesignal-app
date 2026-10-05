import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The athlete's unsent Signal text, kept per athlete (one draft slot per account on this device) so it survives leaving the screen and cold
 * starts. A notification starter never overwrites it. Cleared when the message is sent, and when the account is deleted.
 */
export const SIGNAL_DRAFT_KEY_PREFIX = 'rs.signal.draft.v1:';

export async function loadSignalDraft(athleteId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(SIGNAL_DRAFT_KEY_PREFIX + athleteId)) ?? '';
  } catch {
    return '';
  }
}

/** Saves the draft; an empty (or whitespace-only) draft clears the slot. */
export async function saveSignalDraft(athleteId: string, text: string): Promise<void> {
  try {
    if (text.trim().length === 0) await AsyncStorage.removeItem(SIGNAL_DRAFT_KEY_PREFIX + athleteId);
    else await AsyncStorage.setItem(SIGNAL_DRAFT_KEY_PREFIX + athleteId, text);
  } catch (err) {
    console.warn('[Signal] failed to save the draft:', err);
  }
}

export async function clearSignalDraft(athleteId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(SIGNAL_DRAFT_KEY_PREFIX + athleteId);
  } catch (err) {
    console.warn('[Signal] failed to clear the draft:', err);
  }
}

/**
 * What the composer should do with a notification's suggested starter, given the existing draft:
 *  - no draft: use the starter as the (editable) text;
 *  - an existing draft: keep it untouched and offer the starter as an explicit choice.
 */
export function planStarter(existingDraft: string, starter: string): { action: 'use'; text: string } | { action: 'offer'; starter: string } {
  return existingDraft.trim().length === 0 ? { action: 'use', text: starter } : { action: 'offer', starter };
}

/** Accepting an offered starter adds it after the existing draft (nothing the athlete wrote is removed). */
export function appendStarter(existingDraft: string, starter: string): string {
  const base = existingDraft.replace(/\s+$/, '');
  return base.length === 0 ? starter : `${base}\n\n${starter}`;
}
