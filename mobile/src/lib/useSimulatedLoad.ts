import { useEffect, useState } from 'react';

import { DEV_FIXTURE_MODE } from '@/lib/devFixtureMode';

/**
 * Purely cosmetic: returns `true` for `delayMs`, then `false`, so screens can show their
 * loading skeleton briefly on mount. There is no real async data fetch behind this yet.
 */
export function useSimulatedLoad(delayMs = 300): boolean {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return isLoading;
}

export interface FixtureDataState<T> {
  isLoading: boolean;
  isError: boolean;
  data: T;
}

/**
 * Picks the populated or empty fixture based on `DEV_FIXTURE_MODE` and layers the simulated
 * loading flag on top, so a screen only needs one hook call to handle all three demo states.
 */
export function useFixtureData<T>(populated: T, empty: T): FixtureDataState<T> {
  const isLoading = useSimulatedLoad();
  return {
    isLoading,
    isError: DEV_FIXTURE_MODE === 'error',
    data: DEV_FIXTURE_MODE === 'empty' ? empty : populated,
  };
}
