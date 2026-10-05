/**
 * Plain, restrained copy for the Signal allowance, shared by every surface that shows it (the Signal tab, the conversation, and
 * Settings) so the wording cannot drift. `remaining`/`cap`/`isPremium`/`resetsAt` come straight from the signal Edge Function
 * (the server-side source of truth, see supabase/functions/signal/index.ts); nothing here computes an allowance.
 *
 * Free: 3 asks in total, for the life of the account; they do not renew. Premium: 40 asks each UTC calendar month (the quota follows
 * UTC calendar months, not the subscription's billing date). The function still returns the reset instant; no surface shows it.
 */
import type { SignalUsagePayload } from '@/lib/signal';

/** Mirrors the function's SIGNAL_PREMIUM_MONTHLY_CAP default and the paywall's "40 Signal asks per month". */
export const PREMIUM_MONTHLY_ASKS = 40;
/** Mirrors the function's SIGNAL_FREE_MONTHLY_CAP default (a lifetime total) and the paywall's "3 Signal asks in total". */
export const FREE_TOTAL_ASKS = 3;

/** Premium at its monthly limit (no upgrade action). */
export const PREMIUM_EXHAUSTED_SUPPORT = 'More become available next month.';
export const EXPLORE_PREMIUM_LABEL = 'Explore Premium';
export const PREMIUM_PROMO_HEADING = 'Keep exploring your race history';
export const PREMIUM_INCLUDES_LINE = `Premium includes ${PREMIUM_MONTHLY_ASKS} asks each month.`;
/** Landing card, free with asks remaining / exhausted. */
export const CARD_FREE_SUPPORT = `Your free asks don\u2019t renew. Premium includes ${PREMIUM_MONTHLY_ASKS} asks each month.`;
export const CARD_EXHAUSTED_SUPPORT = `Get ${PREMIUM_MONTHLY_ASKS} Signal asks each month with Premium.`;
export const EXHAUSTED_SUPPORT = `Keep the conversation going with ${PREMIUM_MONTHLY_ASKS} asks each month.`;
export const SETTINGS_FREE_TITLE = 'RaceSignal Free';
export const SETTINGS_FREE_DETAIL = `${FREE_TOTAL_ASKS} free Signal asks total. They don\u2019t renew.`;
export const SETTINGS_UPGRADE_LABEL = 'Explore RaceSignal Premium';
export const SETTINGS_PREMIUM_DETAIL = `${PREMIUM_MONTHLY_ASKS} Signal asks each month.`;

/** A free balance the server confirmed is used up. Unknown usage (null) is never treated as exhausted, free or Premium. */
export function isFreeExhausted(usage: SignalUsagePayload | null): boolean {
  return usage !== null && !usage.isPremium && usage.remaining === 0;
}

/** A Premium monthly balance the server confirmed is used up. */
export function isPremiumExhausted(usage: SignalUsagePayload | null): boolean {
  return usage !== null && usage.isPremium && usage.remaining === 0;
}

const asks = (count: number) => (count === 1 ? 'ask' : 'asks');

/** "2 of 3 free asks remaining" or "28 of 40 asks remaining this month". The noun agrees with the total the count is "of". */
export function formatAllowanceHeadline(usage: SignalUsagePayload): string {
  return usage.isPremium
    ? `${usage.remaining} of ${usage.cap} ${asks(usage.cap)} remaining this month`
    : `${usage.remaining} of ${usage.cap} free ${asks(usage.cap)} remaining`;
}

/** "You\u2019ve used your 3 free asks." (free) or "You\u2019ve used your 40 asks this month." (Premium), for a confirmed balance of zero. */
export function formatExhaustedHeadline(usage: SignalUsagePayload): string {
  return usage.isPremium ? `You\u2019ve used your ${usage.cap} ${asks(usage.cap)} this month.` : `You\u2019ve used your ${usage.cap} free ${asks(usage.cap)}.`;
}

/** The full Premium-exhausted message used where a single line is needed (a blocked Send). */
export function formatPremiumExhaustedMessage(usage: SignalUsagePayload): string {
  return `${formatExhaustedHeadline(usage)} ${PREMIUM_EXHAUSTED_SUPPORT}`;
}

export interface AllowanceCardContent {
  heading: string;
  status: string;
  support: string;
}

/**
 * What the Signal tab's single allowance card says. It exists for confirmed free athletes only: null for Premium (their count lives in
 * the conversation, beside the composer) and null for unknown usage, so the card is hidden until the server confirms a free plan and
 * count, never guessed. Free gets the heading, status and supporting line (remaining or used up); the screen adds "Explore Premium".
 */
export function buildAllowanceCardContent(usage: SignalUsagePayload | null): AllowanceCardContent | null {
  if (!usage || usage.isPremium) return null;
  const exhausted = isFreeExhausted(usage);
  return {
    heading: PREMIUM_PROMO_HEADING,
    status: exhausted ? formatExhaustedHeadline(usage) : formatAllowanceHeadline(usage),
    support: exhausted ? CARD_EXHAUSTED_SUPPORT : CARD_FREE_SUPPORT,
  };
}
