import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Gates the ENTIRE Developer Preview feature (see OnboardingFlow's IdentityStep entry point and
 * _layout.tsx's preview branch) behind BOTH signals at once:
 *  - `__DEV__` — true only inside a dev-client/Metro build, false in any release/TestFlight build,
 *    regardless of anything else.
 *  - `EXPO_PUBLIC_ENABLE_DEV_PREVIEW === 'true'` — an explicit, separate opt-in (set in
 *    mobile/.env for local dev), so the feature stays off even in a dev build unless a developer
 *    deliberately turned it on.
 * This is a plain, side-effect-free function (not routed through DevPreviewProvider/useDevPreview)
 * specifically so any file can check availability — e.g. to decide whether to render an entry
 * point at all — without needing to be mounted under the provider first.
 *
 * Nothing about this feature is reachable except by an explicit tap on a clearly-labeled entry
 * point (see IdentityStep's "Developer preview" link) — never auto-entered from an auth error or
 * any other implicit fallback.
 */
export function isDevPreviewAvailable(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW === 'true';
}

export type DevPreviewMode = 'off' | 'browse' | 'onboardingReplay';

interface DevPreviewContextValue {
  mode: DevPreviewMode;
  /** True only when onboarding replay was entered from the signed-in Settings screen (via
   *  enterOnboardingReplayFromSettings) rather than the signed-out IdentityStep entry point. Tells
   *  the real app tree (see _layout.tsx's RootNavigator) to navigate back to Settings once it
   *  remounts after exit, instead of landing on the default tab — the real session/phase were never
   *  touched while previewing, so remounting just re-authenticates the same real athlete. */
  returnToSettingsOnExit: boolean;
  /** Enter the fixture-backed Tabs/Stack preview (see PreviewAuthProvider/PreviewAthleteRacesProvider
   *  in _layout.tsx) — real Supabase auth/network paths are never touched. */
  enterBrowse: () => void;
  /** Enter a replay of the real OnboardingFlow component with `simulateAuth` — see
   *  OnboardingFlow.tsx's `simulateAuth`/`onSimulatedComplete` props. Used by the signed-out
   *  IdentityStep entry point — exiting lands on the real (signed-out) onboarding flow as usual. */
  enterOnboardingReplay: () => void;
  /** Same replay as enterOnboardingReplay, entered instead from the signed-in Settings screen's
   *  "Preview onboarding" row — sets returnToSettingsOnExit so exiting returns to Settings rather
   *  than the default tab. Never signs out, never touches the real session (PreviewAuthProvider
   *  supplies a fully separate stub session for the duration of the replay; the real session stays
   *  exactly as it was, untouched, the whole time). */
  enterOnboardingReplayFromSettings: () => void;
  /** Consumes (resets) returnToSettingsOnExit once the real app tree has acted on it — called
   *  exactly once, right after navigating back to Settings, so it doesn't fire again on ordinary
   *  later app usage. */
  consumeReturnToSettingsFlag: () => void;
  /** Back to 'off'. _layout.tsx then renders the real RootNavigator (real AuthProvider/
   *  AppPhaseProvider) — for the signed-out entry point this lands on the real onboarding identity
   *  screen (a preview session never persists any real auth/phase state); for the signed-in
   *  Settings entry point, the real session/phase were never torn down, so this re-authenticates
   *  the same real athlete and (via returnToSettingsOnExit) returns to Settings. */
  exit: () => void;
}

const DevPreviewContext = createContext<DevPreviewContextValue | null>(null);

/**
 * Wraps the whole app (see _layout.tsx's RootLayout, outermost alongside SafeAreaProvider) so it's
 * available regardless of auth/onboarding phase. This provider only tracks which preview surface
 * (if any) is currently showing — it never itself holds fixture data or a stub session; those live
 * in PreviewAthleteRacesProvider/PreviewAuthProvider, rendered by _layout.tsx only while a mode is
 * active.
 */
export function DevPreviewProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DevPreviewMode>('off');
  const [returnToSettingsOnExit, setReturnToSettingsOnExit] = useState(false);

  const enterBrowse = useCallback(() => setMode('browse'), []);
  const enterOnboardingReplay = useCallback(() => setMode('onboardingReplay'), []);
  const enterOnboardingReplayFromSettings = useCallback(() => {
    setReturnToSettingsOnExit(true);
    setMode('onboardingReplay');
  }, []);
  const consumeReturnToSettingsFlag = useCallback(() => setReturnToSettingsOnExit(false), []);
  const exit = useCallback(() => setMode('off'), []);

  const value = useMemo<DevPreviewContextValue>(
    () => ({
      mode,
      returnToSettingsOnExit,
      enterBrowse,
      enterOnboardingReplay,
      enterOnboardingReplayFromSettings,
      consumeReturnToSettingsFlag,
      exit,
    }),
    [mode, returnToSettingsOnExit, enterBrowse, enterOnboardingReplay, enterOnboardingReplayFromSettings, consumeReturnToSettingsFlag, exit],
  );

  return <DevPreviewContext.Provider value={value}>{children}</DevPreviewContext.Provider>;
}

export function useDevPreview(): DevPreviewContextValue {
  const context = useContext(DevPreviewContext);
  if (!context) {
    throw new Error('useDevPreview must be used within a DevPreviewProvider');
  }
  return context;
}
