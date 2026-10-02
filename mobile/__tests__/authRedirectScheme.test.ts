/**
 * The magic-link/OAuth redirect must use the scheme of the build that is actually running, so the
 * development app (`racesignal-dev`) and the production app (`racesignal`) each get their own links
 * back even when both are installed on one phone. See app.config.js.
 */

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: ({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`,
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('@/lib/supabaseClient', () => ({ supabase: {}, isSupabaseConfigured: true }));

function loadGetAuthRedirectUri(expoConfig: { scheme?: unknown } | null): () => string {
  jest.resetModules();
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig } }));
  let fn: () => string = () => '';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after doMock, per isolated module registry
    fn = require('@/lib/auth').getAuthRedirectUri;
  });
  return fn;
}

describe('getAuthRedirectUri', () => {
  it('uses the production scheme for the production config', () => {
    expect(loadGetAuthRedirectUri({ scheme: 'racesignal' })()).toBe('racesignal://auth-callback');
  });

  it('uses the development scheme for the development config', () => {
    expect(loadGetAuthRedirectUri({ scheme: 'racesignal-dev' })()).toBe('racesignal-dev://auth-callback');
  });

  it('falls back to the production scheme when no scheme is available', () => {
    expect(loadGetAuthRedirectUri(null)()).toBe('racesignal://auth-callback');
    expect(loadGetAuthRedirectUri({ scheme: 123 })()).toBe('racesignal://auth-callback');
  });
});
