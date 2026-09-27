import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { isRetryableAuthError } from '@/lib/authRetry';
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

/** The exact redirect used for BOTH Google OAuth and the magic-link email, so there's only ever
 *  one URL that needs to be registered in Supabase's Auth > URL Configuration allowlist. */
export function getAuthRedirectUri(): string {
  return makeRedirectUri({ scheme: 'racesignal', path: 'auth-callback' });
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
  /** Opens Google's OAuth consent screen in an in-app browser sheet and exchanges the result for
   *  a session. Never reads the Google profile name into anything — the racing name collected
   *  during discovery stays the only source for that (see OnboardingFlow / raceMapping). */
  signInWithGoogle: () => Promise<AuthResult>;
  /** Turns an incoming `racesignal://auth-callback...` URL (from either Google or a tapped magic
   *  link) into a session. Exposed so OnboardingFlow can also call it directly for a deep link
   *  received while the app is already running (Linking's 'url' event) or recovered from the
   *  app's cold-start launch URL. */
  completeAuthFromUrl: (url: string) => Promise<AuthResult>;
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

  const requestMagicLink = async (email: string) => {
    const redirectTo = getAuthRedirectUri();
    console.log('[Auth] requesting magic link for', email, '-> redirectTo', redirectTo);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });
    if (error) console.warn('[Auth] signInWithOtp (magic link) failed:', error.message);
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
          error: 'Sign-in is taking longer than expected — check your connection and try again.',
          userId: null,
        };
      }
      if (error) {
        console.warn('[Auth] exchangeCodeForSession failed:', error.message);
        return {
          error: `Sign-in didn’t complete — code exchange failed (${error.message}). This usually means the code was already used, expired, or the app was restarted between starting sign-in and finishing it.`,
          userId: null,
        };
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
          error: 'Sign-in is taking longer than expected — check your connection and try again.',
          userId: null,
        };
      }
      if (error) {
        console.warn('[Auth] setSession failed:', error.message);
        return { error: `Sign-in didn’t complete — session setup failed (${error.message}).`, userId: null };
      }
      return { error: null, userId: data.session?.user.id ?? null };
    }

    console.warn('[Auth] redirect had neither a code, tokens, nor an error — full URL:', url);
    return {
      error:
        'Sign-in redirected back to the app but included no code or session. This usually means the redirect URL Supabase/Google are configured with doesn’t exactly match racesignal://auth-callback — check Supabase Auth > URL Configuration and the Google Cloud OAuth client.',
      userId: null,
    };
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    const redirectTo = getAuthRedirectUri();
    console.log('[Auth] starting Google sign-in, redirectTo =', redirectTo);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      console.warn('[Auth] signInWithOAuth failed to produce a URL:', error?.message);
      return {
        error: `Could not start Google sign-in (${error?.message ?? 'no URL returned'}) — check that Google is enabled under Supabase Auth > Providers.`,
        userId: null,
      };
    }
    console.log('[Auth] opening Google consent screen…');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    console.log('[Auth] browser session closed with result type:', result.type);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { error: null, userId: null };
    }
    if (result.type !== 'success' || !result.url) {
      return { error: `Google sign-in didn’t complete (browser closed with "${result.type}").`, userId: null };
    }

    return completeAuthFromUrl(result.url);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ isReady, session, requestMagicLink, signInWithGoogle, completeAuthFromUrl, signOut }}>
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
