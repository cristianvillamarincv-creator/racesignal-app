import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { HeaderBackButton } from '@/components/HeaderBackButton';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { AppPhaseProvider, useAppPhase } from '@/lib/appPhase';
import { AuthProvider } from '@/lib/auth';
import { useBrandPalette } from '@/lib/brandTheme';
import { DevPreviewProvider, useDevPreview } from '@/lib/devPreview';
import { PreviewAuthProvider } from '@/lib/previewAuthContext';
import { PreviewAthleteRacesProvider } from '@/lib/previewRacesContext';
import { AthleteRacesProvider } from '@/lib/racesContext';

SplashScreen.preventAutoHideAsync();

/** Native-header chrome (Settings, Find My Races, Add/Edit race, Race prep, Signal) now follows
 *  the same "Race Morning Precision" palette as the fully-migrated screens, and responds to the
 *  device's light/dark setting instead of being permanently dark. */
function useRaceSignalNavigationTheme() {
  const palette = useBrandPalette();
  const isDark = palette.statusBarStyle === 'light';
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: isDark,
    colors: {
      ...base.colors,
      background: palette.canvas,
      card: palette.headerBackground,
      text: palette.ink,
      border: palette.hairline,
      primary: palette.signalBlue,
    },
  };
}

export default function RootLayout() {
  const raceSignalTheme = useRaceSignalNavigationTheme();
  const palette = useBrandPalette();
  return (
    <SafeAreaProvider>
      {/* Wraps EVERYTHING, outermost alongside SafeAreaProvider, so Developer Preview's mode is
          available regardless of auth/onboarding phase — see lib/devPreview.tsx. This provider by
          itself holds no fixture data and no stub session; it only tracks which preview surface (if
          any) is showing. */}
      <DevPreviewProvider>
        <ThemeProvider value={raceSignalTheme}>
          <StatusBar style={palette.statusBarStyle} />
          <RootLayoutBody />
        </ThemeProvider>
      </DevPreviewProvider>
    </SafeAreaProvider>
  );
}

/**
 * Branches between the real app and Developer Preview's two modes (see lib/devPreview.tsx) —
 * DevPreviewProvider wraps everything above this, so this branch can read `mode` regardless of
 * auth/onboarding phase. 'off' is the default, and the ONLY mode a release/TestFlight build can
 * ever reach: every entry point into 'browse'/'onboardingReplay' is itself gated by
 * isDevPreviewAvailable() (OnboardingFlow's IdentityStep), which is false whenever `__DEV__` is
 * false. The 'off' path below is byte-for-byte the same tree this file rendered before Developer
 * Preview existed.
 */
