// Dynamic Expo config layered over app.json (app.json stays the production source of truth; Expo passes it
// in as `config`).
//
// The variant is chosen EXPLICITLY with APP_VARIANT=development|production. Unset means production, so
// a command that forgets the variable gets the production app identity, never a dev one.
//
// GUARDS, by stage (details in docs/development-environment.md):
//  1. Config evaluation (this file): refuses mismatched variant/backend/RevenueCat settings. A development
//     config with MISSING settings is refused too, except during a LOCAL `eas` CLI evaluation (it runs with
//     .env loading disabled and no EAS variables, so absence proves nothing there; that case only warns).
//     The cloud EAS build evaluates this file again WITH the EAS environment's variables, strictly.
//  2. App startup (src/lib/environment.ts): the same checks run again, always strictly for development, on the
//     values actually inlined into the JS bundle, and throw before the Supabase client or RevenueCat exist.
//
// Only non-secret identifiers live in ./config/environments.json. No credentials are read or stored here.
const environments = require('./config/environments.json');
const { evaluateEnvironment } = require('./config/environmentGuards');

const VARIANTS = ['development', 'production'];
const variant = process.env.APP_VARIANT ?? 'production';
if (!VARIANTS.includes(variant)) {
  throw new Error(`[app.config] APP_VARIANT must be "development" or "production" (got "${variant}").`);
}

const localEasCliEvaluation = Boolean(process.env.EXPO_NO_DOTENV) && !process.env.EAS_BUILD;
const { errors, warnings } = evaluateEnvironment({
  variant,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  revenueCatKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  devProjectRef: environments.development.supabaseProjectRef,
  requireComplete: !localEasCliEvaluation,
});
if (errors.length) {
  throw new Error(`[app.config] Refusing to evaluate the ${variant} config:\n - ${errors.join('\n - ')}`);
}
for (const warning of warnings) console.warn(`[app.config] ${warning}`);

const env = environments[variant];

module.exports = ({ config: expo }) => {
  if (variant === 'production') {
    return { ...expo, extra: { ...expo.extra, appVariant: 'production' } };
  }
  return {
    ...expo,
    name: env.displayName,
    scheme: env.scheme,
    ios: { ...expo.ios, bundleIdentifier: env.bundleIdentifier },
    android: { ...expo.android, package: env.bundleIdentifier },
    extra: { ...expo.extra, appVariant: 'development' },
  };
};
