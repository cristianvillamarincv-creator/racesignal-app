import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'racesignal.onboarding.completed';

interface OnboardingContextValue {
  /** True once the initial AsyncStorage read has resolved. */
  isReady: boolean;
  hasCompletedOnboarding: boolean;
  completeOnboarding: () => void;
  replayOnboarding: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/**
 * Tracks whether the mock race-recovery onboarding has been seen, persisted locally on-device
 * with AsyncStorage — a small key/value store, not a backend or account system. This is the only
 * thing in Milestone A.1 that survives an app restart.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setHasCompletedOnboarding(value === 'true'))
      .catch(() => setHasCompletedOnboarding(false))
      .finally(() => setIsReady(true));
  }, []);

  const completeOnboarding = () => {
    setHasCompletedOnboarding(true);
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
  };

  const replayOnboarding = () => {
    setHasCompletedOnboarding(false);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  return (
    <OnboardingContext.Provider
      value={{ isReady, hasCompletedOnboarding, completeOnboarding, replayOnboarding }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}
