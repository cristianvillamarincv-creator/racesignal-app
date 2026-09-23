import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth';
import { fetchOnboardingCompletedAt } from '@/lib/db/races';

type Phase = 'onboarding' | 'app';

interface AppPhaseContextValue {
  /** True once the one-time launch classification has resolved. */
  isReady: boolean;
  phase: Phase;
  /** Flips local phase to 'app' immediately — called once OnboardingFlow's own summary step has
   *  reached its terminal state and the athlete taps through. The durable signal itself
   *  (athlete_profiles.onboarding_completed_at) is written separately, by
   *  lib/db/races.ts's markOnboardingComplete, at the point onboarding actually completes —
   *  this just updates what's rendered right now, without a redundant re-query. */
  markOnboardingComplete: () => void;
  /** Forces back to 'onboarding' — used after sign-out. */
  resetToOnboarding: () => void;
}

const AppPhaseContext = createContext<AppPhaseContextValue | null>(null);

/**
 * Classifies a signed-in athlete as "still needs onboarding" or "already onboarded" using one
 * durable, server-side signal — athlete_profiles.onboarding_completed_at — rather than a local
 * AsyncStorage flag (didn't survive a force-close before the athlete tapped through the summary
 * screen) or the mere existence of an athlete_profiles row (observed directly: a row can exist in
 * a broken/incomplete state, e.g. an empty racing_name with zero races, from an interrupted
 * import — existence alone proves nothing about completion).
 *
 * The classification runs exactly ONCE, when auth first becomes ready — not reactively on every
 * `session` change. OnboardingFlow establishes a session mid-flow (before import even starts) and
 * needs to keep running its own importing/summary UI afterward; if this effect re-ran on every
 * session change, it would yank the athlete into the tab stack the instant they authenticate,
 * before their races are even fetched. Instead, OnboardingFlow explicitly calls
 * `markOnboardingComplete()` when it's actually done.
 */
export function AppPhaseProvider({ children }: { children: ReactNode }) {
  const { isReady: authReady, session } = useAuth();
  const [phase, setPhase] = useState<Phase>('onboarding');
  const [classified, setClassified] = useState(false);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    (async () => {
      if (!session) {
        if (!cancelled) {
          setPhase('onboarding');
          setClassified(true);
        }
        return;
      }
      const completedAt = await fetchOnboardingCompletedAt(session.user.id);
      if (cancelled) return;
      setPhase(completedAt ? 'app' : 'onboarding');
      setClassified(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  return (
    <AppPhaseContext.Provider
      value={{
        isReady: classified,
        phase,
        markOnboardingComplete: () => setPhase('app'),
        resetToOnboarding: () => setPhase('onboarding'),
      }}>
      {children}
    </AppPhaseContext.Provider>
  );
}

export function useAppPhase(): AppPhaseContextValue {
  const context = useContext(AppPhaseContext);
  if (!context) {
    throw new Error('useAppPhase must be used within an AppPhaseProvider');
  }
  return context;
}
