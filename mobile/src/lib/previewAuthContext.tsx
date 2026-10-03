import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/lib/auth';

const NOT_AVAILABLE_MESSAGE = 'Not available in Developer Preview';

/**
 * Supplies the SAME `AuthContext` (auth.tsx) the real `AuthProvider` supplies, but as an inert
 * stub: `session: null` always (Developer Preview never holds a real session), and every action
 * resolves to a safety-net error rather than ever touching Supabase Auth. This exists only so
 * screens that call `useAuth()` (ask.tsx, signal.tsx) don't crash when mounted under preview — none
 * of these functions should ever actually be invoked along the preview flow built in
 * _layout.tsx/signal.tsx (browse mode never calls them; onboardingReplay's simulated sign-in short-
 * circuits before reaching real auth calls) — they're a defensive fallback only.
 */
export function PreviewAuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextValue = {
    isReady: true,
    session: null,
    requestMagicLink: async () => ({ error: NOT_AVAILABLE_MESSAGE }),
    signInWithProvider: async () => ({ status: 'error', message: NOT_AVAILABLE_MESSAGE }),
    linkProvider: async () => ({ status: 'error', message: NOT_AVAILABLE_MESSAGE }),
    getConnectedProviders: async () => null,
    completeAuthFromUrl: async () => ({ error: NOT_AVAILABLE_MESSAGE, userId: null }),
    signInWithPassword: async () => ({ error: NOT_AVAILABLE_MESSAGE, userId: null }),
    signOut: async () => {},
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
