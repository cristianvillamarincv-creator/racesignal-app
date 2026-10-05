import type { SignalUsagePayload } from '@/lib/signal';
import {
  EXHAUSTED_HEADLINE,
  EXHAUSTED_SUPPORT,
  EXPLORE_PREMIUM_LABEL,
  formatAllowanceHeadline,
  formatFreeNoRenewal,
  formatResetLine,
  isFreeExhausted,
  isPremiumExhausted,
  PREMIUM_INCLUDES_LINE,
  PREMIUM_PROMO_BODY,
  PREMIUM_PROMO_HEADING,
  SETTINGS_FREE_DETAIL,
  SETTINGS_PREMIUM_DETAIL,
  SETTINGS_UPGRADE_LABEL,
} from '@/lib/signalUsage';

const free = (remaining: number): SignalUsagePayload => ({ remaining, cap: 3, isPremium: false, resetsAt: null });
const premium = (remaining: number, resetsAt: string | null = '2026-11-01T00:00:00.000Z'): SignalUsagePayload => ({ remaining, cap: 40, isPremium: true, resetsAt });
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('allowance copy', () => {
  it('free: "N of 3 free asks remaining" and that the free asks do not renew', () => {
    expect(formatAllowanceHeadline(free(2))).toBe('2 of 3 free asks remaining');
    expect(formatAllowanceHeadline(free(0))).toBe('0 of 3 free asks remaining');
    expect(formatFreeNoRenewal(free(2))).toBe('Your 3 free asks don’t renew.');
  });

  it('Premium: the monthly count, from the server cap', () => {
    expect(formatAllowanceHeadline(premium(28))).toBe('28 of 40 asks remaining this month');
  });

  it('uses the specified wording everywhere else, and promises only what exists (more Signal asks)', () => {
    expect(PREMIUM_INCLUDES_LINE).toBe('Premium includes 40 asks each month.');
    expect(EXHAUSTED_HEADLINE).toBe('You’ve used your 3 free asks.');
    expect(EXHAUSTED_SUPPORT).toBe('Keep the conversation going with 40 asks each month.');
    expect(EXPLORE_PREMIUM_LABEL).toBe('Explore Premium');
    expect(PREMIUM_PROMO_HEADING).toBe('Keep exploring your race history');
    expect(PREMIUM_PROMO_BODY).toBe('Compare your results, revisit race details and ask follow-up questions with 40 Signal asks each month.');
    expect(SETTINGS_FREE_DETAIL).toBe('3 free Signal asks total. They don’t renew.');
    expect(SETTINGS_UPGRADE_LABEL).toBe('Explore RaceSignal Premium');
    expect(SETTINGS_PREMIUM_DETAIL).toBe('40 Signal asks each month.');
    const all = [PREMIUM_INCLUDES_LINE, EXHAUSTED_SUPPORT, PREMIUM_PROMO_BODY, SETTINGS_PREMIUM_DETAIL].join(' ');
    expect(all).not.toMatch(/unlimited|predict|notification|better|improved|faster/i);
  });
});

describe('exhausted states are only ever confirmed ones', () => {
  it('free exhausted needs a confirmed free balance of zero; Premium exhausted needs a confirmed Premium zero', () => {
    expect(isFreeExhausted(free(0))).toBe(true);
    expect(isFreeExhausted(free(1))).toBe(false);
    expect(isFreeExhausted(premium(0))).toBe(false);
    expect(isPremiumExhausted(premium(0))).toBe(true);
    expect(isPremiumExhausted(premium(3))).toBe(false);
    expect(isPremiumExhausted(free(0))).toBe(false);
  });

  it('unknown usage is neither free-exhausted nor Premium-exhausted', () => {
    expect(isFreeExhausted(null)).toBe(false);
    expect(isPremiumExhausted(null)).toBe(false);
  });
});

describe('formatResetLine (the reset instant in the viewer\'s timezone)', () => {
  it('renders the server instant in the given timezone, with a full accessible date and time', () => {
    const toronto = formatResetLine('2026-11-01T00:00:00.000Z', { locale: 'en-US', timeZone: 'America/Toronto' })!;
    expect(plain(toronto.text)).toBe('Resets Oct 31, 8:00 PM');
    expect(plain(toronto.accessibilityLabel)).toBe('Resets on Saturday, October 31, 2026 at 8:00 PM EDT');
    const tokyo = formatResetLine('2026-11-01T00:00:00.000Z', { locale: 'en-US', timeZone: 'Asia/Tokyo' })!;
    expect(plain(tokyo.text)).toBe('Resets Nov 1, 9:00 AM');
    expect(plain(tokyo.accessibilityLabel)).toContain('Sunday, November 1, 2026 at 9:00 AM');
  });

  it('is omitted, never guessed, when there is no valid instant', () => {
    expect(formatResetLine(null)).toBeNull();
    expect(formatResetLine('not a date')).toBeNull();
  });
});
