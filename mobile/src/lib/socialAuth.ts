import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { hasAppleAuthenticationNative, hasGoogleSignInNative } from '@/lib/nativeModules';
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
 * Native Sign in with Apple / Google, exchanged for a Supabase session with `signInWithIdToken`, and
 * explicit identity linking with `linkIdentity({ provider, token })` (installed @supabase/auth-js
 * 2.112.4 POSTs /token?grant_type=id_token with `link_identity: true` and the CURRENT session's JWT).
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
 * Native modules are imported lazily so a binary without them (an old dev client, Expo Go) reports the
 * provider as unavailable instead of crashing the app at launch.
 */
export type { AppleRevocationCodeResult, ConnectedProvider, LinkProviderResult, SocialProvider, SocialSignInResult };
export { PROVIDER_LABEL };

const AUTH_CALL_TIMEOUT_MS = 20000;

interface ProviderToken {
  idToken: string;
  /** Raw nonce to hand to Supabase. Undefined when the provider token carries no nonce claim. */
  nonce?: string;
  /** Apple only: single-use code that can be exchanged for a revocable refresh token. */
  authorizationCode?: string | null;
  /** Apple only: stable Apple user id. */
  appleUser?: string;
}

type TokenOutcome = { kind: 'token'; token: ProviderToken } | { kind: 'cancelled' } | { kind: 'unavailable' } | { kind: 'error'; message: string };

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

async function getAppleToken(options: { withNonce: boolean }): Promise<TokenOutcome> {
  if (!getSocialAuthConfig().apple || !hasAppleAuthenticationNative()) return { kind: 'unavailable' };
  let Apple: typeof import('expo-apple-authentication');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: see the file header
    Apple = require('expo-apple-authentication');
    if (!(await Apple.isAvailableAsync())) return { kind: 'unavailable' };
  } catch (err) {
    console.warn('[SocialAuth] Apple module unavailable in this build:', (err as Error)?.message);
    return { kind: 'unavailable' };
  }
  try {
    const nonce = options.withNonce ? await createNoncePair() : null;
    const credential = await Apple.signInAsync({
      // Email only: the name is deliberately not requested (see the account rules above).
      requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
      ...(nonce ? { nonce: nonce.hashed } : {}),
    });
    if (!credential.identityToken) return { kind: 'error', message: 'Apple did not return a sign-in token. Please try again.' };
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
    console.warn('[SocialAuth] Apple sign-in failed:', code ?? (err as Error)?.message);
    return { kind: 'error', message: 'Apple sign-in did not complete. Please try again.' };
  }
}

let googleConfigured = false;

async function getGoogleToken(): Promise<TokenOutcome> {
  const config = getSocialAuthConfig();
  if (!config.google || !config.googleWebClientId || !config.googleIosClientId || !hasGoogleSignInNative()) return { kind: 'unavailable' };
  let Google: typeof import('@react-native-google-signin/google-signin');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: see the file header
    Google = require('@react-native-google-signin/google-signin');
    if (!googleConfigured) {
      Google.GoogleSignin.configure({
        webClientId: config.googleWebClientId,
        iosClientId: config.googleIosClientId,
        scopes: ['email', 'profile'],
      });
      googleConfigured = true;
    }
  } catch (err) {
    console.warn('[SocialAuth] Google module unavailable in this build:', (err as Error)?.message);
    return { kind: 'unavailable' };
  }
  try {
    const response = await Google.GoogleSignin.signIn();
    if (response.type === 'cancelled') return { kind: 'cancelled' };
    const idToken = response.data.idToken;
    if (!idToken) return { kind: 'error', message: 'Google did not return a sign-in token. Please try again.' };
    // No nonce: the free Google Sign-In library has no nonce parameter on iOS (it is a paid feature), so the
    // ID token carries no nonce claim. Supabase accepts "nonce absent in both the token and the request"
    // without the "Skip nonce check" setting, which therefore stays OFF. If a future SDK adds a nonce claim
    // on its own, Supabase rejects the token ("should either both exist or not") rather than weakening
    // anything, and that surfaces as a normal sign-in error.
    return { kind: 'token', token: { idToken } };
  } catch (err) {
    const code = errorCode(err);
    if (code === Google.statusCodes.SIGN_IN_CANCELLED) return { kind: 'cancelled' };
    console.warn('[SocialAuth] Google sign-in failed:', code ?? (err as Error)?.message);
    return { kind: 'error', message: 'Google sign-in did not complete. Please try again.' };
  }
}

