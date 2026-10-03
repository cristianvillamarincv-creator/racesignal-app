import { getConnectedProviders, linkProvider, requestAppleRevocationCode, signInWithProvider } from '@/lib/socialAuth';

/**
 * Native Apple / Google sign-in and explicit provider linking (src/lib/socialAuth.ts). Every external
 * boundary (Supabase, the two native SDKs, nonce generation, build config) is mocked; what is asserted is
 * what crosses those boundaries: which token and nonce reach Supabase, that cancelling never calls it, and
 * that linking can never replace the signed-in account.
 */
const mockSignInWithIdToken = jest.fn();
const mockLinkIdentity = jest.fn();
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockSignOut = jest.fn();
const mockGetUserIdentities = jest.fn();
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...a: unknown[]) => mockSignInWithIdToken(...a),
      linkIdentity: (...a: unknown[]) => mockLinkIdentity(...a),
      getSession: (...a: unknown[]) => mockGetSession(...a),
      setSession: (...a: unknown[]) => mockSetSession(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
      getUserIdentities: (...a: unknown[]) => mockGetUserIdentities(...a),
    },
  },
}));

const mockAppleSignInAsync = jest.fn();
const mockAppleIsAvailable = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: (...a: unknown[]) => mockAppleIsAvailable(...a),
  signInAsync: (...a: unknown[]) => mockAppleSignInAsync(...a),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const mockGoogleSignIn = jest.fn();
const mockGoogleConfigure = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: (...a: unknown[]) => mockGoogleConfigure(...a), signIn: (...a: unknown[]) => mockGoogleSignIn(...a) },
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

jest.mock('@/lib/nativeModules', () => ({ hasAppleAuthenticationNative: () => mockNativePresent.apple, hasGoogleSignInNative: () => mockNativePresent.google }));
const mockNativePresent = { apple: true, google: true };

jest.mock('@/lib/nonce', () => ({ createNoncePair: jest.fn().mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' }) }));

let mockConfig = { apple: true, google: true, googleWebClientId: 'web.apps.googleusercontent.com', googleIosClientId: 'ios.apps.googleusercontent.com' };
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => mockConfig }));


const SESSION = { access_token: 'old-access', refresh_token: 'old-refresh', user: { id: 'user-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockConfig = { apple: true, google: true, googleWebClientId: 'web.apps.googleusercontent.com', googleIosClientId: 'ios.apps.googleusercontent.com' };
  mockAppleIsAvailable.mockResolvedValue(true);
  mockAppleSignInAsync.mockResolvedValue({ identityToken: 'apple-id-token', authorizationCode: 'apple-code', user: 'apple-sub-1' });
  mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
  mockSignInWithIdToken.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: SESSION } });
  mockLinkIdentity.mockResolvedValue({ data: { user: { id: 'user-1' }, session: SESSION }, error: null });
});

describe('a binary without the native modules (e.g. an older dev client)', () => {
  afterEach(() => {
    mockNativePresent.apple = true;
    mockNativePresent.google = true;
  });

  it('reports Apple and Google as unavailable without touching either SDK', async () => {
    mockNativePresent.apple = false;
    mockNativePresent.google = false;
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
    expect(await signInWithProvider('google')).toEqual({ status: 'unavailable' });
    expect(mockAppleIsAvailable).not.toHaveBeenCalled();
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
    expect(mockGoogleConfigure).not.toHaveBeenCalled();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });
});

describe('signInWithProvider', () => {
  it('Apple: gives Apple the hashed nonce, gives Supabase the raw one, and never asks for the name', async () => {
    const result = await signInWithProvider('apple');
    expect(result).toEqual({ status: 'success', userId: 'user-1' });
    const appleArgs = mockAppleSignInAsync.mock.calls[0]![0];
    expect(appleArgs.nonce).toBe('hashed-nonce');
    expect(appleArgs.requestedScopes).toEqual([1]); // EMAIL only, no FULL_NAME
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'raw-nonce' });
  });

  it('Google: sends no nonce (the free iOS library cannot supply one), so Skip-nonce-check stays unnecessary', async () => {
    const result = await signInWithProvider('google');
    expect(result).toEqual({ status: 'success', userId: 'user-1' });
    expect(mockGoogleConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: 'web.apps.googleusercontent.com', iosClientId: 'ios.apps.googleusercontent.com' }),
    );
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'google-id-token', nonce: undefined });
  });

  it('cancelling Apple returns "cancelled" and never touches Supabase', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await signInWithProvider('apple')).toEqual({ status: 'cancelled' });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('cancelling Google (either shape the SDK uses) returns "cancelled" and never touches Supabase', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    expect(await signInWithProvider('google')).toEqual({ status: 'cancelled' });
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    expect(await signInWithProvider('google')).toEqual({ status: 'cancelled' });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('reports a provider that is off for this build as unavailable without calling any SDK', async () => {
    mockConfig = { apple: false, google: false, googleWebClientId: '', googleIosClientId: '' } as typeof mockConfig;
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
    expect(await signInWithProvider('google')).toEqual({ status: 'unavailable' });
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
  });

  it('reports Apple as unavailable when the device cannot offer it', async () => {
    mockAppleIsAvailable.mockResolvedValue(false);
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
  });

  it('turns a disabled provider on the backend into a friendly message that points at email', async () => {
    mockSignInWithIdToken.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', code: 'provider_disabled', message: 'x' } });
    const result = await signInWithProvider('apple');
    expect(result.status).toBe('error');
    expect((result as { message: string }).message).toMatch(/use your email/i);
  });

  it('turns a hung Supabase call into a retryable message instead of waiting forever', async () => {
    jest.useFakeTimers();
    mockSignInWithIdToken.mockReturnValue(new Promise(() => {}));
    const pending = signInWithProvider('apple');
    await jest.advanceTimersByTimeAsync(21000);
    expect(await pending).toEqual({ status: 'error', message: expect.stringMatching(/longer than expected/) });
    jest.useRealTimers();
  });

  it('never puts a token in an error message or a log line', async () => {
    mockSignInWithIdToken.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', code: 'bad_id_token', message: 'boom' } });
    const result = await signInWithProvider('google');
    expect(JSON.stringify(result)).not.toContain('google-id-token');
    for (const call of (console.warn as jest.Mock).mock.calls) expect(JSON.stringify(call)).not.toContain('google-id-token');
  });
});

