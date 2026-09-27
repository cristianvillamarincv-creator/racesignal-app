import { shouldAttemptInitialPaywall, shouldMarkInitialPaywallSeen } from '@/lib/initialPaywall';
import { PAYWALL_RESULT } from '@/lib/purchases';

describe('shouldAttemptInitialPaywall', () => {
  it('is false for an existing account (backfilled as already seen)', () => {
    expect(shouldAttemptInitialPaywall({ status: 'seen' })).toBe(false);
  });

  it('is true for a genuinely new, never-seen account — eligible exactly once', () => {
    expect(shouldAttemptInitialPaywall({ status: 'not_seen' })).toBe(true);
  });

  it('is false once a prior presentation has marked the account seen (no future automatic presentation)', () => {
    // Same shape the server read returns after markInitialPaywallSeen has run.
    expect(shouldAttemptInitialPaywall({ status: 'seen' })).toBe(false);
  });

  it('is false when the seen-status read failed/timed out — never treated as "not yet seen"', () => {
    expect(shouldAttemptInitialPaywall({ status: 'unknown' })).toBe(false);
  });
});

describe('shouldMarkInitialPaywallSeen', () => {
  it('marks seen on a purchase', () => {
    expect(shouldMarkInitialPaywallSeen(PAYWALL_RESULT.PURCHASED)).toBe(true);
  });

  it('marks seen on a restore', () => {
    expect(shouldMarkInitialPaywallSeen(PAYWALL_RESULT.RESTORED)).toBe(true);
  });

  it('marks seen on a plain dismissal (the × close button)', () => {
    expect(shouldMarkInitialPaywallSeen(PAYWALL_RESULT.CANCELLED)).toBe(true);
  });

  it('marks seen when the paywall was skipped because the athlete already holds premium', () => {
    expect(shouldMarkInitialPaywallSeen(PAYWALL_RESULT.NOT_PRESENTED)).toBe(true);
  });

  it('does NOT mark seen on a genuine technical presentation failure', () => {
    expect(shouldMarkInitialPaywallSeen(PAYWALL_RESULT.ERROR)).toBe(false);
  });
});
