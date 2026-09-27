/**
 * Restrained usage copy for the Signal screen (Step 8.5) — deliberately plain arithmetic English,
 * never a token/crypto-style counter. `remaining`/`cap` come straight from the signal Edge
 * Function's response (the server-side source of truth — see supabase/functions/signal/index.ts),
 * never computed or trusted client-side.
 */
export function formatSignalUsageLabel(remaining: number, cap: number, isPremium: boolean): string {
  return isPremium ? `${remaining} of ${cap} Signal asks remaining this month` : `${remaining} of ${cap} free Signal asks remaining this month`;
}