function RootLayoutBody() {
  const { mode, exit, enterBrowse } = useDevPreview();

  if (mode === 'browse') {
    // Real AuthProvider/AppPhaseProvider/AthleteRacesProvider are replaced with stub/fixture-backed
    // providers — no real session is ever held, and no lib/db/races.ts, lib/db/signal.ts, or
    // lib/signal.ts network call is ever reachable from this branch. AppStack renders the exact
    // same Stack.Screen configuration as the real app, minus race/add, settings/index and
    // find-races (excluded via Stack.Protected — see AppStack's own comment for why that specific
    // mechanism, not just omitting the Stack.Screen entries, is required here).
    return (
      <PreviewAuthProvider>
        <PreviewAthleteRacesProvider>
          <View style={styles.previewOverlayContainer}>
            <AppStack preview />
            <ExitPreviewButton onExit={exit} />
          </View>
        </PreviewAthleteRacesProvider>
      </PreviewAuthProvider>
    );
  }

  if (mode === 'onboardingReplay') {
    // Reuses the real OnboardingFlow component (not a duplicate) with `simulateAuth` — see that
    // file's handling of `simulateAuth`/`onSimulatedComplete`. `onComplete` is a no-op: the real
    // completion path (runImport -> markOnboardingComplete -> onComplete) is only ever reachable
    // once a real session exists, which never happens here (PreviewAuthProvider's session is always
    // null and its completeAuthFromUrl always returns no userId), so this is never actually called.
    // "Completing" the simulated flow instead calls `enterBrowse`, landing the tester in the same
    // fixture-backed Tabs preview as the "Browse app with sample data" entry point.
    return (
      <PreviewAuthProvider>
        <PreviewAthleteRacesProvider>
          <View style={styles.previewOverlayContainer}>
            <OnboardingFlow onComplete={() => {}} simulateAuth onSimulatedComplete={enterBrowse} />
            <ExitPreviewButton onExit={exit} />
          </View>
        </PreviewAthleteRacesProvider>
      </PreviewAuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AppPhaseProvider>
        <AthleteRacesProvider>
          <RootNavigator />
        </AthleteRacesProvider>
      </AppPhaseProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const { isReady, phase, markOnboardingComplete } = useAppPhase();
  const { returnToSettingsOnExit, consumeReturnToSettingsFlag } = useDevPreview();
  const router = useRouter();

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  // Settings' "Preview onboarding" row exits back through this same real tree, re-authenticated
  // with the same real session (never touched during the replay) — this is the one-shot hop back
  // to Settings specifically, rather than leaving the tester on the default tab. Runs once, only
  // when the flag was actually set (the signed-out IdentityStep entry point never sets it, so this
  // never fires for that path).
  useEffect(() => {
    if (isReady && phase === 'app' && returnToSettingsOnExit) {
      router.push('/settings');
      consumeReturnToSettingsFlag();
    }
  }, [isReady, phase, returnToSettingsOnExit, router, consumeReturnToSettingsFlag]);

  if (!isReady) {
    // Splash screen is still covering the app while the one-time launch classification resolves.
    return null;
  }

  if (phase === 'onboarding') {
    return <OnboardingFlow onComplete={markOnboardingComplete} />;
  }

  return <AppStack preview={false} />;
}

/**
 * The app's real Stack, extracted so Developer Preview's "browse" mode (RootLayoutBody above) can
 * render the EXACT SAME Stack.Screen configuration rather than a second, hand-duplicated one.
 * `preview` only toggles a `Stack.Protected` guard around three screens: `race/add`,
 * `settings/index`, `find-races`.
 *
 * These three specifically must never be reachable from preview — `settings/index` calls the REAL
 * `useAppPhase()` (for `resetToOnboarding`) and `useAuth()` (for `signOut`), and NEITHER of those
 * providers exists under preview's tree (it renders `PreviewAuthProvider`/`PreviewAthleteRacesProvider`
 * only, no `AppPhaseProvider`), so reaching that screen would throw. `Stack.Protected` is used
 * rather than simply omitting these three `Stack.Screen` entries because expo-router does NOT treat
 * an omitted entry as excluding that file-based route from the navigator — it would still be
 * reachable (via the header/add-race buttons already wired up in the reused, unmodified
 * `(tabs)/_layout.tsx`), just rendered with default screenOptions. `Stack.Protected`'s `guard` is
 * expo-router's actual routes-exclusion mechanism (see its `protectedScreens` handling), so with
 * `guard={false}` these three are genuinely removed from the navigator — tapping into one falls
 * through to the ordinary `+not-found` screen instead of crashing.
 */
function AppStack({ preview }: { preview: boolean }) {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="race/[id]"
        options={{ headerShown: true, title: 'Race prep', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="results/[id]"
        options={{ headerShown: true, title: 'Result', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="signal"
        options={{ headerShown: true, title: 'Signal', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Protected guard={!preview}>
        <Stack.Screen
          name="race/add"
          options={{ headerShown: true, title: 'Add a race', headerLeft: () => <HeaderBackButton /> }}
        />
        <Stack.Screen
          name="settings/index"
          options={{ headerShown: true, title: 'Settings', headerLeft: () => <HeaderBackButton /> }}
        />
        <Stack.Screen
          name="find-races"
          options={{ headerShown: true, title: 'Find my races', headerLeft: () => <HeaderBackButton /> }}
        />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Persistent, clearly-labeled way back to the real app from either Developer Preview surface
 * (browse or onboardingReplay) — pinned near the top-right safe-area corner, always on top,
 * rendered as a sibling of the preview content it floats over. Calls `useDevPreview().exit()`,
 * flipping `mode` back to `'off'` — `RootLayoutBody` then renders the real `RootNavigator` (real
 * `AuthProvider`/`AppPhaseProvider`), landing back on the real onboarding identity screen, since a
 * preview session never persisted any real auth/phase state.
 */
function ExitPreviewButton({ onExit }: { onExit: () => void }) {
  const insets = useSafeAreaInsets();
  const palette = useBrandPalette();
  return (
    <Pressable
      onPress={onExit}
      accessibilityRole="button"
      accessibilityLabel="Exit Developer Preview"
      style={[
        exitButtonStyles.button,
        // Sits just below the native header bar (rather than directly in the safe-area inset,
        // where a screen's own header content — the tabs' add/search/avatar buttons, or a pushed
        // screen's back button — already lives) so it never overlaps a real control.
        { top: insets.top + 52, backgroundColor: palette.canvasElevated, borderColor: palette.hairline },
      ]}>
      <Text style={[exitButtonStyles.label, { color: palette.danger }]}>Exit Developer Preview</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewOverlayContainer: {
    flex: 1,
  },
});

const exitButtonStyles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 12,
    zIndex: 1000,
    elevation: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});
