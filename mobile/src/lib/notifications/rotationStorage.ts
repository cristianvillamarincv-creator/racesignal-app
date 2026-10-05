import AsyncStorage from '@react-native-async-storage/async-storage';

import { ROTATION_KEY_PREFIX } from '@/lib/notifications/prefs';
import { EMPTY_ROTATION, normalizeRotation, type RotationState } from '@/lib/notifications/rotation';

export async function loadRotation(athleteId: string): Promise<RotationState> {
  try {
    const raw = await AsyncStorage.getItem(ROTATION_KEY_PREFIX + athleteId);
    return normalizeRotation(raw ? JSON.parse(raw) : null);
  } catch {
    return EMPTY_ROTATION;
  }
}

export async function saveRotation(athleteId: string, state: RotationState): Promise<void> {
  try {
    await AsyncStorage.setItem(ROTATION_KEY_PREFIX + athleteId, JSON.stringify(state));
  } catch (err) {
    console.warn('[notifications] failed to save the prompt rotation:', err);
  }
}
