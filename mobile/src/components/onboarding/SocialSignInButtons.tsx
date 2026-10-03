import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { hasAppleAuthenticationNative } from '@/lib/nativeModules';
import { type SocialProvider } from '@/lib/socialAuth';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';

/**
 * Apple and Google provider buttons, stacked Apple then Google.
 *
 * Both are the same width (full content width), 52pt high, with a 26pt corner radius, 12pt apart. Apple's is
 * its own native button ("Continue with Apple", Apple's required artwork and radius support). Google's is a
 * RaceSignal-drawn button that follows Google's branding rules: the official multicolor "G", "Continue with
 * Google", dark text on a white fill (a 1pt border in light mode so it holds its edge on the paper canvas),
 * with the icon and label centered as one group. It is a normal Pressable, so it grows with larger text sizes
 * instead of being a fixed-size native view.
 *
 * Each provider's failure renders directly below ITS button. A provider that is off for the build (or, for Apple,
 * missing from the installed binary) does not render; with neither, nothing renders, including the divider, and
 * the email form stands alone exactly as before.
 *
 * The native Apple module is loaded lazily and only when the binary contains it.
 */
export const PROVIDER_BUTTON_HEIGHT = 52;
export const PROVIDER_BUTTON_RADIUS = 26;
export const PROVIDER_BUTTON_GAP = 12;
export const DIVIDER_TOP_MARGIN = 24;

const GOOGLE_TEXT = '#1F1F1F';
const GOOGLE_BORDER_LIGHT = '#747775';

export interface ProviderErrors {
  apple?: string | null;
  google?: string | null;
}

export function SocialSignInButtons({
  onPress,
  busyProvider = null,
  errors = {},
}: {
  onPress: (provider: SocialProvider) => void;
  /** The provider whose sign-in is in flight (shows a spinner on it); every provider button is disabled meanwhile. */
  busyProvider?: SocialProvider | null;
  errors?: ProviderErrors;
}) {
  const config = getSocialAuthConfig();
  const palette = useBrandPalette();
  const isDark = useColorScheme() === 'dark';
  const styles = useMemo(() => createStyles(palette, isDark), [palette, isDark]);
  const [Apple, setApple] = useState<typeof import('expo-apple-authentication') | null>(null);
  const busy = busyProvider !== null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (config.apple && hasAppleAuthenticationNative()) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the header)
          const module: typeof import('expo-apple-authentication') = require('expo-apple-authentication');
          if (!cancelled && module != null && (await module.isAvailableAsync())) setApple(module);
        } catch (err) {
          console.warn('[SocialAuth] apple button unavailable in this build:', (err as { code?: string })?.code ?? 'module_unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.apple]);

  const showApple = config.apple && Apple !== null;
  const showGoogle = config.google;
  if (!showApple && !showGoogle) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.group}>
        {showApple && Apple ? (
          <View style={styles.providerBlock}>
            <View pointerEvents={busy ? 'none' : 'auto'} style={busy ? styles.dimmed : undefined}>
              <Apple.AppleAuthenticationButton
                buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={isDark ? Apple.AppleAuthenticationButtonStyle.WHITE : Apple.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={PROVIDER_BUTTON_RADIUS}
                style={styles.appleButton}
                onPress={() => onPress('apple')}
              />
            </View>
            {busyProvider === 'apple' ? <ActivityIndicator style={styles.appleSpinner} color={isDark ? '#000000' : '#FFFFFF'} /> : null}
            {errors.apple ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {errors.apple}
              </Text>
            ) : null}
          </View>
        ) : null}

        {showGoogle ? (
          <View style={styles.providerBlock}>
            <Pressable
              onPress={() => onPress('google')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: busy, busy: busyProvider === 'google' }}
              style={({ pressed }) => [styles.googleButton, busy && styles.dimmed, pressed && styles.pressed]}>
              <View style={styles.googleContent}>
                {busyProvider === 'google' ? (
                  <ActivityIndicator color={GOOGLE_TEXT} style={styles.googleIcon} />
                ) : (
                  <Image source={require('../../../assets/google-g.png')} style={styles.googleIcon} accessible={false} />
                )}
                <Text style={styles.googleLabel} maxFontSizeMultiplier={1.3}>
                  Continue with Google
                </Text>
              </View>
            </Pressable>
            {errors.google ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {errors.google}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerRule} />
        <Text style={styles.dividerLabel}>or use email</Text>
        <View style={styles.dividerRule} />
      </View>
    </View>
  );
}

function createStyles(palette: BrandPalette, isDark: boolean) {
  return StyleSheet.create({
    wrap: { alignSelf: 'stretch' },
    group: { alignSelf: 'stretch', gap: PROVIDER_BUTTON_GAP },
    providerBlock: { alignSelf: 'stretch', gap: 8 },
    appleButton: { alignSelf: 'stretch', height: PROVIDER_BUTTON_HEIGHT },
    appleSpinner: { position: 'absolute', alignSelf: 'center', top: (PROVIDER_BUTTON_HEIGHT - 20) / 2 },
    googleButton: {
      alignSelf: 'stretch',
      minHeight: PROVIDER_BUTTON_HEIGHT,
      borderRadius: PROVIDER_BUTTON_RADIUS,
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      // Dark mode: a white button on a dark canvas needs no edge. Light mode: Google's light-theme outline.
      borderColor: isDark ? '#FFFFFF' : GOOGLE_BORDER_LIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    googleContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    googleIcon: { width: 20, height: 20 },
    googleLabel: { color: GOOGLE_TEXT, fontSize: 17, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
    dimmed: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
    error: { fontSize: 14, color: palette.danger },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: DIVIDER_TOP_MARGIN },
    dividerRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline },
    dividerLabel: { fontSize: 13, fontWeight: '500', color: palette.inkSecondary },
  });
}