describe('linkProvider (Settings -> Connected accounts)', () => {
  it('links to the signed-in account and keeps its user id (so races, Signal usage and the RevenueCat identity carry over)', async () => {
    const result = await linkProvider('apple');
    expect(result).toEqual({ status: 'success' });
    expect(mockLinkIdentity).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'raw-nonce' });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled(); // never the sign-in path while connecting
  });

  it('when the provider belongs to ANOTHER account: reports a recoverable conflict and changes neither account or the session', async () => {
    mockLinkIdentity.mockResolvedValue({ data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'identity_already_exists', message: 'x' } });
    const result = await linkProvider('google');
    expect(result.status).toBe('conflict');
    expect((result as { message: string }).message).toMatch(/nothing was changed on either account/i);
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('defensively restores the original session if the server ever answered with a different user', async () => {
    mockLinkIdentity.mockResolvedValue({ data: { user: { id: 'someone-else' }, session: { user: { id: 'someone-else' } } }, error: null });
    const result = await linkProvider('apple');
    expect(result.status).toBe('error');
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'old-access', refresh_token: 'old-refresh' });
  });

  it('refuses to link when nobody is signed in, without opening any provider sheet', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect((await linkProvider('apple')).status).toBe('error');
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
  });

  it('cancelling the provider sheet returns "cancelled" and calls nothing', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await linkProvider('apple')).toEqual({ status: 'cancelled' });
    expect(mockLinkIdentity).not.toHaveBeenCalled();
  });

  it('reports manual linking being disabled on the backend as unavailable', async () => {
    mockLinkIdentity.mockResolvedValue({ data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'manual_linking_disabled', message: 'x' } });
    expect(await linkProvider('apple')).toEqual({ status: 'unavailable' });
  });
});

describe('getConnectedProviders', () => {
  it('maps Supabase identities to provider, provider user id and email', async () => {
    mockGetUserIdentities.mockResolvedValue({
      data: {
        identities: [
          { provider: 'email', id: 'user-1', identity_data: { email: 'a@b.co', sub: 'user-1' } },
          { provider: 'apple', id: 'apple-sub-1', identity_data: { sub: 'apple-sub-1', email: 'relay@privaterelay.appleid.com' } },
        ],
      },
      error: null,
    });
    expect(await getConnectedProviders()).toEqual([
      { provider: 'email', providerUserId: 'user-1', email: 'a@b.co' },
      { provider: 'apple', providerUserId: 'apple-sub-1', email: 'relay@privaterelay.appleid.com' },
    ]);
  });

  it('returns null (not an empty list) when the identities cannot be read', async () => {
    mockGetUserIdentities.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await getConnectedProviders()).toBeNull();
  });
});

describe('requestAppleRevocationCode (account deletion)', () => {
  it('returns a fresh authorization code for the linked Apple account, without a nonce', async () => {
    expect(await requestAppleRevocationCode('apple-sub-1')).toEqual({ status: 'code', authorizationCode: 'apple-code' });
    expect(mockAppleSignInAsync.mock.calls[0]![0].nonce).toBeUndefined();
  });
  it('reports cancel, a different Apple ID, and a missing code distinctly and never throws', async () => {
    mockAppleSignInAsync.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });
    expect(await requestAppleRevocationCode('apple-sub-1')).toEqual({ status: 'cancelled' });
    expect(await requestAppleRevocationCode('a-different-apple-sub')).toEqual({ status: 'error' });
    mockAppleSignInAsync.mockResolvedValueOnce({ identityToken: 't', authorizationCode: null, user: 'apple-sub-1' });
    expect(await requestAppleRevocationCode('apple-sub-1')).toEqual({ status: 'error' });
    mockAppleSignInAsync.mockRejectedValueOnce(new Error('network'));
    expect(await requestAppleRevocationCode('apple-sub-1')).toEqual({ status: 'error' });
  });
});
