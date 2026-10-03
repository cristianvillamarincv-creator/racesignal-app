import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { describeAuthExchangeFailure } from '@/lib/authErrorMessages';
import { isRetryableAuthError } from '@/lib/authRetry';
import {
  getConnectedProviders,
  linkProvider,
  signInWithProvider,
  type ConnectedProvider,
  type LinkProviderResult,
  type SocialProvider,
  type SocialSignInResult,
} from '@/lib/socialAuth';
import { supabase } from '@/lib/supabaseClient';
import { withTimeout } from '@/lib/timeout';

WebBrowser.maybeCompleteAuthSession();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exactly one retry, only for a confirmed transient network-layer failure (see authRetry.ts) —
// matches lib/signal.ts's identical one-retry pattern for the same class of problem. Safe to
// resend the same code/tokens: AuthRetryableFetchError means the request never reached (or never
// got a decision from) the server, so nothing was consumed server-side yet. The OUTER caller
// (OnboardingFlow's processedUrlRef) already guarantees completeAuthFromUrl itself is never
// invoked twice for the same redirect URL, so this retry can never cause a duplicate
// session/import — it only re-attempts the one already-deduped call.
const AUTH_RETRY_DELAY_MS = 400;

/** supabase-js has no built-in request timeout — a stalled connection would otherwise leave a
 *  caller awaiting one of these calls indefinitely (the confirmed cause of the onboarding
 *  "Saving your race history…" spinner never recovering). 20s is generous for a real but slow
 *  connection/cold Supabase edge function, and short enough that a genuine stall surfaces as a
 *  recoverable error well before an athlete gives up and force-quits. */
const AUTH_CALL_TIMEOUT_MS = 20000;

/** The URL scheme of the build that is actually running — `racesignal` for production,
 *  `racesignal-dev` for the development app (see app.config.js). Taken from the Expo config so a
 *  magic link always returns to the SAME app that requested it, even when both are installed. */
const APP_SCHEME = typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'racesignal';

/** The exact redirect used for BOTH Google OAuth and the magic-link email, so there's only ever
 *  one URL per environment that needs to be registered in Supabase's Auth > URL Configuration
 *  allowlist. */
export function getAuthRedirectUri(): string {
  return makeRedirectUri({ scheme: APP_SCHEME, path: 'auth-callback' });
}

interface AuthResult {
  error: string | null;
  /** null with no error means the athlete closed the browser sheet themselves — not a failure. */
  userId: string | null;
}

