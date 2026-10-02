import Constants from 'expo-constants';

import environments from '../../config/environments.json';
import { evaluateEnvironment } from '../../config/environmentGuards';

/**
 * Startup guard (stage 2 of the environment guards; stage 1 is app.config.js). Imported for its side
 * effect by supabaseClient.ts and purchases.ts, so a development bundle with missing, production, or
 * mismatched backend/RevenueCat settings throws BEFORE any client exists and never talks to anything.
 *
 * The `process.env.EXPO_PUBLIC_*` reads must stay literal property accesses: Metro inlines them at bundle
 * time, which is exactly the set of values the running app will use.
 */
export type AppVariant = 'development' | 'production';

export function getAppVariant(): AppVariant {
  const variant = Constants.expoConfig?.extra?.appVariant;
  // Same default as app.config.js: anything that is not explicitly "development" is the production app.
  return variant === 'development' ? 'development' : 'production';
}

export function assertEnvironment(
  settings: { supabaseUrl?: string; supabaseAnonKey?: string; revenueCatKey?: string },
  variant: AppVariant = getAppVariant(),
): void {
  const { errors, warnings } = evaluateEnvironment({
    variant,
    ...settings,
    devProjectRef: environments.development.supabaseProjectRef,
    requireComplete: variant === 'development',
  });
  if (errors.length) {
    throw new Error(`[environment] Refusing to start the ${variant} app:\n - ${errors.join('\n - ')}`);
  }
  for (const warning of warnings) console.warn(`[environment] ${warning}`);
}

assertEnvironment({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  revenueCatKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
});
