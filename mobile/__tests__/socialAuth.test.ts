import { getConnectedProviders, linkProvider, requestAppleRevocationCode, signInWithProvider } from '@/lib/socialAuth';

/**
 * Apple (native ID token) and Google (Supabase OAuth redirect) sign-in, and explicit provider linking
 * (src/lib/socialAuth.ts). Every external boundary (Supabase, the Apple SDK, the browser sheet, nonce
 * generation, build config) is mocked; what is asserted is what crosses those boundaries: which token and nonce
 * reach Supabase, that cancelling never calls it, that Google never touches an ID token or nonce at all, and
 * that linking can never replace the signed-in account.
 */
const mockSignInWithIdToken = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockExchangeCode = jest.fn();
const mockLinkIdentity = jest.fn();
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockSignOut = jest.fn();
const mockGetUserIdentities = jest.fn();
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithIdToken: (...a: unknown[]) => mockSignInWithIdToken(...a),
      signInWithOAuth: (...a: unknown[]) => mockSignInWithOAuth(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchangeCode(...a),
      linkIdentity: (...a: unknown[]) => mockLinkIdentity(...a),
      getSession: (...a: unknown[]) => mockGetSession(...a),
      setSession: (...a: unknown[]) => mockSetSession(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
      getUserIdentities: (...a: unknown[]) => mockGetUserIdentities(...a),
    },
  },
}));

const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuthSession(...a),
  maybeCompleteAuthSession: jest.fn(),
}));
jest.mock('@/lib/authRedirect', () => ({ getAuthRedirectUri: () => 'racesignal-dev://auth-callback' }));

const mockAppleSignInAsync = jest.fn();
const mockAppleIsAvailable = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: (...a: unknown[]) => mockAppleIsAvailable(...a),
  signInAsync: (...a: unknown[]) => mockAppleSignInAsync(...a),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('@/lib/nativeModules', () => ({ hasAppleAuthenticationNative: () => mockNativePresent.apple }));
const mockNativePresent = { apple: true };

jest.mock('@/lib/nonce', () => ({ createNoncePair: jest.fn().mockResolvedValue({ raw: 'raw-nonce', hashed: 'hashed-nonce' }) }));

let mockConfig = { apple: true, google: true };
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => mockConfig }));

const SESSION = { access_token: 'old-access', refresh_token: 'old-refresh', user: { id: 'user-1' } };
const OAUTH_URL = 'https://project.supabase.co/auth/v1/authorize?provider=google';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockConfig = { apple: true, google: true };
  mockNativePresent.apple = true;
  mockAppleIsAvailable.mockResolvedValue(true);
  mockAppleSignInAsync.mockResolvedValue({ identityToken: 'apple-id-token', authorizationCode: 'apple-code', user: 'apple-sub-1' });
  mockSignInWithIdToken.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
  mockSignInWithOAuth.mockResolvedValue({ data: { provider: 'google', url: OAUTH_URL }, error: null });
  mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'racesignal-dev://auth-callback?code=oauth-code-1' });
  mockExchangeCode.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: SESSION } });
  mockLinkIdentity.mockResolvedValue({ data: { user: { id: 'user-1' }, session: SESSION }, error: null });
});

