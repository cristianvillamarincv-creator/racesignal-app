import type { SignalUsagePayload } from '@/lib/signal';
import {
  buildAllowanceCardContent,
  CARD_EXHAUSTED_SUPPORT,
  CARD_FREE_SUPPORT,
  EXHAUSTED_SUPPORT,
  EXPLORE_PREMIUM_LABEL,
  formatAllowanceHeadline,
  formatExhaustedHeadline,
  formatPremiumExhaustedMessage,
  isFreeExhausted,
  isPremiumExhausted,
  PREMIUM_INCLUDES_LINE,
  PREMIUM_PROMO_HEADING,
  SETTINGS_FREE_DETAIL,
  SETTINGS_PREMIUM_DETAIL,
  SETTINGS_UPGRADE_LABEL,
} from '@/lib/signalUsage';

const free = (remaining: number): SignalUsagePayload => ({ remaining, cap: 3, isPremium: false, resetsAt: null });
const premium = (remaining: number, resetsAt: string | null = '2026-11-01T00:00:00.000Z'): SignalUsagePayload => ({ remaining, cap: 40, isPremium: true, resetsAt });

describe('allowance copy', () => {
  it('free: "N of 3 free asks remaining" and that the free asks do not renew', () => {
    expect(formatAllowanceHeadline(free(2))).toBe('2 of 3 free asks remaining');
    expect(formatAllowanceHeadline(free(0))).toBe('0 of 3 free asks remaining');
  });

  it('Premium: the monthly count, from the server cap', () => {
    expect(formatAllowanceHeadline(premium(28))).toBe('28 of 40 asks remaining this month');
  });

  it('uses the specified wording everywhere else, and promises only what exists (more Signal asks)', () => {
    expect(PREMIUM_INCLUDES_LINE).toBe('Premium includes 40 asks each month.');
    expect(formatExhaustedHeadline(free(0))).toBe('You’ve used your 3 free asks.');
    expect(CARD_FREE_SUPPORT).toBe('Your free asks don’t renew. Premium includes 40 asks each month.');
    expect(CARD_EXHAUSTED_SUPPORT).toBe('Get 40 Signal asks each month with Premium.');
    expect(EXHAUSTED_SUPPORT).toBe('Keep the conversation going with 40 asks each month.');
    expect(EXPLORE_PREMIUM_LABEL).toBe('Explore Premium');
    expect(PREMIUM_PROMO_HEADING).toBe('Keep exploring your race history');
    expect(SETTINGS_FREE_DETAIL).toBe('3 free Signal asks total. They don’t renew.');
    expect(SETTINGS_UPGRADE_LABEL).toBe('Explore RaceSignal Premium');
    expect(SETTINGS_PREMIUM_DETAIL).toBe('40 Signal asks each month.');
    const all = [PREMIUM_INCLUDES_LINE, EXHAUSTED_SUPPORT, CARD_FREE_SUPPORT, CARD_EXHAUSTED_SUPPORT, SETTINGS_PREMIUM_DETAIL].join(' ');
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

describe('Premium exhaustion wording', () => {
  it('is the specified message, as a headline and as a single line', () => {
    expect(formatExhaustedHeadline(premium(0))).toBe('You\u2019ve used your 40 asks this month.');
    expect(formatPremiumExhaustedMessage(premium(0))).toBe('You\u2019ve used your 40 asks this month. More become available next month.');
  });
});

describe('singular and plural wording agrees with the actual numbers', () => {
  it('uses the real remaining count; the noun agrees with the total the count is "of"', () => {
    expect(formatAllowanceHeadline(free(3))).toBe('3 of 3 free asks remaining');
    expect(formatAllowanceHeadline(free(1))).toBe('1 of 3 free asks remaining');
    expect(formatAllowanceHeadline({ remaining: 1, cap: 1, isPremium: false, resetsAt: null })).toBe('1 of 1 free ask remaining');
    expect(formatExhaustedHeadline({ remaining: 0, cap: 1, isPremium: false, resetsAt: null })).toBe('You\u2019ve used your 1 free ask.');
    expect(formatAllowanceHeadline(premium(1))).toBe('1 of 40 asks remaining this month');
  });
});

describe('buildAllowanceCardContent (the Signal tab card, confirmed free only)', () => {
  it('confirmed free with asks remaining: heading, count, no-renewal plus what Premium includes, and the action', () => {
    expect(buildAllowanceCardContent(free(2))).toEqual({
      heading: 'Keep exploring your race history',
      status: '2 of 3 free asks remaining',
      support: 'Your free asks don\u2019t renew. Premium includes 40 asks each month.',
    });
  });

  it('confirmed free and exhausted: the used-up message and the Premium line, with the action', () => {
    expect(buildAllowanceCardContent(free(0))).toEqual({
      heading: 'Keep exploring your race history',
      status: 'You\u2019ve used your 3 free asks.',
      support: 'Get 40 Signal asks each month with Premium.',
    });
  });

  it('Premium has no card at all, including at the monthly limit (their count lives in the conversation)', () => {
    expect(buildAllowanceCardContent(premium(28))).toBeNull();
    expect(buildAllowanceCardContent(premium(0))).toBeNull();
  });

  it('unknown usage has no card at all', () => {
    expect(buildAllowanceCardContent(null)).toBeNull();
  });
});
