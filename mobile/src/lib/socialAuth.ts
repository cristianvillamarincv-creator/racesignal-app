import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';

import { getAuthRedirectUri } from '@/lib/authRedirect';
import { hasAppleAuthenticationNative } from '@/lib/nativeModules';
import { createNoncePair } from '@/lib/nonce';
import {
  PROVIDER_LABEL,
  type AppleRevocationCodeResult,
  type ConnectedProvider,
  type LinkProviderResult,
  type SocialProvider,
  type SocialSignInResult,
} from '@/lib/socialAuthTypes';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';
import { supabase } from '@/lib/supabaseClient';
import { withTimeout } from '@/lib/timeout';

/**
 * Sign in with Apple (native) and Google (Supabase OAuth), plus explicit identity linking.
 *
 * APPLE: the native system sheet, exchanged with `signInWithIdToken({ provider: 'apple', token, nonce })` (and
 * `linkIdentity` with the same arguments to connect Apple to the signed-in account). We control the nonce.
 *
 * GOOGLE: Supabase's OAuth redirect flow (`signInWithOAuth` / `linkIdentity` with `skipBrowserRedirect`, an
 * in-app browser sheet, and the PKCE `?code=` exchange that magic links already use). It replaced a native
 * Google Sign-In ID-token flow that Supabase rejected on the first real device test: GoogleSignIn-iOS puts a
 * `nonce` claim in the ID token that the free React Native library neither lets us choose nor reveals, and
 * Supabase requires the request nonce and the token nonce to both exist (or both be absent), so every sign-in
 * failed with "Passed nonce and nonce in id_token should either both exist or not". The only ways to keep that
 * native flow were Supabase's "Skip nonce check" (rejected: it removes replay protection) or the paid library.
 * The OAuth flow has no client-side token handling at all, so there is no nonce to get wrong, and "Skip nonce
 * check" stays off.
 *
 * Account rules (product decisions, see docs/social-sign-in.md):
 *  - No custom merge logic and no data migration, ever. A provider either (a) signs in to the account
 *    Supabase already links it to, (b) is automatically linked by Supabase to an existing account whose
 *    VERIFIED email matches, keeping the same user id (so races, Signal usage, and the RevenueCat identity
 *    all carry over), or (c) creates a new account.
 *  - Connecting a provider from Settings never replaces the signed-in account. If the provider already
 *    belongs to a different account, Supabase answers `identity_already_exists`; both accounts are left
 *    untouched and the caller gets a recoverable `conflict`.
 *  - The provider's profile name is never requested or used (the racing name from discovery stays the
 *    only name source).
 *
 * Logging: stage names and error codes only. Never tokens, codes, secrets, emails, or names.
 *
 * The Apple SDK is imported lazily and only when the binary has its native module, so an older dev client
 * reports Apple as unavailable instead of crashing the app at launch.
 */
export type { AppleRevocationCodeResult, ConnectedProvider, LinkProviderResult, SocialProvider, SocialSignInResult };
export { PROVIDER_LABEL };

const AUTH_CALL_TIMEOUT_MS = 20000;

type Stage = 'start' | 'sheet' | 'redirect' | 'exchange' | 'supabase' | 'session';

