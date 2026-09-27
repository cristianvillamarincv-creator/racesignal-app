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
