/**
 * Stage 1 of the environment guards: app.config.js itself. Evaluated in isolation with a controlled
 * process.env; the real config/environments.json supplies the dev project ref.
 */
import environments from '../config/environments.json';

const DEV_REF = environments.development.supabaseProjectRef;
const jwtFor = (ref: string) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ ref, role: 'anon' })).toString('base64url'), 'sig'].join('.');

const KEYS = [
  'APP_VARIANT',
  'EXPO_NO_DOTENV',
  'EAS_BUILD',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  KEYS.forEach((k) => (saved[k] = process.env[k]));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  jest.restoreAllMocks();
});

type Cfg = { name?: string; scheme?: string; ios: { bundleIdentifier: string }; extra: { appVariant: string } };
function evaluate(env: Record<string, string>): Cfg {
  KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  let result!: Cfg;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- config is evaluated at require time
    const factory = require('../app.config.js');
    result = factory({ config: { name: 'RaceSignal', scheme: 'racesignal', ios: { bundleIdentifier: 'com.cristianvillamarin.racesignal' }, extra: {} } });
  });
  return result;
}

const dev = {
  APP_VARIANT: 'development',
  EXPO_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtFor(DEV_REF),
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'test_abc',
};

describe('app.config.js', () => {
  it('produces the dev identity for correct development settings', () => {
    const cfg = evaluate(dev);
    expect(cfg).toMatchObject({ name: 'RaceSignal Dev', scheme: 'racesignal-dev', extra: { appVariant: 'development' } });
    expect(cfg.ios.bundleIdentifier).toBe('com.cristianvillamarin.racesignal.dev');
  });

  it('defaults to the unchanged production identity when APP_VARIANT is unset', () => {
    const cfg = evaluate({});
    expect(cfg).toMatchObject({ name: 'RaceSignal', scheme: 'racesignal', extra: { appVariant: 'production' } });
    expect(cfg.ios.bundleIdentifier).toBe('com.cristianvillamarin.racesignal');
  });

  it('rejects an unknown variant', () => {
    expect(() => evaluate({ APP_VARIANT: 'staging' })).toThrow(/APP_VARIANT/);
  });

  it('refuses development with missing settings (expo start / cloud build)', () => {
    expect(() => evaluate({ APP_VARIANT: 'development' })).toThrow(/missing/);
    expect(() => evaluate({ ...dev, EAS_BUILD: 'true', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_SUPABASE_URL: '' })).toThrow(/missing/);
  });

  it('only warns for development with missing settings in a local eas CLI evaluation', () => {
    expect(evaluate({ APP_VARIANT: 'development', EXPO_NO_DOTENV: '1' }).extra.appVariant).toBe('development');
  });

  it('refuses development with the wrong backend or RevenueCat key, even in a local eas CLI evaluation', () => {
    expect(() => evaluate({ ...dev, EXPO_PUBLIC_SUPABASE_URL: 'https://prodprojectref0000.supabase.co' })).toThrow(/another host/);
    expect(() => evaluate({ ...dev, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_x' })).toThrow(/Test Store/);
  });

  it('refuses production with dev settings', () => {
    expect(() => evaluate({ APP_VARIANT: 'production', EXPO_PUBLIC_SUPABASE_URL: dev.EXPO_PUBLIC_SUPABASE_URL })).toThrow(/racesignal-dev/);
    expect(() => evaluate({ APP_VARIANT: 'production', EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'test_abc' })).toThrow(/Test Store/);
  });
});

describe('app.config.js: native sign-in and push configuration (gated per variant)', () => {
  const envs = jest.requireActual('../config/environments.json');
  type Plugins = (string | [string, Record<string, unknown>])[];
  type FullCfg = { ios: { usesAppleSignIn?: boolean }; plugins: Plugins; extra: { auth: Record<string, unknown> } };

  function evaluateWith(environmentsOverride: unknown, env: Record<string, string>): FullCfg {
    KEYS.forEach((k) => delete process.env[k]);
    Object.assign(process.env, env);
    let result!: FullCfg;
    jest.isolateModules(() => {
      jest.doMock('../config/environments.json', () => environmentsOverride);
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- config is evaluated at require time
      const factory = require('../app.config.js');
      result = factory({ config: { name: 'RaceSignal', scheme: 'racesignal', ios: {}, plugins: ['expo-router'], extra: {} } });
    });
    jest.dontMock('../config/environments.json');
    return result;
  }

  const withDevGoogle = (ios: string | null, web: string | null) => ({
    ...envs,
    development: { ...envs.development, google: { iosClientId: ios, webClientId: web } },
  });

  it('development: Apple capability and the push entitlement are configured; no background mode or other notification options', () => {
    const cfg = evaluateWith(envs, dev);
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications'); // the bare plugin: entitlement only
    expect(cfg.plugins.some((p) => Array.isArray(p) && p[0] === 'expo-notifications')).toBe(false);
    expect(cfg.extra.auth).toMatchObject({ apple: true });
  });

  it('development: Google is left out (button hidden, no plugin) until both client IDs exist', () => {
    const cfg = evaluateWith(envs, dev);
    expect(cfg.extra.auth).toMatchObject({ google: false, googleIosClientId: null, googleWebClientId: null });
    expect(cfg.plugins.some((p) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin')).toBe(false);
    expect(evaluateWith(withDevGoogle('123-abc.apps.googleusercontent.com', null), dev).extra.auth).toMatchObject({ google: false });
  });

  it('development: with both Google client IDs the plugin gets the reversed iOS client ID and the button is enabled', () => {
    const cfg = evaluateWith(withDevGoogle('123-abc.apps.googleusercontent.com', 'web-1.apps.googleusercontent.com'), dev);
    expect(cfg.plugins).toContainEqual(['@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.123-abc' }]);
    expect(cfg.extra.auth).toEqual({
      apple: true,
      google: true,
      googleWebClientId: 'web-1.apps.googleusercontent.com',
      googleIosClientId: '123-abc.apps.googleusercontent.com',
    });
  });

  it('production: no Apple capability, no push entitlement, no Google plugin, every provider off (unchanged until the owner enables it)', () => {
    const cfg = evaluateWith(envs, {});
    expect(cfg.ios.usesAppleSignIn).toBeUndefined();
    expect(cfg.plugins).toEqual(['expo-router']);
    expect(cfg.extra.auth).toEqual({ apple: false, google: false, googleWebClientId: null, googleIosClientId: null });
  });

  it('production flags are ready to flip: turning them on adds the same pieces the development variant has', () => {
    const flipped = { ...envs, production: { ...envs.production, features: { appleSignIn: true, googleSignIn: false, pushEntitlement: true } } };
    const cfg = evaluateWith(flipped, {});
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications');
  });

  it('production refuses to build with Google switched on but its client IDs missing (never silently ships without it)', () => {
    const flipped = { ...envs, production: { ...envs.production, features: { appleSignIn: true, googleSignIn: true, pushEntitlement: true } } };
    expect(() => evaluateWith(flipped, {})).toThrow(/googleSignIn is on/);
  });

  it('production with every release flag on and Google IDs filled in matches the development feature set', () => {
    const release = {
      ...envs,
      production: {
        ...envs.production,
        features: { appleSignIn: true, googleSignIn: true, pushEntitlement: true },
        google: { iosClientId: '999-prod.apps.googleusercontent.com', webClientId: 'web-prod.apps.googleusercontent.com' },
      },
    };
    const cfg = evaluateWith(release, {});
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications');
    expect(cfg.plugins).toContainEqual(['@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.999-prod' }]);
    expect(cfg.extra.auth).toMatchObject({ apple: true, google: true });
  });
});