/** The one logging path: a provider, the stage that failed, and an error CODE. Nothing else. */
function logFailure(provider: SocialProvider, stage: Stage, code?: string): void {
  console.warn(`[SocialAuth] ${provider} failed at stage=${stage}${code ? ` code=${code}` : ''}`);
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Apple (native ID token)
// ---------------------------------------------------------------------------------------------------------

interface AppleToken {
  idToken: string;
  nonce?: string;
  authorizationCode?: string | null;
  appleUser?: string;
}

type AppleOutcome = { kind: 'token'; token: AppleToken } | { kind: 'cancelled' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

async function getAppleToken(options: { withNonce: boolean }): Promise<AppleOutcome> {
  if (!getSocialAuthConfig().apple || !hasAppleAuthenticationNative()) return { kind: 'unavailable' };
  let Apple: typeof import('expo-apple-authentication');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: see the file header
    Apple = require('expo-apple-authentication');
    if (!(await Apple.isAvailableAsync())) return { kind: 'unavailable' };
  } catch (err) {
    logFailure('apple', 'start', errorCode(err) ?? 'module_unavailable');
    return { kind: 'unavailable' };
  }
  try {
    const nonce = options.withNonce ? await createNoncePair() : null;
    const credential = await Apple.signInAsync({
      // Email only: the name is deliberately not requested (see the account rules above).
      requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
      ...(nonce ? { nonce: nonce.hashed } : {}),
    });
    if (!credential.identityToken) {
      logFailure('apple', 'sheet', 'no_identity_token');
      return { kind: 'error', message: 'Apple did not return a sign-in token. Please try again.' };
    }
    return {
      kind: 'token',
      token: {
        idToken: credential.identityToken,
        nonce: nonce?.raw,
        authorizationCode: credential.authorizationCode,
        appleUser: credential.user,
      },
    };
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return { kind: 'cancelled' };
    logFailure('apple', 'sheet', code);
    return { kind: 'error', message: 'Apple sign-in did not complete. Please try again.' };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Google (Supabase OAuth redirect flow)
// ---------------------------------------------------------------------------------------------------------

type GoogleRedirect =
  | { kind: 'code'; code: string }
  | { kind: 'cancelled' }
  | { kind: 'conflict' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

/** Query string AND fragment: Supabase puts an OAuth failure in whichever the flow uses. */
function readRedirectParams(url: string): URLSearchParams {
  const params = new URLSearchParams();
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => params.set(key, value));
    const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    new URLSearchParams(fragment).forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  } catch {
    // An unparseable return URL yields no params, which is reported as a generic failure by the caller.
  }
  return params;
}

/**
 * Opens the OAuth URL Supabase produced and reads what comes back. Returns the PKCE `code`, or a classified
 * failure. The provider's own error text is never shown to the athlete or logged; only its error code is.
 */
async function openGoogleSheet(url: string): Promise<GoogleRedirect> {
  const redirectTo = getAuthRedirectUri();
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  } catch (err) {
    logFailure('google', 'sheet', errorCode(err));
    return { kind: 'error', message: 'Google sign-in did not complete. Please try again.' };
  }
  if (result.type === 'cancel' || result.type === 'dismiss') return { kind: 'cancelled' };
  if (result.type !== 'success' || !result.url) {
    logFailure('google', 'sheet', result.type);
    return { kind: 'error', message: 'Google sign-in did not complete. Please try again.' };
  }

  const params = readRedirectParams(result.url);
  const failureCode = params.get('error_code') ?? params.get('error');
  if (failureCode) {
    logFailure('google', 'redirect', failureCode);
    if (failureCode === 'access_denied') return { kind: 'cancelled' }; // the athlete declined at Google
    if (failureCode === 'identity_already_exists') return { kind: 'conflict' };
    if (failureCode === 'manual_linking_disabled') return { kind: 'unavailable' };
    if (failureCode === 'signup_disabled' || failureCode === 'provider_disabled' || failureCode === 'oauth_provider_not_supported') {
      return { kind: 'error', message: 'Google sign-in isn’t available right now. Please use your email instead.' };
    }
    return { kind: 'error', message: 'Couldn’t sign in with Google. Please try again, or use your email.' };
  }
  const code = params.get('code');
  if (!code) {
    logFailure('google', 'redirect', 'no_code');
    return { kind: 'error', message: 'Couldn’t sign in with Google. Please try again, or use your email.' };
  }
  return { kind: 'code', code };
}

const GOOGLE_OAUTH_OPTIONS = {
  skipBrowserRedirect: true,
  // Let the athlete pick which Google account to use instead of silently reusing the last one.
  queryParams: { prompt: 'select_account' },
} as const;

// ---------------------------------------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------------------------------------

/** Never includes tokens, emails, or raw provider payloads. */
function describeSupabaseAuthError(provider: SocialProvider, err: unknown): string {
  const label = PROVIDER_LABEL[provider];
  const code = errorCode(err);
  if (code === 'signup_disabled' || code === 'provider_disabled' || code === 'oauth_provider_not_supported') {
    return `${label} sign-in isn’t available right now. Please use your email instead.`;
  }
  if (isAuthRetryableFetchError(err)) return 'Couldn’t reach the server. Check your connection and try again.';
  return `Couldn’t sign in with ${label}. Please try again, or use your email.`;
}

async function signInWithGoogle(): Promise<SocialSignInResult> {
  if (!getSocialAuthConfig().google) return { status: 'unavailable' };

  let url: string;
  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: getAuthRedirectUri(), ...GOOGLE_OAUTH_OPTIONS } }),
      AUTH_CALL_TIMEOUT_MS,
      'signInWithOAuth',
    );
    if (error || !data?.url) {
      logFailure('google', 'start', errorCode(error) ?? error?.name);
      return { status: 'error', message: describeSupabaseAuthError('google', error) };
    }
    url = data.url;
  } catch {
    logFailure('google', 'start', 'timeout');
    return { status: 'error', message: 'Sign-in is taking longer than expected. Check your connection and try again.' };
  }

  const redirect = await openGoogleSheet(url);
  if (redirect.kind === 'cancelled') return { status: 'cancelled' };
  if (redirect.kind === 'unavailable') return { status: 'unavailable' };
  if (redirect.kind === 'conflict') return { status: 'error', message: 'Couldn’t sign in with Google. Please try again, or use your email.' };
  if (redirect.kind === 'error') return { status: 'error', message: redirect.message };

  try {
    const { data, error } = await withTimeout(supabase.auth.exchangeCodeForSession(redirect.code), AUTH_CALL_TIMEOUT_MS, 'exchangeCodeForSession');
    if (error || !data.session) {
      logFailure('google', 'exchange', errorCode(error) ?? error?.name);
      return { status: 'error', message: describeSupabaseAuthError('google', error) };
    }
    return { status: 'success', userId: data.session.user.id };
  } catch {
    logFailure('google', 'exchange', 'timeout');
    return { status: 'error', message: 'Sign-in is taking longer than expected. Check your connection and try again.' };
  }
}

