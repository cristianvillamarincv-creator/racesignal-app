import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PREFS, normalizePrefs, PREFS_KEY_PREFIX, ROTATION_KEY_PREFIX, type NotificationPrefs } from '@/lib/notifications/prefs';

export async function loadPrefs(athleteId: string): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY_PREFIX + athleteId);
    return normalizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(athleteId: string, prefs: NotificationPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + athleteId, JSON.stringify(prefs));
  } catch (err) {
    console.warn('[notifications] failed to save preferences:', err);
  }
}

/** Removes everything this feature stores for the athlete (used when the account is deleted). */
export async function clearNotificationState(athleteId: string): Promise<void> {
  try {
    await AsyncStorage.multiRemove([PREFS_KEY_PREFIX + athleteId, ROTATION_KEY_PREFIX + athleteId]);
  } catch (err) {
    console.warn('[notifications] failed to clear notification state:', err);
  }
}
