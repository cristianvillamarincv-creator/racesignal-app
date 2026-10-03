import { requireOptionalNativeModule } from 'expo-modules-core';
import { TurboModuleRegistry } from 'react-native';

/**
 * Whether the installed binary actually contains the native half of a sign-in SDK. Checked BEFORE the JS
 * package is required: requiring `@react-native-google-signin/google-signin` in a binary without its native
 * module throws inside Metro's module initializer (and logs a red error), and a module that failed to
 * initialize can come back as `undefined` on the next require. These checks never throw and load nothing.
 */
export function hasAppleAuthenticationNative(): boolean {
  try {
    return requireOptionalNativeModule('ExpoAppleAuthentication') != null;
  } catch {
    return false;
  }
}

export function hasGoogleSignInNative(): boolean {
  try {
    return TurboModuleRegistry.get('RNGoogleSignin') != null;
  } catch {
    return false;
  }
}
