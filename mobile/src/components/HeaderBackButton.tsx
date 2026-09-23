import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { colors } from '@/lib/theme';

/**
 * The one standardized Back control for every pushed stack screen (Settings, Find My Races,
 * Add/Edit race, Race prep, Result detail) — set once via each screen's `headerLeft` in
 * app/_layout.tsx rather than each screen inventing its own (a bottom-of-screen text link, or an
 * in-content button that isn't positioned inside the safe area). Rendering through the native
 * header's `headerLeft` slot means React Navigation places it correctly relative to the safe area
 * for us — that's specifically what a custom in-content "back" row can get wrong.
 *
 * Calls plain `router.back()` when there's actually somewhere to go back to; never hardcodes a
 * fallback destination; a screen with no back history (shouldn't happen for anything this is used
 * on) just renders an inert button rather than jumping somewhere arbitrary.
 */
export function HeaderBackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
      }}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      style={{ marginLeft: 8, minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }}>
      <Ionicons name="chevron-back" size={26} color={colors.accent} />
    </Pressable>
  );
}
