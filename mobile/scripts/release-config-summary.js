// Prints what the PRODUCTION variant is configured to ship, straight from app.config.js, so the release
// checklist (docs/release-1.1-checklist.md) can be checked by looking at facts rather than memory:
//   npm run release:config
// Evaluating the production config also runs its guards (it throws if a feature is switched on without the
// identifiers it needs). Prints no secrets: only flags and public identifiers.
process.env.APP_VARIANT = 'production';
const factory = require('../app.config.js');
const cfg = factory({ config: { name: 'RaceSignal', ios: {}, plugins: [], extra: {} } });
const plugins = (cfg.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
console.log(
  JSON.stringify(
    {
      variant: cfg.extra.appVariant,
      bundleIdentifier: cfg.ios.bundleIdentifier ?? 'com.cristianvillamarin.racesignal (from app.json)',
      appleSignInEntitlement: cfg.ios.usesAppleSignIn === true,
      pushEntitlementPlugin: plugins.includes('expo-notifications'),
      googleSignInPlugin: plugins.includes('@react-native-google-signin/google-signin'),
      runtimeAuthFlags: cfg.extra.auth,
    },
    null,
    2,
  ),
);