describe('Apple sign-in', () => {
  it('gives Apple the hashed nonce, gives Supabase the raw one, and never asks for the name', async () => {
    expect(await signInWithProvider('apple')).toEqual({ status: 'success', userId: 'user-1' });
    const appleArgs = mockAppleSignInAsync.mock.calls[0]![0];
    expect(appleArgs.nonce).toBe('hashed-nonce');
    expect(appleArgs.requestedScopes).toEqual([1]); // EMAIL only, no FULL_NAME
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'raw-nonce' });
  });

  it('cancelling returns "cancelled" and never touches Supabase', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    expect(await signInWithProvider('apple')).toEqual({ status: 'cancelled' });
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('is unavailable when the device cannot offer it, the build has it off, or the binary lacks the native module', async () => {
    mockAppleIsAvailable.mockResolvedValue(false);
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
    mockAppleIsAvailable.mockResolvedValue(true);
    mockConfig = { apple: false, google: true };
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
    mockConfig = { apple: true, google: true };
    mockNativePresent.apple = false;
    mockAppleIsAvailable.mockClear();
    expect(await signInWithProvider('apple')).toEqual({ status: 'unavailable' });
    expect(mockAppleIsAvailable).not.toHaveBeenCalled(); // the SDK is never even loaded
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
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
});

describe('Google sign-in (Supabase OAuth redirect: no ID token, no nonce, Skip-nonce-check stays off)', () => {
  it('starts OAuth with the app redirect and an account chooser, opens the sheet, and exchanges the PKCE code', async () => {
    expect(await signInWithProvider('google')).toEqual({ status: 'success', userId: 'user-1' });
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'racesignal-dev://auth-callback', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    expect(mockOpenAuthSession).toHaveBeenCalledWith(OAUTH_URL, 'racesignal-dev://auth-callback');
    expect(mockExchangeCode).toHaveBeenCalledWith('oauth-code-1');
    // The failure that motivated this flow can no longer happen: there is no ID token or nonce on the client.
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('closing the sheet, or declining at Google, is a quiet cancel and nothing is exchanged', async () => {
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'cancel' });
    expect(await signInWithProvider('google')).toEqual({ status: 'cancelled' });
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'dismiss' });
    expect(await signInWithProvider('google')).toEqual({ status: 'cancelled' });
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'success', url: 'racesignal-dev://auth-callback?error=access_denied&error_description=hidden' });
    expect(await signInWithProvider('google')).toEqual({ status: 'cancelled' });
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('reads a failure that Supabase puts in the URL fragment too, and never shows or logs the provider text', async () => {
    mockOpenAuthSession.mockResolvedValueOnce({
      type: 'success',
      url: 'racesignal-dev://auth-callback#error=server_error&error_code=unexpected_failure&error_description=secret+provider+text',
    });
    const result = await signInWithProvider('google');
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('secret');
    for (const call of (console.warn as jest.Mock).mock.calls) expect(JSON.stringify(call)).not.toContain('secret');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('reports a missing code, a failed start, and a failed exchange as plain errors that point at email', async () => {
    mockOpenAuthSession.mockResolvedValueOnce({ type: 'success', url: 'racesignal-dev://auth-callback' });
    expect((await signInWithProvider('google')).status).toBe('error');
    mockSignInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { name: 'AuthApiError', code: 'provider_disabled', message: 'x' } });
    const start = await signInWithProvider('google');
    expect(start).toEqual({ status: 'error', message: expect.stringMatching(/use your email/i) });
    mockExchangeCode.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthApiError', code: 'bad_code_verifier', message: 'x' } });
    expect((await signInWithProvider('google')).status).toBe('error');
  });

  it('is unavailable when the build has Google off, without opening anything', async () => {
    mockConfig = { apple: true, google: false };
    expect(await signInWithProvider('google')).toEqual({ status: 'unavailable' });
    expect(mockSignInWithOAuth).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  it('logs only the provider, the failing stage and an error code', async () => {
    mockExchangeCode.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthApiError', code: 'bad_code_verifier', message: 'contains-secret-text' } });
    await signInWithProvider('google');
    const logged = (console.warn as jest.Mock).mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('google failed at stage=exchange code=bad_code_verifier');
    expect(logged).not.toContain('contains-secret-text');
    expect(logged).not.toContain('oauth-code-1');
  });
});

describe('linkProvider (Settings -> Connected accounts)', () => {
  describe('Apple (ID token)', () => {
    it('links to the signed-in account and keeps its user id (so races, Signal usage and the RevenueCat identity carry over)', async () => {
      expect(await linkProvider('apple')).toEqual({ status: 'success' });
      expect(mockLinkIdentity).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'raw-nonce' });
      expect(mockSetSession).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockSignInWithIdToken).not.toHaveBeenCalled();
    });

    it('when the Apple identity belongs to ANOTHER account: a recoverable conflict that changes neither account or the session', async () => {
      mockLinkIdentity.mockResolvedValue({ data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'identity_already_exists', message: 'x' } });
      const result = await linkProvider('apple');
      expect(result.status).toBe('conflict');
      expect((result as { message: string }).message).toMatch(/nothing was changed on either account/i);
      expect(mockSetSession).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('defensively restores the original session if the server ever answered with a different user', async () => {
      mockLinkIdentity.mockResolvedValue({ data: { user: { id: 'someone-else' }, session: { user: { id: 'someone-else' } } }, error: null });
      expect((await linkProvider('apple')).status).toBe('error');
      expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'old-access', refresh_token: 'old-refresh' });
    });

    it('cancelling the Apple sheet returns "cancelled" and calls nothing', async () => {
      mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
      expect(await linkProvider('apple')).toEqual({ status: 'cancelled' });
      expect(mockLinkIdentity).not.toHaveBeenCalled();
    });

    it('reports manual linking being disabled on the backend as unavailable', async () => {
      mockLinkIdentity.mockResolvedValue({ data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'manual_linking_disabled', message: 'x' } });
      expect(await linkProvider('apple')).toEqual({ status: 'unavailable' });
    });
  });

  describe('Google (OAuth redirect)', () => {
    beforeEach(() => {
      mockLinkIdentity.mockResolvedValue({ data: { provider: 'google', url: OAUTH_URL }, error: null });
    });

    it('links through the OAuth flow, keeps the signed-in user id, and never uses an ID token', async () => {
      expect(await linkProvider('google')).toEqual({ status: 'success' });
      expect(mockLinkIdentity).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: 'racesignal-dev://auth-callback', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      expect(mockExchangeCode).toHaveBeenCalledWith('oauth-code-1');
      expect(mockSetSession).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockSignInWithIdToken).not.toHaveBeenCalled();
    });

    it('a Google account already attached to ANOTHER account (reported in the return URL) is a conflict that changes nothing', async () => {
      mockOpenAuthSession.mockResolvedValue({
        type: 'success',
        url: 'racesignal-dev://auth-callback?error=server_error&error_code=identity_already_exists&error_description=x',
      });
      const result = await linkProvider('google');
      expect(result.status).toBe('conflict');
      expect(mockExchangeCode).not.toHaveBeenCalled();
      expect(mockSetSession).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('also treats identity_already_exists from the start or exchange step as a conflict', async () => {
      mockLinkIdentity.mockResolvedValueOnce({ data: { url: null }, error: { name: 'AuthApiError', code: 'identity_already_exists', message: 'x' } });
      expect((await linkProvider('google')).status).toBe('conflict');
      mockExchangeCode.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthApiError', code: 'identity_already_exists', message: 'x' } });
      expect((await linkProvider('google')).status).toBe('conflict');
    });

    it('defensively restores the original session if the exchange ever yields a different user', async () => {
      mockExchangeCode.mockResolvedValue({ data: { session: { user: { id: 'someone-else' } } }, error: null });
      expect((await linkProvider('google')).status).toBe('error');
      expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'old-access', refresh_token: 'old-refresh' });
    });

    it('cancelling the sheet returns "cancelled" and exchanges nothing', async () => {
      mockOpenAuthSession.mockResolvedValue({ type: 'cancel' });
      expect(await linkProvider('google')).toEqual({ status: 'cancelled' });
      expect(mockExchangeCode).not.toHaveBeenCalled();
    });

    it('reports manual linking being disabled as unavailable', async () => {
      mockLinkIdentity.mockResolvedValueOnce({ data: { url: null }, error: { name: 'AuthApiError', code: 'manual_linking_disabled', message: 'x' } });
      expect(await linkProvider('google')).toEqual({ status: 'unavailable' });
    });
  });

  it('refuses to link when nobody is signed in, without opening any provider sheet', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect((await linkProvider('apple')).status).toBe('error');
    expect((await linkProvider('google')).status).toBe('error');
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
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
