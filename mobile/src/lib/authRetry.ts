import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * Whether a failed Supabase auth call (code exchange, session set) is worth exactly one retry.
 * True only for supabase-js's own `AuthRetryableFetchError` classification — a confirmed
 * network-layer failure before the server ever decided the request (matches the "Network request
 * failed" code-exchange failure seen in TestFlight build 6) — never for a definitive rejection
 * (expired/used code, PKCE mismatch, invalid grant), which must never be retried.
 */
export function isRetryableAuthError(error: unknown): boolean {
  return isAuthRetryableFetchError(error);
}

// NOTE: a generic `callWithOneAuthRetry` helper briefly lived here, applied to `signInWithOtp`
// (the magic-link send). Removed: verified against the installed @supabase/auth-js that this
// specific call generates a brand-new PKCE verifier per attempt and — because this RN app never
// threads a flowId through to exchangeCodeForSession — a second signInWithOtp call (retry or
// manual resend) overwrites the single fixed verifier the FIRST call's already-sent email depends
// on, silently orphaning it. An AuthRetryableFetchError proves the client never got a decision
// back, not that the server never received/sent the first request, so this retry could not be
// shown safe. See auth.tsx's requestMagicLink for the full trace. `isRetryableAuthError` above
// remains correct and in use for exchangeCodeForSession/setSession, which use the auth CODE
// (single-use, safely re-attempted) rather than re-issuing a new magic-link SEND.
