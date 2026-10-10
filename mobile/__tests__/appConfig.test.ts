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

  it('development: Apple capability and the push entitlement are configured; no background mode or other notification options', () => {
    const cfg = evaluateWith(envs, dev);
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications'); // the bare plugin: entitlement only
    expect(cfg.plugins.some((p) => Array.isArray(p) && p[0] === 'expo-notifications')).toBe(false);
    expect(cfg.extra.auth).toMatchObject({ apple: true });
  });

  it('development: Google is a pure feature flag (no plugin, no client IDs in the app); Apple and push come from the flags', () => {
    const cfg = evaluateWith(envs, dev);
    expect(cfg.extra.auth).toEqual({ apple: true, google: true });
    expect(cfg.plugins.some((p) => (Array.isArray(p) ? p[0] : p) === '@react-native-google-signin/google-signin')).toBe(false);
  });

  it('production (release 1.1): Apple capability and Google on, NO push entitlement and no notification plugin (notifications are local only)', () => {
    const cfg = evaluateWith(envs, {});
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p))).not.toContain('expo-notifications');
    expect(cfg.plugins.some((p: unknown) => (Array.isArray(p) ? p[0] : p) === '@react-native-google-signin/google-signin')).toBe(false);
    expect(cfg.extra.auth).toEqual({ apple: true, google: true });
  });

  it('production release configuration is exactly what 1.1 ships: Apple and Google on, push off, the Google Web client ID set, production identity', () => {
    expect(envs.production.features).toEqual({ appleSignIn: true, googleSignIn: true, pushEntitlement: false });
    expect(envs.production.google.webClientId).toMatch(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
    expect(envs.production.bundleIdentifier).toBe('com.cristianvillamarin.racesignal');
    expect(envs.production.scheme).toBe('racesignal');
    expect(envs.production).not.toHaveProperty('supabaseProjectRef');
  });

  it('with every provider off (the Build 18 shape) the production build gets no Apple capability and no extra plugin', () => {
    const off = { ...envs, production: { ...envs.production, features: { appleSignIn: false, googleSignIn: false, pushEntitlement: false } } };
    const cfg = evaluateWith(off, {});
    expect(cfg.ios.usesAppleSignIn).toBeUndefined();
    expect(cfg.plugins).toEqual(['expo-router']);
    expect(cfg.extra.auth).toEqual({ apple: false, google: false });
  });

  it('production flags are ready to flip: turning them on adds the same pieces the development variant has', () => {
    const flipped = { ...envs, production: { ...envs.production, features: { appleSignIn: true, googleSignIn: false, pushEntitlement: true } } };
    const cfg = evaluateWith(flipped, {});
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications');
  });

  it('production with every release flag on matches the development feature set', () => {
    const release = { ...envs, production: { ...envs.production, features: { appleSignIn: true, googleSignIn: true, pushEntitlement: true } } };
    const cfg = evaluateWith(release, {});
    expect(cfg.ios.usesAppleSignIn).toBe(true);
    expect(cfg.plugins).toContain('expo-notifications');
    expect(cfg.extra.auth).toEqual({ apple: true, google: true });
  });
});
