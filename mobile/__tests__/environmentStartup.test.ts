/**
 * Stage 2 of the environment guards: importing the Supabase client (or purchases) in a bundle whose
 * settings are missing or mismatched must throw before any client is created. The real development
 * project ref comes from config/environments.json.
 */
import environments from '../config/environments.json';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const DEV_REF = environments.development.supabaseProjectRef;
const jwtFor = (ref: string) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ ref, role: 'anon' })).toString('base64url'), 'sig'].join('.');

const ENV_KEYS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] = process.env[k]));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  jest.restoreAllMocks();
});

function loadSupabaseClient(variant: string | undefined, env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  jest.resetModules();
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: variant ? { extra: { appVariant: variant } } : null },
  }));
  let mod: unknown;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after doMock/env setup
    mod = require('@/lib/supabaseClient');
  });
  return mod;
}

const devEnv = {
  EXPO_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtFor(DEV_REF),
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'test_abc',
};
const prodEnv = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://someprodproject0000.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtFor('someprodproject0000'),
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_abc',
};

describe('app startup guard', () => {
  it('starts the development app with correct development settings', () => {
    expect(() => loadSupabaseClient('development', devEnv)).not.toThrow();
  });

  it('refuses to start the development app with missing settings', () => {
    expect(() => loadSupabaseClient('development', {})).toThrow(/Refusing to start the development app[\s\S]*missing/);
    expect(() => loadSupabaseClient('development', { ...devEnv, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: '' })).toThrow(/missing/);
  });

  it('refuses to start the development app against the production backend', () => {
    expect(() => loadSupabaseClient('development', { ...devEnv, EXPO_PUBLIC_SUPABASE_URL: prodEnv.EXPO_PUBLIC_SUPABASE_URL })).toThrow(
      /another host/,
    );
    expect(() => loadSupabaseClient('development', { ...devEnv, EXPO_PUBLIC_SUPABASE_ANON_KEY: prodEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY })).toThrow(
      /different Supabase project/,
    );
  });

  it('refuses to start the development app with a production RevenueCat key', () => {
    expect(() => loadSupabaseClient('development', { ...devEnv, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: prodEnv.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY })).toThrow(
      /Test Store/,
    );
  });

  it('starts the production app with production settings', () => {
    expect(() => loadSupabaseClient('production', prodEnv)).not.toThrow();
  });

  it('treats a bundle with no variant as production and refuses dev settings there', () => {
    expect(() => loadSupabaseClient(undefined, devEnv)).toThrow(/Refusing to start the production app/);
  });

  it('refuses to start the production app with dev backend or a Test Store key', () => {
    expect(() => loadSupabaseClient('production', { ...prodEnv, EXPO_PUBLIC_SUPABASE_URL: devEnv.EXPO_PUBLIC_SUPABASE_URL })).toThrow(/racesignal-dev/);
    expect(() => loadSupabaseClient('production', { ...prodEnv, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'test_abc' })).toThrow(/Test Store/);
  });
});
