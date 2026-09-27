import type { ReactNode } from 'react';

import { PremiumContext } from '@/lib/premium';

/**
 * Supplies the SAME `PremiumContext` (premium.tsx) the real `PurchasesIdentityBridge` supplies,
 * but as an inert stub — same pattern as previewAuthContext.tsx. This exists only so signal.tsx
 * (reachable from Developer Preview's "browse" mode — see _layout.tsx's AppStack) doesn't crash
 * calling usePremium(): Developer Preview never configures the RevenueCat SDK and never shows the
 * real paywall (signal.tsx's isPreviewMode short-circuit never reaches the code path that would
 * call presentPremiumPaywall or refresh), so `isPremium: false` here is never actually acted on.
 */
export function PreviewPremiumProvider({ children }: { children: ReactNode }) {
  const value = {
    isReady: true,
    isPremium: false,
    customerInfo: null,
    refresh: async () => {},
    restorePurchases: async () => false,
  };

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}
