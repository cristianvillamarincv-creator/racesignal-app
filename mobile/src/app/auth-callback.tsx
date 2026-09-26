import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

/**
 * A pure safety net for Expo Router's OWN file-based deep-link resolution — NOT the real
 * auth-completion path. `racesignal://auth-callback` (see getAuthRedirectUri in lib/auth.tsx) is
 * actually consumed by OnboardingFlow's own `Linking.getInitialURL()`/`Linking.addEventListener`
 * handlers, which drive `completeAuthFromUrl`/`resumeFromDraftAndImport` and remain the sole
 * source of truth for finishing sign-in. But once onboarding completes and the `<Stack>` navigator
 * in _layout.tsx mounts, Expo Router independently tries to resolve that same URL against its own
 * route table — and with no `auth-callback` route file, it fell through to `+not-found`
 * ("This screen doesn't exist"). This file exists solely to give that automatic resolution a real,
 * harmless destination instead: it renders nothing but a canvas-colored screen and immediately
 * bounces to the root route, so if it's ever actually seen, it's invisible rather than an error.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const palette = useBrandPalette();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return <View style={{ flex: 1, backgroundColor: palette.canvas }} />;
}
