# Premium awareness (release 1.1)

Premium awareness explains the Signal allowance and the existing Premium offer in the app. The RevenueCat paywall, products, pricing and the one-time post-onboarding paywall are unchanged. Races, Stats and Race Prep stay free. Copy only describes what exists: more Signal asks. Nothing advertises prediction, notifications, unlimited asks or improved answers.

## Rules

- **Free:** 3 asks in total, for the life of the account; they do not renew. **Premium:** 40 asks each UTC calendar month (not the billing date); the server supplies the next reset instant, shown in the phone's timezone with a full accessible date and time.
- Counts are only ever the server's: the read-only `usage` action (`{ remaining, cap, isPremium, resetsAt }`) or a reply's own count. Unknown or failed usage shows no count and is never treated as zero or Premium.
- Usage is refreshed when Signal (tab or conversation) opens or regains focus or the app returns to the foreground, after a send settles, and after every paywall return (strip, tab card, exhausted-send hand-off). Responses are ordered so a stale lookup cannot overwrite a newer one.

## Surfaces and copy

| Surface | Free | Premium |
|---|---|---|
| Signal tab, near "Ask Signal anything" | "2 of 3 free asks remaining" / "Your 3 free asks don't renew." | "28 of 40 asks remaining this month" / "Resets [local date and time]" |
| Signal tab card (confirmed free only; below the entry, above Recent Signals) | "Keep exploring your race history" / "Compare your results, revisit race details and ask follow-up questions with 40 Signal asks each month." / "Explore Premium" | not shown |
| Conversation allowance area (two lines, wraps, no fixed height) | "2 of 3 free asks remaining" / "Premium includes 40 asks each month." / "Explore Premium" | "28 of 40 asks remaining this month" / "Resets [date and time]"; no upgrade action |
| Conversation, free balance 0 | "You've used your 3 free asks." / "Keep the conversation going with 40 asks each month." / "Explore Premium" | n/a |
| Settings, Subscription | "RaceSignal Free" / "3 free Signal asks total. They don't renew." / "Explore RaceSignal Premium" with "40 Signal asks each month." / Restore Purchases | "RaceSignal Premium" ACTIVE / "40 Signal asks each month." / Restore Purchases |

Developer Preview never reads usage and shows no Premium card; the obsolete Premium race-lock messaging (lock icon, "full result is Premium", the `locked` field) was removed.

## Exhausted balance

A free balance the server has confirmed is 0 intercepts Send before any message is added or the model is called: the paywall opens, and a dismissed paywall leaves the draft and any attachment in the composer and adds nothing to the thread. After a purchase or restore, entitlement and usage are re-read and the pending question is sent exactly once, with its original request id, only if the server confirms an available allowance (the real monthly counter decides, not the purchase). A confirmed Premium monthly limit blocks Send without the paywall and shows the reset time. If the server rejects a send the app believed allowed, the unanswered question leaves the thread, the draft returns, and the same paywall hand-off applies. Reading threads, typing a draft and attaching an image stay available throughout.

## Device checks still needed

1. Reopen Signal after changing the allowance server-side: the strip and tab show the server's count before anything is sent.
2. Free balance at 0: Send opens the paywall; dismissing keeps the draft and attachment and adds nothing to the thread.
3. Purchase or restore from the strip, the tab card, Settings and the exhausted Send: the allowance area, tab and Settings update on return; the pending question is sent once.
4. Premium at its monthly limit (development account with a Test Store grant): reset time shown in the local timezone, no upgrade action, Send blocked without a paywall.
5. Larger text sizes: the allowance area wraps without clipping.
