# Release 1.1: QA and production-setup status (checkpoint 2026-10-06)

**The release is not ready.** Scope decision (2026-10-07): Sign in with Apple and Google stay in 1.1. The pre-release verification (Restore Purchases, notification account isolation and cleanup, permission handling), the `signal` production deployment rules and the local-notification binary check are in `docs/release-1.1-checklist.md`; the private setup steps are in `docs/production-setup-1.1.md`. This page consolidates what has passed, what is pending and what is blocked. Owner-confirmed device passes are marked "device"; everything else is automated or read-only. Nothing here has been deployed to production, built for production, version-bumped or submitted.

## What 1.1 contains (development only so far)
Sign in with Apple and Google plus connected accounts; Premium awareness (Signal allowance copy and exhausted-send paywall hand-off); Signal conversation and usage refresh; local race-prep and between-race notifications; a server-derived historical reference range for upcoming races in Signal. "Find a race" is deferred (see `docs/future-ideas.md`); the manual upcoming-race flow, including distance entry, is unchanged.

## Passed
**Authentication** (device, development project; detail in `docs/social-sign-in.md`)
- Apple sign-up and sign-in; Google browser-OAuth sign-in for a new and an existing account.
- Account preservation on the dev account: email to Google, then Google to magic link, with the same user id, races, profile, Signal usage and RevenueCat customer.

**Premium awareness** (device, Test Store; detail in `docs/premium-awareness.md`)
- Paywall dismissal with an exhausted balance keeps the draft and attachment and adds nothing to the thread.
- A Test Store purchase from the exhausted Send resumed exactly one question; allowance 39 of 40; Settings showed Premium active. Verified read-only afterward (one reservation, one conversation of two messages, counters as expected).

**Notifications** (device; detail in `docs/notifications.md`). These used **accelerated test deliveries**, not real scheduled ones.
- Basic and calendar-trigger delivery and taps; between-race prompts open Signal with the matching starter and send nothing.
- Empty-composer starter opens the keyboard; "Keep my draft" and "Add starter" behave correctly.
- Weekly countdown correct (13 days, then 6 days after a date edit); race-prep taps open the right race with the checklist expanded and the item highlighted, also after closing the app.
- One race at a time: making another race nearer removed the first race's reminders; the accelerated two-day milestone delivered and opened Race Prep.

**Race prediction** (device, dev account with labelled synthetic races; detail in `docs/race-prediction.md`)
- Registered Prediction Test Olympic: correct range 2:41:55 to 2:48:20, correct supporting races, dates and supplied 6:25 difference; a concise same-thread follow-up that did not repeat the limitation; allowance 38 to 37.
- Considering Prediction Test Olympic (after the wording and header corrections): a custom question gave the correct range with supporting results and one concise limitation and no extra commentary; the race header read "Signal has your race details and your full race history."; the race screen showed no Signal module for the considering race.

**Automated checks** (at this checkpoint): Jest 583 tests in 61 suites; Deno 80 tests (calculation, loader, prompt, usage); `tsc` and `eslint` clean.

## Pending (testable on the development build)
**Race prediction**
- The Signal module returning on the race screen now that Prediction Test Olympic is `registered` again (the fixture was restored in the development database; the owner has not yet looked).
- One recent result, only older results, no comparable history, an unsupported distance, nearly identical results, duplicate records: automated tests only so far, no real-model run.
- Suggested chips in an unseeded chat and the Signal tab's "Your next race" module with an eligible nearest race.

**Notifications**
- Real scheduled delivery at normal times (a weekly reminder at its set time; real seven-day and two-day milestones); the seven-day accelerated test was not reported.
- Timezone change rebuild; permission changes (deny then enable, revoke); account cleanup on sign-out and deletion; invitation timing; larger text.
- Single-race focus when the nearest race is completed, removed or past (only a date edit was exercised); starter from the lock screen, another app and a closed app; checklist toggle and delete rescheduling.

**Premium awareness**
- Restore Purchases from each surface; Premium at its 40-ask monthly limit; larger text; the pre-send count refresh on reopening Signal.

**Authentication**
- Apple linking from Settings and the conflict case; Google Connect from Settings and its conflict case; Apple "Hide My Email" conflict; cancel and failure behavior of each provider sheet; Welcome-back review-or-skip; larger-text and final visual pass on the sign-in screen.

**Settings layout** (reorganized and restyled, see `docs/settings.md`): **device-approved for the first smoke-test group on 2026-10-07.** The owner reported on the iPhone: launch opens Stats with races; the redesigned Settings looks much better; and every navigation works (Add a race manually, Find my races, Plan → Subscription, Notifications with its switches and schedule, Signal privacy & consent, Sign-in methods, Support, Privacy, Terms). Earlier, the first review's unresponsive-tap report was not attributed to a specific row. Not reported in this pass, so still open as optional checks: larger text, dark mode and the Developer entry in a production build.

## Blocked or needing an owner decision or access
- **Apple account-deletion revocation:** the dev Apple key is not set, so only the deliberately-broken-key path has run.
- **Production rollout order and the Build 18 behavior change:** the `signal` function must deploy to production before the 1.1 app; Build 18 users get the new prediction answers the moment it does. Accept that or ship the server with the app.
- **No DNF/DNS detection** in the race import: results without a recorded time are excluded, but a non-finisher with a recorded time would look like a finish. Needs a real provider payload check.
- **Production StoreKit testing** needs the production setup below first.
- **Google brand verification** decision (needs an owned domain) and privacy/terms hosting.
- **Policy and App Store text:** privacy policy and App Privacy label for sign-in providers, notifications and prediction; Anthropic zero-data-retention status unknown.
- **Carried over from the 2026-10-02 handoff, status unconfirmed this session:** custom SMTP for magic links, free-allowance reset after delete and re-signup, RevenueCat record deletion on account deletion, Sportstats usage rights (no agreement documented), rotation of the Supabase CLI token that was exposed earlier.
- **Housekeeping:** version is still 1.0.0 (no 1.1.0 bump, no production build); the unused Google iOS client and older Web client can be deleted in Google Cloud.

## Production setup (none started; order in `docs/release-1.1-checklist.md`)
Google Cloud production redirect URI and consent-screen publishing; Apple App ID capabilities and Sign in with Apple key; Supabase production providers, manual linking and Apple secrets; deploy `delete-account` and `signal` to production (signal first, see above); `production.features` flags and `release:config`; App Store Connect policy text; production build and TestFlight QA with throwaway accounts only. Notifications are local only, so no push tokens or server sending are involved, but the privacy policy should mention them.

## Environment at this checkpoint
- Production backend untouched: `signal` v16, `race-discovery` v8, `delete-account` v2.
- Development backend: `signal` v21, `race-discovery` v5, `delete-account` v6; migrations 0001 to 0011.
- Dev account `cristian.flipd@gmail.com` now also holds three labelled synthetic races (Prediction Test Riverside Olympic, Harbor Olympic, Olympic); its other data is as it was. Its Premium state is a Test Store subscription whose renewals are time-limited: a read on 2026-10-06 found the earlier one expired, so Premium needs a fresh in-app purchase for model-call tests.
- A tunnel-mode Metro session may still be running on the Mac for device testing.
