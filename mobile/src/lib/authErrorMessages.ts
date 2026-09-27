/**
 * The ONLY place a failed code-exchange's raw Supabase/PKCE error `.message` is allowed to reach —
 * a console.warn for developer diagnostics, never a screen (see auth.tsx's completeAuthFromUrl).
 * Root cause of the "PKCE code verifier not found in storage..." text reaching an athlete's screen
 * (Step 8 pre-TestFlight physical-device finding): that raw message was being interpolated directly
 * into the user-facing string. This is the fix — one safe, actionable message for every non-timeout
 * exchange failure, regardless of the underlying cause (an expired code, an already-used code, or a
 * code whose PKCE verifier was overwritten by a second magic-link request — Supabase's own docs
 * confirm requesting a second link always overwrites the first's locally-stored verifier, so only
 * the newest emailed link can ever be exchanged). The fix here is entirely about what the athlete
 * sees, not about weakening PKCE itself, which is unchanged.
 */
export const SIGN_IN_LINK_INVALID_MESSAGE = 'This sign-in link is no longer valid. Request a new one to continue.';

/** A hung request specifically (see auth.tsx's own timeout catch) gets its own, already-safe,
 *  already-actionable message — kept separate rather than folded into the message above, since
 *  "check your connection" is a genuinely different, correct instruction for that situation. */
export const SIGN_IN_SLOW_MESSAGE = 'Sign-in is taking longer than expected — check your connection and try again.';

/** Shown on OnboardingFlow's CheckEmailStep right after a successful resend (Step 8 pre-TestFlight
 *  hardening) — a resend always overwrites the previous email's locally-stored PKCE verifier (see
 *  SIGN_IN_LINK_INVALID_MESSAGE's own doc comment), so this tells the athlete which email is now
 *  the only one that can still be exchanged, before they have a chance to tap the wrong one. */
export const RESEND_SUCCESS_MESSAGE = 'We sent a new sign-in link. Use the newest email — earlier links will no longer work.';

/**
 * Maps any non-timeout exchangeCodeForSession/setSession failure to safe, athlete-facing copy.
 * Deliberately ignores the error's own `.message`/`.name` for the returned string — every such
 * failure has the same correct recovery action (request a fresh link), so there is nothing about
 * the specific cause worth surfacing to the athlete. Takes the error only so call sites read as
 * self-documenting and so a future genuinely distinct case has an obvious place to branch.
 */
export function describeAuthExchangeFailure(_error: unknown): string {
  return SIGN_IN_LINK_INVALID_MESSAGE;
}
