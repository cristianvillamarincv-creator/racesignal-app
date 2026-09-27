import { useEffect, useRef, type ReactNode } from 'react';

import { fetchInitialPaywallSeenStatus, markInitialPaywallSeen } from '@/lib/db/paywall';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import { shouldAttemptInitialPaywall, shouldMarkInitialPaywallSeen } from '@/lib/initialPaywall';
import { usePremium } from '@/lib/premium';
import { PAYWALL_RESULT, presentPremiumPaywallIfNeeded } from '@/lib/purchases';
import { useAuth } from '@/lib/auth';

/**
 * The one-time post-onboarding Premium paywall (Step 8 Build 9). Renders only inside
 * RootNavigator's real (non-preview) 'app' phase in _layout.tsx — Developer Preview reaches
 * AppStack through a completely separate branch in RootLayoutBody and never mounts this component,
 * so it can never call RevenueCat or touch a real account from a preview session. The `mode !==
 * 'off'` check below is a second, redundant guard on top of that structural one, matching this
 * codebase's existing style (see signal.tsx's isPreviewMode) of never relying on wiring alone for
 * something this consequential.
 *
 * Never blocks rendering: `children` (AppStack) always renders immediately regardless of this
 * component's own state — the paywall, if attempted, appears as a native overlay on top of it, and
 * a technical failure here must never prevent access to the app.
 */
export function InitialPaywallGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { isReady: isPremiumReady, refresh: refreshPremiumStatus } = usePremium();
  const { mode } = useDevPreview();
  // Synchronous, per-mount guard — set the instant an attempt begins, before any await, so this
  // launch can never attempt the paywall more than once regardless of how the effect's
  // dependencies change while the async check/present/mark sequence is in flight. A fresh app
  // launch is a fresh mount, so a later launch can attempt again if the server-side status is
  // still 'not_seen' — exactly the desired "may retry next launch" behavior.
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    if (!isPremiumReady) return;
    if (isDevPreviewAvailable() && mode !== 'off') return;
    if (hasAttemptedRef.current) return;
    hasAttemptedRef.current = true;

    let cancelled = false;
    (async () => {
      const seenStatus = await fetchInitialPaywallSeenStatus(userId);
      if (cancelled) return;
      if (!shouldAttemptInitialPaywall(seenStatus)) return;

      const result = await presentPremiumPaywallIfNeeded();
      if (cancelled) return;

      if (shouldMarkInitialPaywallSeen(result)) {
        await markInitialPaywallSeen(userId);
      }
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        await refreshPremiumStatus();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id, isPremiumReady, mode, refreshPremiumStatus]);

  return <>{children}</>;
}
