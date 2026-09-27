import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { isRetryableAuthError } from '@/lib/authRetry';

describe('isRetryableAuthError', () => {
  it('is true for a genuine transient network-layer failure', () => {
    expect(isRetryableAuthError(new AuthRetryableFetchError('Network request failed', 0))).toBe(true);
  });

  it('is false for a definitive rejection from the server (must never be retried)', () => {
    expect(isRetryableAuthError(new AuthApiError('invalid request: both auth code and code verifier should be non-empty', 400, 'bad_code_verifier'))).toBe(
      false,
    );
  });

  it('is false for a plain, non-Supabase error', () => {
    expect(isRetryableAuthError(new Error('something else went wrong'))).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isRetryableAuthError(null)).toBe(false);
    expect(isRetryableAuthError(undefined)).toBe(false);
  });
});
