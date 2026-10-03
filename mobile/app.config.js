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
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
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

// Native sign-in / push configuration, gated per variant by config/environments.json `features` so the
// production build is unchanged until the owner turns a feature on for a release.
const features = env.features ?? {};
const googleIosClientId = env.google?.iosClientId ?? null;
const googleWebClientId = env.google?.webClientId ?? null;
// Google's iOS URL scheme is the iOS client ID reversed ("123-abc.apps.googleusercontent.com" ->
// "com.googleusercontent.apps.123-abc").
const googleIosUrlScheme =
  googleIosClientId && googleIosClientId.endsWith('.apps.googleusercontent.com')
    ? `com.googleusercontent.apps.${googleIosClientId.replace('.apps.googleusercontent.com', '')}`
    : null;
const googleEnabled = Boolean(features.googleSignIn && googleIosUrlScheme && googleWebClientId);
if (features.googleSignIn && !googleEnabled) {
  const message =
    `${variant}: googleSignIn is on in config/environments.json but google.iosClientId/webClientId are missing or malformed, ` +
    'so Google sign-in cannot be included in this build.';
  // A production build must never silently ship without a feature the release configuration says is on.
  if (variant === 'production') throw new Error(`[app.config] ${message}`);
  console.warn(`[app.config] ${message}`);
}

// Expo auto-applies the config plugins of installed packages (expo-apple-authentication adds the Sign in with
// Apple entitlement, expo-notifications adds aps-environment) even when app.json never lists them. A variant
// whose feature flag is off must not inherit them, or the production binary and App ID capabilities would
// change before the owner enables the feature. These mods remove exactly those keys, nothing else.
function withoutDisabledEntitlements(expo) {
  const removeEntitlements = [];
  if (!features.appleSignIn) removeEntitlements.push('com.apple.developer.applesignin');
  if (!features.pushEntitlement) removeEntitlements.push('aps-environment');
  let config = expo;
  if (removeEntitlements.length > 0) {
    config = withEntitlementsPlist(config, (cfg) => {
      for (const key of removeEntitlements) delete cfg.modResults[key];
      return cfg;
    });
  }
  if (!features.appleSignIn) {
    // expo-apple-authentication also sets this Info.plist key (button localizations); Build 18 did not have it.
    config = withInfoPlist(config, (cfg) => {
      delete cfg.modResults.CFBundleAllowMixedLocalizations;
      return cfg;
    });
  }
  return config;
}

function withNativeFeatures(expo) {
  const plugins = [...(expo.plugins ?? [])];
  if (googleEnabled) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]);
  // expo-notifications: entitlement only (aps-environment). No background mode, no permission prompt, no
  // token registration anywhere in the app yet.
  if (features.pushEntitlement) plugins.push('expo-notifications');
  return {
    ...expo,
    ios: { ...expo.ios, ...(features.appleSignIn ? { usesAppleSignIn: true } : {}) },
    plugins,
    extra: {
      ...expo.extra,
      appVariant: variant,
      // Read at runtime by src/lib/socialAuthConfig.ts to decide which provider buttons exist.
      auth: {
        apple: Boolean(features.appleSignIn),
        google: googleEnabled,
        googleWebClientId: googleEnabled ? googleWebClientId : null,
        googleIosClientId: googleEnabled ? googleIosClientId : null,
      },
    },
  };
}

module.exports = ({ config: expo }) => {
  const withFeatures = withoutDisabledEntitlements(withNativeFeatures(expo));
  if (variant === 'production') return withFeatures;
  return {
    ...withFeatures,
    name: env.displayName,
    scheme: env.scheme,
    ios: { ...withFeatures.ios, bundleIdentifier: env.bundleIdentifier },
    android: { ...expo.android, package: env.bundleIdentifier },
  };
};
