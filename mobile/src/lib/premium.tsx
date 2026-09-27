import type { CustomerInfo } from 'react-native-purchases';
import Purchases from 'react-native-purchases';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth';
import { configurePurchases, getCustomerInfo, identifyPurchaser, isPremiumActive, restorePurchases as restorePurchasesSdk, signOutPurchaser } from '@/lib/purchases';

interface PremiumContextValue {
  /** True once RevenueCat identity has resolved for the current session (or resolved to "no
   *  session"), so callers can distinguish "still loading" from "confirmed not premium". */
  isReady: boolean;
  isPremium: boolean;
  customerInfo: CustomerInfo | null;
  /** Re-fetches CustomerInfo from RevenueCat — used after a purchase/restore completes elsewhere
   *  (e.g. the RevenueCat-hosted paywall) to make sure `isPremium` reflects it immediately. */
  refresh: () => Promise<void>;
  restorePurchases: () => Promise<boolean>;
}

export const PremiumContext = createContext<PremiumContextValue | null>(null);

/**
 * Bridges Supabase auth state to RevenueCat identity (Step 8.3). Lives inside AuthProvider in
 * _layout.tsx's real (non-preview) tree only — Developer Preview's PreviewAuthProvider tree never
 * renders this, so RevenueCat is never configured or touched from a preview session. The
 * RevenueCat App User ID is always `session.user.id` (the Supabase auth user id) — never the
 * athlete's email — so the Signal Edge Function's server-side premium check can use the exact same
 * id it already reads from the caller's verified JWT.
 */
export function PurchasesIdentityBridge({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [isReady, setIsReady] = useState(false);
  const loggedInUserId = useRef<string | null>(null);

  useEffect(() => {
    configurePurchases();
    const listener = (info: CustomerInfo) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  useEffect(() => {
    const userId = session?.user.id ?? null;
    if (userId === loggedInUserId.current) return;

    let cancelled = false;
    (async () => {
      if (userId) {
        const info = await identifyPurchaser(userId);
        if (!cancelled) {
          loggedInUserId.current = userId;
          setCustomerInfo(info);
          setIsReady(true);
        }
      } else {
        await signOutPurchaser();
        if (!cancelled) {
          loggedInUserId.current = null;
          setCustomerInfo(null);
          setIsReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  const refresh = useCallback(async () => {
    const info = await getCustomerInfo();
    if (info) setCustomerInfo(info);
  }, []);

  const restorePurchases = useCallback(async () => {
    const info = await restorePurchasesSdk();
    if (!info) return false;
    setCustomerInfo(info);
    return isPremiumActive(info);
  }, []);

  return (
    <PremiumContext.Provider value={{ isReady, isPremium: isPremiumActive(customerInfo), customerInfo, refresh, restorePurchases }}>
      {children}
    </PremiumContext.Provider>
  );
}

export function usePremium(): PremiumContextValue {
  const context = useContext(PremiumContext);
  if (!context) {
    throw new Error('usePremium must be used within a PurchasesIdentityBridge');
  }
  return context;
}