export interface AuthContextValue {
  /** True once the initial session read has resolved. */
  isReady: boolean;
  session: Session | null;
  /** Sends a magic link to the given email. Creates the account on first use. The link opens
   *  `racesignal://auth-callback` in this build — see completeAuthFromUrl. */
  requestMagicLink: (email: string) => Promise<{ error: string | null }>;
  /** Native Sign in with Apple / Google (system sheet, no browser), exchanged for a Supabase session via
   *  signInWithIdToken. Supabase links the provider to an existing account only when its VERIFIED email
   *  matches; otherwise a new account is created. See lib/socialAuth.ts and docs/social-sign-in.md. */
  signInWithProvider: (provider: SocialProvider) => Promise<SocialSignInResult>;
  /** Connects a provider to the CURRENTLY signed-in account (Settings -> Connected accounts). Never replaces
   *  the signed-in account; a provider owned by another account is reported as a conflict. */
  linkProvider: (provider: SocialProvider) => Promise<LinkProviderResult>;
  /** The sign-in methods attached to the signed-in account, or null if they could not be read. */
  getConnectedProviders: () => Promise<ConnectedProvider[] | null>;
  /** Turns an incoming `racesignal://auth-callback...` URL (a tapped magic link) into a session. Exposed so OnboardingFlow can also call it directly for a deep link
   *  received while the app is already running (Linking's 'url' event) or recovered from the
   *  app's cold-start launch URL. */
  completeAuthFromUrl: (url: string) => Promise<AuthResult>;
  /** B.12 — a secondary, sign-in-only path (never a registration form here) alongside magic link,
   *  discoverable but visually secondary on the same screen. Exists for one concrete reason: an
   *  Apple App Review account needs a way in that doesn't depend on a reviewer checking a real
   *  inbox. Uses Supabase's ordinary `signInWithPassword` — the same "email" auth provider already
   *  powering magic links (confirmed via GET /auth/v1/settings: `external.email: true`, nothing to
   *  enable) — so a successful call produces a completely normal session through the exact same
   *  onAuthStateChange listener above; no reviewer-specific code path exists anywhere past this
   *  point. Every account still goes through the real `races` RLS policies unchanged. */
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

// Exported (in addition to the useAuth hook below) so a second, alternate provider —
// PreviewAuthProvider (lib/previewAuthContext.tsx) — can supply this same context with a stub
// value for Developer Preview (see lib/devPreview.tsx): no real session, every auth action a
// safety-net error. This never changes real AuthProvider's own behavior.
export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Two sign-in methods, both only reached at the END of onboarding (after discovery + selection):
 * Google OAuth (primary) and a magic-link email (fallback — matches Supabase's actual default
 * email-template behavior, which sends a clickable link, not a numeric code). Both redirect back
 * through the same `racesignal://auth-callback` deep link, requiring a Development Build (Expo Go
 * can't own a custom scheme) — see B1_ARCHITECTURE.md. Session is persisted via AsyncStorage by
 * supabaseClient.ts, so a signed-in athlete stays signed in across app restarts.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // A single source of truth for both `session` and `isReady`, deliberately NOT a separate
    // getSession() call racing against this subscription. supabase-js v2 guarantees this
    // callback fires exactly once with the `INITIAL_SESSION` event, immediately after the client
    // finishes reading and validating whatever's in AsyncStorage (or determines there's nothing
    // there) — that first call is the actual "restoration finished" signal. Two independent async
    // paths (a getSession() promise plus this subscription, as this used to be written) can settle
    // in either order on a real device; if `isReady` flips true from the faster one a tick before
    // `session` reflects the slower one's real, restored value, AppPhaseProvider's classification
    // (which runs once, right when `isReady` becomes true) permanently locks in "no session" for
    // an athlete who actually has one — sending a returning, onboarded athlete back into
    // onboarding. Collapsing to one signal makes that ordering impossible.
    let hasSetReady = false;
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!hasSetReady) {
        hasSetReady = true;
        setIsReady(true);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  /**
   * Deliberately NEVER retries automatically, unlike exchangeCodeForSession/setSession above.
   * Verified against the installed @supabase/auth-js: signInWithOtp calls
   * _getCodeChallengeAndMethod(), which generates a BRAND NEW PKCE verifier + flowId on every
   * call and stores it in a per-flow slot (helpers.js's storePKCEVerifier), addressed by the
   * flowId embedded in the redirect URL — but it ALSO dual-writes that new verifier to a single
   * fixed legacy key, for callers that can't identify their flow (helpers.js: "exchanges that
   * cannot identify their flow ... read the fixed key, which mirrors the most recently started
   * flow"). completeAuthFromUrl below calls `exchangeCodeForSession(code)` with no `options.flowId`,
   * and React Native never satisfies auth-js's `isBrowser()` check (no `window.location`) that
   * would otherwise let it recover the flowId from the callback URL itself — so this app always
   * falls back to that single fixed legacy key. A second signInWithOtp call — automatic retry or a
   * manual "Resend" — overwrites that fixed key with a NEW verifier, silently orphaning whatever
   * email the FIRST call already sent (if it reached the server at all): tapping that first email
   * would then fail with the exact PKCE-verifier-missing error Build 9 already had to handle once.
   * An `AuthRetryableFetchError` only proves the client never got a decision back — it does NOT
   * prove the server never received/sent the first request, so retrying here cannot be shown safe.
   * A real fix (threading the redirect URL's flowId through to exchangeCodeForSession, so each
   * flow's verifier lives in its own durable slot) is a legitimate follow-up but is out of scope
   * for this pass. The resend cooldown and "the newest email you asked for is the only one that
   * still works" guidance already carry this same risk for a manual resend — unchanged here.
   */
  const requestMagicLink = async (email: string) => {
    const redirectTo = getAuthRedirectUri();
    // Never log the email itself — diagnostics below stay limited to stage/error-type/elapsed-ms.
    console.log('[Auth] requesting magic link -> redirectTo', redirectTo);
    const startedAt = Date.now();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });

