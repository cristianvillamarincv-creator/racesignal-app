import { AuthApiError, AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';

import { describeAuthExchangeFailure, RESEND_SUCCESS_MESSAGE, SIGN_IN_LINK_INVALID_MESSAGE } from '@/lib/authErrorMessages';

describe('describeAuthExchangeFailure', () => {
  it('never leaks the raw PKCE-verifier-missing message (the exact Step 8 physical-device finding)', () => {
    const rawError = new AuthPKCECodeVerifierMissingError();
    expect(rawError.message).toContain('PKCE code verifier not found in storage');
    expect(describeAuthExchangeFailure(rawError)).toBe(SIGN_IN_LINK_INVALID_MESSAGE);
    expect(describeAuthExchangeFailure(rawError)).not.toContain('PKCE');
  });

  it('maps an expired/already-used code (AuthApiError) to the same safe message', () => {
    const rawError = new AuthApiError('invalid request: both auth code and code verifier should be non-empty', 400, 'bad_code_verifier');
    expect(describeAuthExchangeFailure(rawError)).toBe(SIGN_IN_LINK_INVALID_MESSAGE);
  });

  it('never contains implementation/config guidance regardless of input', () => {
    expect(describeAuthExchangeFailure(null)).not.toMatch(/supabase|pkce|google cloud/i);
  });
});

describe('RESEND_SUCCESS_MESSAGE', () => {
  it('has the exact required copy and tells the athlete which email to use', () => {
    expect(RESEND_SUCCESS_MESSAGE).toBe('We sent a new sign-in link. Use the newest email. Earlier links will no longer work.');
  });

  it('is distinct from the invalid-link error message — never shown at the same time as it', () => {
    expect(RESEND_SUCCESS_MESSAGE).not.toBe(SIGN_IN_LINK_INVALID_MESSAGE);
  });
});
