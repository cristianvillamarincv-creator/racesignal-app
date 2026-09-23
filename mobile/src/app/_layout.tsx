import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { HeaderBackButton } from '@/components/HeaderBackButton';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { AppPhaseProvider, useAppPhase } from '@/lib/appPhase';
import { AuthProvider } from '@/lib/auth';
import { AthleteRacesProvider } from '@/lib/racesContext';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

const raceSignalTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={raceSignalTheme}>
        <StatusBar style="light" />
        <AuthProvider>
          <AppPhaseProvider>
            <AthleteRacesProvider>
              <RootNavigator />
            </AthleteRacesProvider>
          </AppPhaseProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { isReady, phase, markOnboardingComplete } = useAppPhase();

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) {
    // Splash screen is still covering the app while the one-time launch classification resolves.
    return null;
  }

  if (phase === 'onboarding') {
    return <OnboardingFlow onComplete={markOnboardingComplete} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="race/[id]"
        options={{ headerShown: true, title: 'Race prep', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="race/add"
        options={{ headerShown: true, title: 'Add a race', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="results/[id]"
        options={{ headerShown: true, title: 'Result', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="settings"
        options={{ headerShown: true, title: 'Settings', headerLeft: () => <HeaderBackButton /> }}
      />
      <Stack.Screen
        name="find-races"
        options={{ headerShown: true, title: 'Find my races', headerLeft: () => <HeaderBackButton /> }}
      />
    </Stack>
  );
}