async function signInWithApple(): Promise<SocialSignInResult> {
  const outcome = await getAppleToken({ withNonce: true });
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };
  if (outcome.kind === 'unavailable') return { status: 'unavailable' };
  if (outcome.kind === 'error') return { status: 'error', message: outcome.message };

  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithIdToken({ provider: 'apple', token: outcome.token.idToken, nonce: outcome.token.nonce }),
      AUTH_CALL_TIMEOUT_MS,
      'signInWithIdToken',
    );
    if (error || !data.session) {
      logFailure('apple', 'supabase', errorCode(error) ?? error?.name);
      return { status: 'error', message: describeSupabaseAuthError('apple', error) };
    }
    return { status: 'success', userId: data.session.user.id };
  } catch {
    logFailure('apple', 'supabase', 'timeout');
    return { status: 'error', message: 'Sign-in is taking longer than expected. Check your connection and try again.' };
  }
}

export function signInWithProvider(provider: SocialProvider): Promise<SocialSignInResult> {
  return provider === 'apple' ? signInWithApple() : signInWithGoogle();
}

// ---------------------------------------------------------------------------------------------------------
// Link (Settings -> Connected accounts)
// ---------------------------------------------------------------------------------------------------------

function conflictResult(provider: SocialProvider): LinkProviderResult {
  const label = PROVIDER_LABEL[provider];
  return {
    status: 'conflict',
    message:
      `That ${label} account is already connected to a different RaceSignal account, so nothing was changed on either account. ` +
      `To use that account, sign out and sign in with ${label}. To keep this one, connect a different ${label} account.`,
  };
}

/**
 * Connects a provider to the account that is signed in RIGHT NOW. The existing session's user id is the
 * only account that can be affected: success keeps that id; a provider owned by another account is
 * refused by Supabase (`identity_already_exists`) and reported as a conflict, with both accounts and the
 * current session left exactly as they were.
 */
