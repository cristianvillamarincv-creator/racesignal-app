import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, type ColorValue } from 'react-native';

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
 *
 * `color` defaults to the app-wide accent (every current call site) — a screen using a different
 * token system (e.g. results/[id].tsx's "Race Morning Precision" palette) can override it locally
 * without this component needing to know about that palette.
 *
 * `circular` (default false — every existing call site is unaffected) renders the button as a
 * single, unified ~44x44 circle — the same element is both the visual circle and the full tappable
 * area, so there's no mismatch between a small drawn circle and a larger invisible touch box (a
 * "ghost container") around it.
 */
export function HeaderBackButton({
  color = colors.accent,
  circular = false,
  circleBackground,
}: {
  color?: ColorValue;
  circular?: boolean;
  circleBackground?: ColorValue;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
      }}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={circular ? 0 : 8}
      style={
        circular
          ? { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: circleBackground }
          : { marginLeft: 8, minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' }
      }>
      <Ionicons name="chevron-back" size={circular ? 20 : 26} color={color} />
    </Pressable>
  );
}
