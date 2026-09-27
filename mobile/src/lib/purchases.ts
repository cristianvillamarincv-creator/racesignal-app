import Purchases, { type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

/**
 * Thin wrapper around the RevenueCat SDK (Step 8.3). The RevenueCat App User ID is ALWAYS the
 * authenticated Supabase user id (see PurchasesIdentityBridge in _layout.tsx) — never the
 * athlete's email — so the server-side Signal allowance check (supabase/functions/signal) can look
 * up the same id it already has from the caller's JWT, with no separate identity-mapping step.
 */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

let isConfigured = false;

/** Configures the SDK once, anonymously — identity is established afterward via identifyPurchaser,
 *  once a real Supabase session exists. Never called from Developer Preview's tree (see
 *  _layout.tsx): Developer Preview renders PreviewAuthProvider instead of AuthProvider, and
 *  PurchasesIdentityBridge — the only caller of this function — lives inside the real,
 *  non-preview branch only. */
export function configurePurchases(): void {
  if (isConfigured) return;
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  if (!apiKey) {
    console.warn('[Purchases] EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is not set — RevenueCat will not be configured.');
    return;
  }
  Purchases.configure({ apiKey });
  isConfigured = true;
}

export async function identifyPurchaser(supabaseUserId: string): Promise<CustomerInfo | null> {
  if (!isConfigured) return null;
  try {
    const { customerInfo } = await Purchases.logIn(supabaseUserId);
    return customerInfo;
  } catch (err) {
    console.warn('[Purchases] logIn failed:', err);
    return null;
  }
}

export async function signOutPurchaser(): Promise<void> {
  if (!isConfigured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // Not actionable by the caller — sign-out itself (lib/auth.tsx) always proceeds regardless.
    console.warn('[Purchases] logOut failed:', err);
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isConfigured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    console.warn('[Purchases] getCustomerInfo failed:', err);
    return null;
  }
}

export function isPremiumActive(customerInfo: CustomerInfo | null): boolean {
  return customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!isConfigured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch (err) {
    console.warn('[Purchases] getOfferings failed:', err);
    return null;
  }
}

export type PurchaseOutcome =
  | { kind: 'purchased'; customerInfo: CustomerInfo }
  | { kind: 'cancelled' }
  | { kind: 'error' };

export async function purchasePackage(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { kind: 'purchased', customerInfo };
  } catch (err) {
    const purchasesError = err as { userCancelled?: boolean | null };
    if (purchasesError.userCancelled) return { kind: 'cancelled' };
    console.warn('[Purchases] purchasePackage failed:', err);
    return { kind: 'error' };
  }
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    console.warn('[Purchases] restorePurchases failed:', err);
    return null;
  }
}

/**
 * Presents the RevenueCat-hosted "default" offering paywall (built in the dashboard, Step 8.6/8.7)
 * — never a second, custom-built native paywall. The paywall's own "×" close button is what makes
 * this dismissible (a soft paywall); PAYWALL_RESULT distinguishes purchased/restored from
 * cancelled/error so the caller can decide whether to continue into Signal.
 */
export async function presentPremiumPaywall(): Promise<PAYWALL_RESULT> {
  try {
    return await RevenueCatUI.presentPaywall({});
  } catch (err) {
    console.warn('[Purchases] presentPaywall failed:', err);
    return PAYWALL_RESULT.ERROR;
  }
}

export { PAYWALL_RESULT };