export async function linkProvider(provider: SocialProvider): Promise<LinkProviderResult> {
  const label = PROVIDER_LABEL[provider];
  const { data: sessionData } = await supabase.auth.getSession();
  const before = sessionData.session;
  if (!before) return { status: 'error', message: 'Sign in first, then connect your account.' };

  // Defensive, for both providers: never silently replace the authenticated account.
  const restoreIfDifferentUser = async (userId: string | undefined): Promise<LinkProviderResult | null> => {
    if (userId === before.user.id) return null;
    console.error(`[SocialAuth] ${provider} link returned a different user id; restoring the previous session.`);
    await supabase.auth.setSession({ access_token: before.access_token, refresh_token: before.refresh_token });
    return { status: 'error', message: `Couldn’t connect ${label}. Your account was not changed.` };
  };

  if (provider === 'google') {
    if (!getSocialAuthConfig().google) return { status: 'unavailable' };
    let url: string;
    try {
      const { data, error } = await withTimeout(
        supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: getAuthRedirectUri(), ...GOOGLE_OAUTH_OPTIONS } }),
        AUTH_CALL_TIMEOUT_MS,
        'linkIdentity',
      );
      if (error || !data?.url) {
        const code = errorCode(error);
        logFailure('google', 'start', code ?? error?.name);
        if (code === 'identity_already_exists') return conflictResult('google');
        if (code === 'manual_linking_disabled') return { status: 'unavailable' };
        return { status: 'error', message: `Couldn’t connect ${label}. Please try again.` };
      }
      url = data.url;
    } catch {
      logFailure('google', 'start', 'timeout');
      return { status: 'error', message: `Couldn’t connect ${label}. Check your connection and try again.` };
    }

    const redirect = await openGoogleSheet(url);
    if (redirect.kind === 'cancelled') return { status: 'cancelled' };
    if (redirect.kind === 'unavailable') return { status: 'unavailable' };
    if (redirect.kind === 'conflict') return conflictResult('google');
    if (redirect.kind === 'error') return { status: 'error', message: `Couldn’t connect ${label}. Please try again.` };

    try {
      const { data, error } = await withTimeout(supabase.auth.exchangeCodeForSession(redirect.code), AUTH_CALL_TIMEOUT_MS, 'exchangeCodeForSession');
      if (error || !data.session) {
        const code = errorCode(error);
        logFailure('google', 'exchange', code ?? error?.name);
        if (code === 'identity_already_exists') return conflictResult('google');
        return { status: 'error', message: `Couldn’t connect ${label}. Please try again.` };
      }
      return (await restoreIfDifferentUser(data.session.user.id)) ?? { status: 'success' };
    } catch {
      logFailure('google', 'exchange', 'timeout');
      return { status: 'error', message: `Couldn’t connect ${label}. Check your connection and try again.` };
    }
  }

  const outcome = await getAppleToken({ withNonce: true });
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };
  if (outcome.kind === 'unavailable') return { status: 'unavailable' };
  if (outcome.kind === 'error') return { status: 'error', message: outcome.message };

  try {
    const { data, error } = await withTimeout(
      supabase.auth.linkIdentity({ provider: 'apple', token: outcome.token.idToken, nonce: outcome.token.nonce }),
      AUTH_CALL_TIMEOUT_MS,
      'linkIdentity',
    );
    if (error) {
      const code = errorCode(error);
      logFailure('apple', 'supabase', code ?? error.name);
      if (code === 'identity_already_exists') return conflictResult('apple');
      if (code === 'manual_linking_disabled') return { status: 'unavailable' };
      return {
        status: 'error',
        message: isAuthApiError(error) || isAuthRetryableFetchError(error) ? describeSupabaseAuthError('apple', error) : `Couldn’t connect ${label}. Please try again.`,
      };
    }
    return (await restoreIfDifferentUser(data.user?.id)) ?? { status: 'success' };
  } catch {
    logFailure('apple', 'supabase', 'timeout');
    return { status: 'error', message: `Couldn’t connect ${label}. Check your connection and try again.` };
  }
}

export async function getConnectedProviders(): Promise<ConnectedProvider[] | null> {
  try {
    const { data, error } = await withTimeout(supabase.auth.getUserIdentities(), AUTH_CALL_TIMEOUT_MS, 'getUserIdentities');
    if (error || !data) return null;
    return data.identities.map((identity) => {
      const identityData = (identity.identity_data ?? {}) as { sub?: unknown; email?: unknown };
      return {
        provider: identity.provider,
        providerUserId: typeof identityData.sub === 'string' ? identityData.sub : identity.id ?? null,
        email: typeof identityData.email === 'string' ? identityData.email : null,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Account deletion: ask Apple for a fresh single-use authorization code so the server can revoke the
 * athlete's Sign in with Apple tokens (Apple's account-deletion requirement). Never required for deletion;
 * the caller decides what to do for each non-`code` outcome (see lib/accountDeletion.ts).
 */
export async function requestAppleRevocationCode(expectedAppleUser?: string | null): Promise<AppleRevocationCodeResult> {
  const outcome = await getAppleToken({ withNonce: false });
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };
  if (outcome.kind === 'unavailable') return { status: 'unavailable' };
  if (outcome.kind === 'error') return { status: 'error' };
  const { authorizationCode, appleUser } = outcome.token;
  // The code only revokes the Apple account that produced it; if the device's Apple ID is not the one
  // linked to this RaceSignal account, revoking would be pointless (and the wrong account's tokens).
  if (expectedAppleUser && appleUser && expectedAppleUser !== appleUser) return { status: 'error' };
  if (!authorizationCode) return { status: 'error' };
  return { status: 'code', authorizationCode };
}
