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

**Smoke test, group 2** (device, development build, 2026-10-07): Google sign-in after Sign out returned to Stats with the same races and no onboarding; completed race details opened (those fixtures are self-reported with no splits, so split rendering was **not** tested); Prediction Test Olympic showed Race Prep and the Signal module; Premium worked and the free card was hidden; one Signal exchange returned 2:41:55 to 2:48:20 with the correct supporting races and dates, the 6:25 difference and one limitation, and the allowance dropped by one. Together with group 1 (launch and Settings) this completes the smoke test the owner asked for.

**Authentication, cancel behavior** (device, development build, 2026-10-07): cancelling **Connect Apple** from Settings → Sign-in methods kept the session, left Apple unconnected and showed no error; closing the **Google sign-in** browser sheet from the sign-in screen left the sign-in screen with its buttons still working; completing Google sign-in afterward returned to Stats with the same races. Still open from that group: cancelling the **Apple sign-in** sheet on the sign-in screen, cancelling a Google **Connect** (needs an account without Google connected), and killing the app mid-flow.

**Welcome-back and pending selections** (owner runs, 2026-10-07): **Welcome-back with Skip passed on the device.** After signing out, searching, selecting races and signing in with Google, the "Welcome back." screen appeared and Skip opened Stats with the existing races unchanged. The earlier run that force-quit on the "Sign in to save N races" screen returned to name entry: the onboarding draft (the selected races) is written only when a sign-in method is started (tapping Apple or Google, or sending a magic link, via `persistDraft`), so selections lost by a force-quit before that were never saved; that is by design and not a regression, and it is **not** a selection-persistence pass. **Review selected races passed on the device (2026-10-07), exited without importing** (check run: sign out, search, select two races, Google sign-in, Welcome back with the updated copy and "Skip for now", Review selected races, Back, Skip for now, Stats unchanged; the owner reported the pass without itemizing each observation). The screen's copy was updated before this run (race count dynamic, "Review selected races" kept, "Skip" is now "Skip for now"). **The Add / import path ("Add N races" from that review) has NOT been tested on a device**, and neither has persistence across the sign-in handoff.

**Matching-profiles screen** (changed 2026-10-07, device check pending): the heading is now "We found several matching profiles." with the guidance "Choose a profile to review its race history."; the optional race and birth-year hint inputs were removed because they never filtered, ranked or annotated the matches. Profile selection is unchanged and nothing is merged. Birth year is still captured in Settings → Find my races. Automated tests cover the screen.

**Share feedback** (device, development build, 2026-10-07): the Settings → Help & legal → Share feedback row opened the email app with a draft to racesignal@gmail.com, subject "Feedback" and an empty body; the owner cancelled without sending. The can't-open fallback (message with the address and "Copy email…") is covered by automated tests only.

**Stats hero metric** (checked, no change needed): the Performance Snapshot shows "Best age-group finish · Top X%" whenever any completed race has a valid age-group ranking (a place and a field size, not flagged for confirmation) and falls back to "Races logged" otherwise. That logic is unchanged since Build 18 (only the removed Premium-lock hint differs). The dev account's five completed races have no age-group rankings, so it shows "Races logged · 5"; an account with rankings shows the Top X% hero. A regression test now pins both cases and that a flagged ranking never counts.

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