function getProviderToken(provider: SocialProvider): Promise<TokenOutcome> {
  return provider === 'apple' ? getAppleToken({ withNonce: true }) : getGoogleToken();
}

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

export async function signInWithProvider(provider: SocialProvider): Promise<SocialSignInResult> {
  const outcome = await getProviderToken(provider);
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };
  if (outcome.kind === 'unavailable') return { status: 'unavailable' };
  if (outcome.kind === 'error') return { status: 'error', message: outcome.message };

  try {
    const { data, error } = await withTimeout(
      supabase.auth.signInWithIdToken({ provider, token: outcome.token.idToken, nonce: outcome.token.nonce }),
      AUTH_CALL_TIMEOUT_MS,
      'signInWithIdToken',
    );
    if (error || !data.session) {
      console.warn(`[SocialAuth] signInWithIdToken(${provider}) failed:`, errorCode(error) ?? error?.name, error?.message);
      return { status: 'error', message: describeSupabaseAuthError(provider, error) };
    }
    return { status: 'success', userId: data.session.user.id };
  } catch (err) {
    console.warn(`[SocialAuth] signInWithIdToken(${provider}) did not complete:`, (err as Error)?.message);
    return { status: 'error', message: 'Sign-in is taking longer than expected. Check your connection and try again.' };
  }
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

  const outcome = await getProviderToken(provider);
  if (outcome.kind === 'cancelled') return { status: 'cancelled' };
  if (outcome.kind === 'unavailable') return { status: 'unavailable' };
  if (outcome.kind === 'error') return { status: 'error', message: outcome.message };

  try {
    const { data, error } = await withTimeout(
      supabase.auth.linkIdentity({ provider, token: outcome.token.idToken, nonce: outcome.token.nonce }),
      AUTH_CALL_TIMEOUT_MS,
      'linkIdentity',
    );
    if (error) {
      const code = errorCode(error);
      console.warn(`[SocialAuth] linkIdentity(${provider}) failed:`, code ?? error.name, error.message);
      if (code === 'identity_already_exists') {
        return {
          status: 'conflict',
          message:
            `That ${label} account is already connected to a different RaceSignal account, so nothing was changed on either account. ` +
            `To use that account, sign out and sign in with ${label}. To keep this one, connect a different ${label} account.`,
        };
      }
      if (code === 'manual_linking_disabled') return { status: 'unavailable' };
      return { status: 'error', message: isAuthApiError(error) || isAuthRetryableFetchError(error) ? describeSupabaseAuthError(provider, error) : `Couldn’t connect ${label}. Please try again.` };
    }
    if (data.user?.id !== before.user.id) {
      // Should be impossible (the server links to the caller's own user). Defensive: never silently
      // replace the authenticated account, so put the original session back.
      console.error('[SocialAuth] linkIdentity returned a different user id; restoring the previous session.');
      await supabase.auth.setSession({ access_token: before.access_token, refresh_token: before.refresh_token });
      return { status: 'error', message: `Couldn’t connect ${label}. Your account was not changed.` };
    }
    return { status: 'success' };
  } catch (err) {
    console.warn(`[SocialAuth] linkIdentity(${provider}) did not complete:`, (err as Error)?.message);
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
  } catch (err) {
    console.warn('[SocialAuth] getUserIdentities did not complete:', (err as Error)?.message);
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
