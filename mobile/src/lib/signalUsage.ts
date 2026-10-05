/**
 * Plain, restrained copy for the Signal allowance, shared by every surface that shows it (the Signal tab, the conversation, and
 * Settings) so the wording cannot drift. `remaining`/`cap`/`isPremium`/`resetsAt` come straight from the signal Edge Function
 * (the server-side source of truth, see supabase/functions/signal/index.ts); nothing here computes an allowance.
 *
 * Free: 3 asks in total, for the life of the account; they do not renew. Premium: 40 asks each UTC calendar month (the quota follows
 * UTC calendar months, not the subscription's billing date), reset instant supplied by the server and shown in the phone's timezone.
 */
import type { SignalUsagePayload } from '@/lib/signal';

/** Mirrors the function's SIGNAL_PREMIUM_MONTHLY_CAP default and the paywall's "40 Signal asks per month". */
export const PREMIUM_MONTHLY_ASKS = 40;
/** Mirrors the function's SIGNAL_FREE_MONTHLY_CAP default (a lifetime total) and the paywall's "3 Signal asks in total". */
export const FREE_TOTAL_ASKS = 3;

export const EXPLORE_PREMIUM_LABEL = 'Explore Premium';
export const PREMIUM_PROMO_HEADING = 'Keep exploring your race history';
export const PREMIUM_PROMO_BODY = `Compare your results, revisit race details and ask follow-up questions with ${PREMIUM_MONTHLY_ASKS} Signal asks each month.`;
export const PREMIUM_INCLUDES_LINE = `Premium includes ${PREMIUM_MONTHLY_ASKS} asks each month.`;
export const EXHAUSTED_HEADLINE = `You\u2019ve used your ${FREE_TOTAL_ASKS} free asks.`;
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

/** "2 of 3 free asks remaining" or "28 of 40 asks remaining this month". */
export function formatAllowanceHeadline(usage: SignalUsagePayload): string {
  return usage.isPremium ? `${usage.remaining} of ${usage.cap} asks remaining this month` : `${usage.remaining} of ${usage.cap} free asks remaining`;
}

/** "Your 3 free asks don\u2019t renew." */
export function formatFreeNoRenewal(usage: SignalUsagePayload): string {
  return `Your ${usage.cap} free asks don\u2019t renew.`;
}

export interface ResetLine {
  /** Compact, for the screen: "Resets Nov 1, 8:00 PM". */
  text: string;
  /** Full date and time with weekday, year and timezone, for screen readers. */
  accessibilityLabel: string;
}

/**
 * The monthly reset instant rendered in the viewer's timezone (the device's by default). Returns null when there is no valid
 * instant to show, so a missing reset is simply omitted rather than guessed. `locale`/`timeZone` are injectable for tests.
 */
export function formatResetLine(resetsAt: string | null, options: { locale?: string; timeZone?: string } = {}): ResetLine | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  const { locale, timeZone } = options;
  const short = date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone });
  const full = date.toLocaleString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
  return { text: `Resets ${short}`, accessibilityLabel: `Resets on ${full}` };
}
