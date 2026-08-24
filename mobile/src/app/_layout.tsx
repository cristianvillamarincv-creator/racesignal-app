import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding';
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
        <OnboardingProvider>
          <RootNavigator />
        </OnboardingProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { isReady, hasCompletedOnboarding, completeOnboarding } = useOnboarding();

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) {
    // Splash screen is still covering the app while AsyncStorage resolves.
    return null;
  }

  if (!hasCompletedOnboarding) {
    return <OnboardingFlow onComplete={completeOnboarding} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="race/[id]"
        options={{ headerShown: true, title: 'Race prep', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="results/[id]"
        options={{ headerShown: true, title: 'Result', headerBackTitle: 'Back' }}
      />
      <Stack.Screen
        name="settings"
        options={{ headerShown: true, title: 'Settings', headerBackTitle: 'Back' }}
      />
    </Stack>
  );
}
