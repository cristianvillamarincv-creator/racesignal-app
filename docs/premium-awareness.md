# Premium awareness (release 1.1)

Premium awareness explains the Signal allowance and the existing Premium offer in the app. The RevenueCat paywall, products, pricing and the one-time post-onboarding paywall are unchanged. Races, Stats and Race Prep stay free. Copy only describes what exists: more Signal asks. Nothing advertises prediction, notifications, unlimited asks or improved answers.

## Rules

- **Free:** 3 asks in total, for the life of the account; they do not renew. **Premium:** 40 asks each UTC calendar month (not the billing date). The server still returns the next reset instant (`resetsAt`) and the quota math is unchanged, but no surface shows a reset date or time.
- Counts are only ever the server's: the read-only `usage` action (`{ remaining, cap, isPremium, resetsAt }`) or a reply's own count. Unknown or failed usage shows no count and is never treated as zero or Premium.
- Usage is refreshed when Signal (tab or conversation) opens or regains focus or the app returns to the foreground, after a send settles, and after every paywall return (strip, tab card, exhausted-send hand-off). Responses are ordered so a stale lookup cannot overwrite a newer one.

## Surfaces and copy

| Surface | Free | Premium |
|---|---|---|
| Signal tab, one card (confirmed free only) below "Ask Signal anything" and above Recent Signals (16pt below the ask row, 24pt above Recent Signals; 16pt padding and corners; 18pt heading; 14pt/20pt body; 8pt heading to body, 12pt before the action; 44pt target) | Heading "Keep exploring your race history"; "2 of 3 free asks remaining" (or, at zero, "You've used your 3 free asks."); "Your free asks don't renew. Premium includes 40 asks each month." (at zero, "Get 40 Signal asks each month with Premium."); "Explore Premium" | No card (including at the monthly limit); Recent Signals simply follows the ask row. Also nothing while usage is unknown |
| Conversation allowance area (two lines, wraps, no fixed height) | "2 of 3 free asks remaining" / "Premium includes 40 asks each month." / "Explore Premium" | "28 of 40 asks remaining this month" only (at the limit: "You’ve used your 40 asks this month." / "More become available next month."); no reset date, no upgrade action |
| Conversation, free balance 0 | "You've used your 3 free asks." / "Keep the conversation going with 40 asks each month." / "Explore Premium" | n/a |
| Settings → Plan (row shows Free or Premium) → Subscription | "RaceSignal Free" / "3 free Signal asks total. They don't renew." / "Explore RaceSignal Premium" with "40 Signal asks each month." / Restore Purchases | "RaceSignal Premium" ACTIVE / "40 Signal asks each month." / Restore Purchases |

Developer Preview never reads usage and shows no Premium card; the obsolete Premium race-lock messaging (lock icon, "full result is Premium", the `locked` field) was removed.

## Exhausted balance

A free balance the server has confirmed is 0 intercepts Send before any message is added or the model is called: the paywall opens, and a dismissed paywall leaves the draft and any attachment in the composer and adds nothing to the thread. After a purchase or restore, entitlement and usage are re-read and the pending question is sent exactly once, with its original request id, only if the server confirms an available allowance (the real monthly counter decides, not the purchase). A confirmed Premium monthly limit blocks Send without the paywall and says "You’ve used your 40 asks this month. More become available next month." If the server rejects a send the app believed allowed, the unanswered question leaves the thread, the draft returns, and the same paywall hand-off applies. Reading threads, typing a draft and attaching an image stay available throughout.

## Device checks

**Passed on device (development build, Test Store, `cristian.flipd@gmail.com`):**

- Paywall dismissal with an exhausted free balance preserves the draft and the attachment, and adds nothing to the thread.
- A Test Store purchase from the exhausted Send resumes exactly one visible question, the allowance shows 39 of 40 remaining, and Settings shows RaceSignal Premium ACTIVE.

**Read-only verification of that purchase flow (development database and RevenueCat, 2026-10-05 UTC; no model call, nothing reset):**

- One successful Premium ask: one new `signal_usage_log` row after the last free ask (01:16:15, `was_premium` true, with an image); the monthly counter (`signal_rate_limit`, window 2026-10-01) is 1, which is the 39 of 40 shown; the lifetime free counter is still 3 of 3, untouched.
- One stored exchange: a single new conversation ("Explain this", created 01:16:15) holding exactly 2 messages (one user, one assistant); no other conversation or message was written in that period.
- One request: a single new `signal_request_dedup` row, `completed`, tier premium, reserved count 1 (request id reused from the question the athlete first sent). No second reservation or reply for the same question.
- RevenueCat (development project), rechecked read-only after that purchase: the customer holds an active Test Store (sandbox) subscription that started at 01:16:07 UTC with accelerated five-minute periods and auto-renewal `will_renew`. Two reads minutes apart showed the active entitlement's expiry advance from 01:21:07 to 01:26:07 UTC, i.e. it is renewing, not lapsing. An earlier note here that the Premium period "has since lapsed" was inferred from a single expiry timestamp and was wrong; it is withdrawn. Expect the Test Store subscription to keep renewing every five minutes until cancelled or the Test Store stops it, so the account stays Premium for now. **Correction (2026-10-06):** a later read showed that subscription had expired at 01:41 UTC on Oct 5 with auto-renewal `will_not_renew`, so Test Store renewals are time-limited and Premium needs a fresh in-app purchase for later model-call tests (the Premium allowance counts seen during the prediction test suggest a new purchase was made).

**Pending:**

1. Restore Purchases from the strip, the tab card and the exhausted Send: allowance area, tab and Settings update on return; the pending question is sent once. (From Settings → Subscription it passed on the device on 2026-10-07/08 for both outcomes: "Nothing to restore" with no active subscription, "Purchases restored" after a new Test Store purchase.)
2. Premium at its monthly limit (the counter at 40): "You’ve used your 40 asks this month. More become available next month.", no upgrade action, Send blocked without a paywall.
3. Larger text sizes: the Signal tab card and the conversation allowance area wrap without clipping.
4. Production StoreKit testing (real App Store products and sandbox accounts against the production RevenueCat project): not started.
5. Reopening Signal after a server-side change shows the server's count before anything is sent (the pre-send refresh) is not yet recorded as a separate device pass.