    const elapsedMs = Date.now() - startedAt;
    if (error) {
      console.warn(
        `[Auth] signInWithOtp (magic link) failed (elapsedMs=${elapsedMs}, errorType=${error.name ?? 'unknown'}):`,
        error.message,
      );
    } else {
      console.log(`[Auth] signInWithOtp (magic link) succeeded (elapsedMs=${elapsedMs})`);
    }
    return { error: error?.message ?? null };
  };

  /**
   * Parses whatever Supabase's redirect actually contains and turns it into a session, logging
   * (and returning a user-visible, stage-labeled message on failure) at every branch — this is
   * the single place that answers "which of the 6 possible causes was it."
   */
  const completeAuthFromUrl = async (url: string): Promise<AuthResult> => {
    console.log('[Auth] processing redirect URL:', url);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      console.warn('[Auth] redirect URL failed to parse:', err);
      return { error: 'Sign-in link was malformed. Please try again.', userId: null };
    }

    const oauthError = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    if (oauthError) {
      console.warn('[Auth] provider returned an error in the redirect:', oauthError);
      return { error: `Sign-in was rejected by Google or Supabase: ${oauthError}`, userId: null };
    }

    const code = parsed.searchParams.get('code');
    if (code) {
      console.log('[Auth] found a PKCE code, exchanging for a session…');
      let data: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>['data'];
      let error: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>['error'];
      try {
        ({ data, error } = await withTimeout(supabase.auth.exchangeCodeForSession(code), AUTH_CALL_TIMEOUT_MS, 'exchangeCodeForSession'));
        if (error && isRetryableAuthError(error)) {
          console.warn('[Auth] exchangeCodeForSession hit a transient network error, retrying once:', error.message);
          await sleep(AUTH_RETRY_DELAY_MS);
          ({ data, error } = await withTimeout(supabase.auth.exchangeCodeForSession(code), AUTH_CALL_TIMEOUT_MS, 'exchangeCodeForSession'));
        }
      } catch (err) {
        console.warn('[Auth] exchangeCodeForSession did not complete:', err);
        return {
          error: 'Sign-in is taking longer than expected. Check your connection and try again.',
          userId: null,
        };
      }
      if (error) {
        // Raw error.message (e.g. "PKCE code verifier not found in storage...") is logged here for
        // developers ONLY — never interpolated into the returned string. Requesting a second magic
        // link always overwrites the first's locally-stored PKCE verifier (Supabase's own
        // documented behavior), so tapping an older email after a resend lands here; an expired or
        // already-used code lands here too. See lib/authErrorMessages.ts.
        console.warn('[Auth] exchangeCodeForSession failed:', error.message);
        return { error: describeAuthExchangeFailure(error), userId: null };
      }
      console.log('[Auth] session established via code exchange for user', data.session?.user.id);
      return { error: null, userId: data.session?.user.id ?? null };
    }

    // Fallback: an 'implicit' flow (or a misconfigured client) returns tokens in the fragment
    // instead of a `?code=` query param.
    const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    const fragmentParams = new URLSearchParams(fragment);
    const accessToken = fragmentParams.get('access_token');
    const refreshToken = fragmentParams.get('refresh_token');
    if (accessToken && refreshToken) {
      console.log('[Auth] found implicit-flow tokens in the redirect fragment, setting session…');
      let data: Awaited<ReturnType<typeof supabase.auth.setSession>>['data'];
      let error: Awaited<ReturnType<typeof supabase.auth.setSession>>['error'];
      try {
        ({ data, error } = await withTimeout(
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
          AUTH_CALL_TIMEOUT_MS,
          'setSession',
        ));
        if (error && isRetryableAuthError(error)) {
          console.warn('[Auth] setSession hit a transient network error, retrying once:', error.message);
          await sleep(AUTH_RETRY_DELAY_MS);
          ({ data, error } = await withTimeout(
            supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
            AUTH_CALL_TIMEOUT_MS,
            'setSession',
          ));
        }
      } catch (err) {
        console.warn('[Auth] setSession did not complete:', err);
        return {
          error: 'Sign-in is taking longer than expected. Check your connection and try again.',
          userId: null,
        };
      }
      if (error) {
        console.warn('[Auth] setSession failed:', error.message);
        return { error: describeAuthExchangeFailure(error), userId: null };
      }
      return { error: null, userId: data.session?.user.id ?? null };
    }

    // Diagnostic detail (redirect URL config guidance) is logged for developers only — never
    // shown to the athlete (see lib/authErrorMessages.ts).
    console.warn('[Auth] redirect had neither a code, tokens, nor an error — full URL:', url);
    return { error: describeAuthExchangeFailure(null), userId: null };
  };

  /** Plain email+password sign-in — no signup path here (Supabase's `signUp` is never called from
   *  this app; the one account meant to use this is created ahead of time via the Admin API). A
   *  wrong password/unknown email both surface as the same generic message, matching Supabase
   *  Auth's own "Invalid login credentials" — never distinguishing "wrong password" from "no such
   *  account" to an unauthenticated caller.
   *
   * Returns `userId` (like completeAuthFromUrl/signInWithGoogle already do) so the caller can act
   * on the result immediately — B.14: OnboardingFlow uses this to call resumeReturningUser right
   * away, the same post-auth handling the magic-link deep-link path already had, instead of relying
   * on `session` state to have propagated to every consumer by the next line. */
  const signInWithPassword = async (email: string, password: string): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.warn('[Auth] signInWithPassword failed:', error.name ?? 'unknown', error.message);
    } else {
      console.log('[Auth] signInWithPassword succeeded');
    }
    return { error: error?.message ?? null, userId: data.user?.id ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        isReady,
        session,
        requestMagicLink,
        signInWithProvider,
        linkProvider,
        getConnectedProviders,
        completeAuthFromUrl,
        signInWithPassword,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
