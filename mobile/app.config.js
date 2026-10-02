// Dynamic Expo config layered over app.json (app.json stays the production source of truth).
//
// The variant is chosen EXPLICITLY with APP_VARIANT=development|production. Unset means production, so
// a command that forgets the variable gets the production app identity, never a dev one. The guards below
// then refuse to evaluate the config when the backend/purchase credentials in the environment don't match
// the variant, so a development app can never silently talk to production (or the reverse).
//
// Only non-secret identifiers live in ./config/environments.json. No credentials are read or stored here.
const environments = require('./config/environments.json');

const VARIANTS = ['development', 'production'];
const variant = process.env.APP_VARIANT ?? 'production';
if (!VARIANTS.includes(variant)) {
  throw new Error(`[app.config] APP_VARIANT must be "development" or "production" (got "${variant}").`);
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const revenueCatKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';
const devRef = environments.development.supabaseProjectRef;
const pointsAtDevProject = supabaseUrl.includes(devRef);

if (variant === 'development') {
  // A MISSING URL is not refused: `eas build` evaluates this file locally with .env loading disabled and
  // only the profile's `env`, and a missing URL can only ever mean "no backend" (supabaseClient.ts falls
  // back to an unreachable placeholder), never "the wrong backend". A WRONG URL is refused below.
  if (!supabaseUrl && !process.env.EXPO_NO_DOTENV && !process.env.EAS_BUILD) {
    console.warn(
      '[app.config] APP_VARIANT=development but EXPO_PUBLIC_SUPABASE_URL is not set — the app will have no backend. ' +
        'Put the racesignal-dev values in mobile/.env.development.',
    );
  }
  if (supabaseUrl && !pointsAtDevProject) {
    throw new Error(
      '[app.config] APP_VARIANT=development but EXPO_PUBLIC_SUPABASE_URL is not the racesignal-dev project. ' +
        'A development app must never use another backend.',
    );
  }
  if (revenueCatKey && !revenueCatKey.startsWith('test_')) {
    throw new Error(
      '[app.config] APP_VARIANT=development must use the RevenueCat dev project Test Store key (test_...), ' +
        'not a production key.',
    );
  }
} else {
  if (pointsAtDevProject) {
    throw new Error(
      '[app.config] APP_VARIANT is production but EXPO_PUBLIC_SUPABASE_URL is the racesignal-dev project. ' +
        'Run development sessions with APP_VARIANT=development (npm run start:dev / start:go).',
    );
  }
  if (revenueCatKey.startsWith('test_')) {
    throw new Error('[app.config] A RevenueCat Test Store key (test_...) must never be used in the production variant.');
  }
}

const env = environments[variant];

// Expo passes the static app.json `expo` object in as `config`, so app.json remains the production source.
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
