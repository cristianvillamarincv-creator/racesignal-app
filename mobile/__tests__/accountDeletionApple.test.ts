import { APPLE_MANUAL_REMOVAL_MESSAGE, needsManualAppleRemovalNotice, planAppleRevocation } from '@/lib/accountDeletion';
import { buildConnectedAccountRows, feedbackForLinkResult } from '@/lib/connectedAccounts';

const APPLE = [{ provider: 'apple', providerUserId: 'apple-sub', email: null }];

describe('planAppleRevocation: Apple reauthentication is never a barrier to deletion', () => {
  it('does nothing for an account with no Apple sign-in, without opening Apple', async () => {
    const request = jest.fn();
    expect(await planAppleRevocation([{ provider: 'email', providerUserId: 'u', email: 'a@b.co' }], ['email'], request)).toEqual({ kind: 'none' });
    expect(request).not.toHaveBeenCalled();
  });
  it('sends a fresh code when Apple provides one, scoped to the linked Apple user', async () => {
    const request = jest.fn().mockResolvedValue({ status: 'code', authorizationCode: 'c1' });
    expect(await planAppleRevocation(APPLE, ['apple'], request)).toEqual({ kind: 'revoke', authorizationCode: 'c1' });
    expect(request).toHaveBeenCalledWith('apple-sub');
  });
  it('reports a cancelled Apple sheet so the UI can offer "delete anyway" instead of forcing it', async () => {
    expect(await planAppleRevocation(APPLE, ['apple'], jest.fn().mockResolvedValue({ status: 'cancelled' }))).toEqual({ kind: 'cancelled' });
  });
  it.each(['unavailable', 'error'] as const)('proceeds without revocation when Apple is %s', async (status) => {
    expect(await planAppleRevocation(APPLE, ['apple'], jest.fn().mockResolvedValue({ status }))).toEqual({ kind: 'skipped' });
  });
  it('falls back to the session\'s providers when the identity list could not be read', async () => {
    const request = jest.fn().mockResolvedValue({ status: 'code', authorizationCode: 'c2' });
    expect(await planAppleRevocation(null, ['email', 'apple'], request)).toEqual({ kind: 'revoke', authorizationCode: 'c2' });
    expect(request).toHaveBeenCalledWith(null);
    expect(await planAppleRevocation(null, ['email'], jest.fn())).toEqual({ kind: 'none' });
  });
});

describe('manual-removal notice', () => {
  it('is shown whenever Apple was involved but the server did not confirm revocation', () => {
    expect(needsManualAppleRemovalNotice({ kind: 'skipped' }, 'not_attempted')).toBe(true);
    expect(needsManualAppleRemovalNotice({ kind: 'revoke', authorizationCode: 'c' }, 'failed')).toBe(true);
    expect(needsManualAppleRemovalNotice({ kind: 'cancelled' }, 'not_attempted')).toBe(true);
  });
  it('is not shown after a confirmed revocation or when Apple was never used', () => {
    expect(needsManualAppleRemovalNotice({ kind: 'revoke', authorizationCode: 'c' }, 'revoked')).toBe(false);
    expect(needsManualAppleRemovalNotice({ kind: 'none' }, 'not_attempted')).toBe(false);
  });
  it('says the account IS deleted', () => {
    expect(APPLE_MANUAL_REMOVAL_MESSAGE).toMatch(/account is deleted/i);
  });
});

describe('Connected accounts rows and feedback', () => {
  it('lists only enabled providers and marks the connected one', () => {
    expect(buildConnectedAccountRows(APPLE, { apple: true, google: true })).toEqual([
      { provider: 'apple', label: 'Apple', connected: true },
      { provider: 'google', label: 'Google', connected: false },
    ]);
    expect(buildConnectedAccountRows(APPLE, { apple: false, google: false })).toEqual([]);
  });
  it('maps link results to feedback; cancel is silent and conflict is an error that keeps both accounts', () => {
    expect(feedbackForLinkResult('apple', { status: 'success' })).toEqual({ kind: 'notice', text: expect.stringContaining('Apple is connected') });
    expect(feedbackForLinkResult('apple', { status: 'cancelled' })).toEqual({ kind: 'none' });
    expect(feedbackForLinkResult('google', { status: 'conflict', message: 'm' })).toEqual({ kind: 'error', text: 'm' });
    expect(feedbackForLinkResult('google', { status: 'unavailable' }).kind).toBe('error');
  });
});
