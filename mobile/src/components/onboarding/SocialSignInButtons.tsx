import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { hasAppleAuthenticationNative, hasGoogleSignInNative } from '@/lib/nativeModules';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';
import { type SocialProvider } from '@/lib/socialAuth';
import { minTouchSize, spacing } from '@/lib/theme';
import { useBrandPalette } from '@/lib/brandTheme';

/**
 * Provider buttons for Apple and Google. Each is the provider's own native button (Apple's HIG and
 * Google's branding guidelines require their buttons, not lookalikes), sized to the same height and full
 * width so neither is more prominent than the other. A provider that this build is not configured for, or
 * whose native module is missing from the installed binary, simply does not render, and when neither does
 * the whole group disappears, leaving the email flow exactly as it was.
 *
 * Native modules are loaded lazily: a binary built before they were added never crashes here.
 */
const BUTTON_HEIGHT = minTouchSize + 4;
const BUTTON_RADIUS = 14;

export function SocialSignInButtons({
  onPress,
  disabled = false,
  caption,
}: {
  onPress: (provider: SocialProvider) => void;
  disabled?: boolean;
  /** One quiet line beneath the buttons (e.g. how existing email users connect a provider). */
  caption?: string;
}) {
  const config = getSocialAuthConfig();
  const palette = useBrandPalette();
  const isDark = useColorScheme() === 'dark';
  const [Apple, setApple] = useState<typeof import('expo-apple-authentication') | null>(null);
  const [GoogleButton, setGoogleButton] = useState<(typeof import('@react-native-google-signin/google-signin'))['GoogleSigninButton'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (config.apple && hasAppleAuthenticationNative()) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the header)
          const module: typeof import('expo-apple-authentication') = require('expo-apple-authentication');
          if (!cancelled && module != null && (await module.isAvailableAsync())) setApple(module);
        } catch (err) {
          console.warn('[SocialAuth] Apple button unavailable in this build:', (err as Error)?.message);
        }
      }
      if (config.google && hasGoogleSignInNative()) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the header)
          const module: typeof import('@react-native-google-signin/google-signin') = require('@react-native-google-signin/google-signin');
          if (!cancelled && module != null) setGoogleButton(() => module.GoogleSigninButton);
        } catch (err) {
          console.warn('[SocialAuth] Google button unavailable in this build:', (err as Error)?.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config.apple, config.google]);

  if (!Apple && !GoogleButton) return null;

  return (
    <View style={styles.group} pointerEvents={disabled ? 'none' : 'auto'}>
      {Apple ? (
        <Apple.AppleAuthenticationButton
          buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={isDark ? Apple.AppleAuthenticationButtonStyle.WHITE : Apple.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={BUTTON_RADIUS}
          style={[styles.button, disabled && styles.disabled]}
          onPress={() => onPress('apple')}
        />
      ) : null}
      {GoogleButton ? (
        <GoogleButton
          size={GoogleButton.Size.Wide}
          color={isDark ? GoogleButton.Color.Light : GoogleButton.Color.Dark}
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled]}
          onPress={() => onPress('google')}
        />
      ) : null}
      {caption ? <Text style={[styles.caption, { color: palette.inkSecondary }]}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { alignSelf: 'stretch', gap: spacing.sm },
  button: { alignSelf: 'stretch', height: BUTTON_HEIGHT, borderRadius: BUTTON_RADIUS },
  disabled: { opacity: 0.4 },
  caption: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
