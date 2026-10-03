import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Whether the installed binary actually contains the native half of a sign-in SDK. Checked BEFORE the JS
 * package is required: requiring a package whose native module is missing throws inside Metro's module
 * initializer (and logs a red error), and a module that failed to initialize can come back as `undefined` on
 * the next require. This check never throws and loads nothing. (Google needs no native module: it uses the
 * Supabase OAuth redirect flow, see socialAuth.ts.)
 */
export function hasAppleAuthenticationNative(): boolean {
  try {
    return requireOptionalNativeModule('ExpoAppleAuthentication') != null;
  } catch {
    return false;
  }
}
