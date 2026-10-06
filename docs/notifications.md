# Notifications (release 1.1)

Two optional notification types, both **off by default**, scheduled **locally on the device** (no server, no push token, no backend change, no production change). Built on `expo-notifications` (already in the native fingerprint of the existing development build 2; no rebuild is needed to try it there).

## What they do

**Race-prep reminders** (offered after saving an upcoming race: "Stay ahead of race prep", Enable reminders / Not now)
- **One race at a time.** The focus race is the **nearest incomplete race dated today or later**; races sharing the earliest date are ordered by id, so the choice is stable and reconciliation never alternates between them. Only the focus race gets reminders: a weekly reminder (Sunday 4 p.m. local time by default, editable) about one relevant unchecked item, plus a **seven-day** and a **two-day** milestone at 4 p.m. (time editable). A weekly reminder within 48 hours of either milestone is suppressed; both milestones are always kept; no weekly reminder on or after race day.
- Other races get nothing: they are not scheduled and their milestones are never combined. Previously scheduled reminders for non-selected races (and any old combined milestone notification) are cancelled by the next reconcile.
- If the focus race's relevant checklist is complete it gets nothing, and the plan does **not** move to a later race. Focus moves only when the focus race is completed, removed, past, or no longer the nearest (a date edit); reconcile then cancels the obsolete reminders and schedules the new focus race.
- Relevance: the checklist is one shared 30-item template and is never changed. For notifications only, a running race excludes swim and bike items, a cycling race swim and run items, and so on (`lib/notifications/relevance.ts`). An unclassifiable sport ("other") is "uncertain": generic wording only ("You have unfinished race-prep items."), no invented task.
- Copy (body): "21 days until [race]. Is your transportation sorted?" (a specific question only for an item that is unchecked); "One week until [race]. Have you checked your gear?" (gear unchecked; otherwise a specific question); "Two days until [race]. You have unfinished prep items."
- Tap: opens the race and expands the checklist, highlighting the item (scrolled into view) when it is still unchecked; a checked item opens the checklist with no highlight; a deleted or completed race opens the Races list. (The payload for the old combined milestone, `prep-list`, is still understood so a notification scheduled by an earlier version opens the Races list; no new one is created.)

**Between-race prompts** (offered once, on the second fresh launch after onboarding, only with no upcoming race: "Think about what comes next")
- One prompt a week, Sunday 4 p.m. by default (editable), for up to eight weeks ahead, while no eligible upcoming race exists. The six agreed question/draft pairs live in `lib/notifications/prompts.ts`. Retrospective prompts (3 of 6) need a completed race in the last 12 months.
- Shuffle without replacement, reshuffle after a complete cycle, never opening a cycle with the prompt that closed the last. Assigned slots are persisted per athlete so a reconcile never reshuffles scheduled prompts; future scheduled prompts do not count as shown; the rotation advances when a slot's time passes (delivery cannot be guaranteed). Pausing for an upcoming race returns unshown prompts to the pool and the rotation resumes afterward.
- Continues for exhausted free users. Notification copy is neutral (just the question). The invitation sheet and Settings state that sending needs an available Signal ask or Premium.
- Tap: opens Signal with the starter. Empty composer: the starter fills it (editable, focused). **Existing draft: kept untouched**, with an explicit choice to add the starter after it. Never sent, never an ask; the existing exhausted-allowance paywall on Send is unchanged.

## Opt-in, permission and Settings
- iOS permission is requested **only after Enable is tapped** (invitation or Settings switch); defaults are applied immediately with no scheduling form. "Not now" dismisses the invitation permanently; Settings can enable it any time. A refused prompt leaves the type off and explains where to turn it on (Open iOS Settings). Permission turned off later is detected on return to the foreground: reminders are cancelled and Settings shows why.
- Settings → Preferences → Notifications: a separate switch per type, editable weekly day and time, editable race-milestone time.
- Preferences, rotation and launch counts are **per athlete, per device** (AsyncStorage, keyed by athlete id). Existing users start counting launches at their first launch of this feature. Only launches that begin in the app (not the one that finishes onboarding) count.
- The invitation is a root-level sheet gated until onboarding has ended and the initial paywall has settled, and never shown over the paywall or the Signal consent sheet (`lib/overlayBlockers.ts`).

## Scheduling and reconcile
- `lib/notifications/planner.ts` (pure) decides the full desired schedule from the clock, preferences, races (with checklist state) and rotation; `reconcile.ts` makes the OS match (cancel unwanted, add missing; identifiers carry a content hash, so changed content is rescheduled). At most 12 weeks of race reminders and 8 weeks of prompts, capped at 60 pending (iOS allows 64).
- Reconciles on launch, return to foreground, and whenever the athlete, races (including checklist toggles, edits, removals), preferences or permission change. It never plans from races that are still loading or failed to load, never schedules without permission, and rebuilds everything if the device timezone changed since the schedule was built.
- Calendar triggers carry wall-clock components plus an explicit IANA timezone. Reading the installed expo-notifications 0.32 iOS code (`Records.swift`): the trigger is `UNCalendarNotificationTrigger(dateMatching:repeats:)` built from a DateComponents whose calendar is ISO8601 and whose timezone is applied only if one is passed, so its meaning is **fixed at scheduling time** (it does not follow a later timezone change by itself). The app therefore rebuilds the schedule whenever the device timezone differs from the one it was built for (on launch and foreground). An earlier version of this note assumed the trigger would follow the phone's timezone; that was wrong. Behavior after a real timezone change is still unverified on a device.

## Account isolation and cleanup
- Every notification carries the athlete id; a tap is validated against the signed-in athlete and the data as it is now. A notification for another account does nothing.
- Sign-out cancels all scheduled notifications first; a lost session cancels them too; deleting the account cancels them, clears the notification preferences and rotation, and clears the unsent Signal draft. Switching accounts on a device never shows another account's schedule or draft.
- Taps: cold start and warm taps arrive as the last notification response, are deduplicated, cleared after handling, held until it is safe (signed in, races loaded, no paywall or consent sheet), and **dropped** during onboarding or when signed out.
- Signal drafts persist per athlete (one slot per account on this device), surviving leaving the screen and cold starts, and are cleared on send.

## Known limits of local scheduling (by design)
- **Content is fixed when scheduled.** Checklist changes made on this device reschedule immediately, but changes made on **another device** (or a race removed there) stay stale until this app is reopened.
- **Reminders eventually stop without reopening the app:** race reminders after about 12 weeks, between-race prompts after about 8 weeks.
- **Delivery is not guaranteed** (Focus modes, Low Power, notification settings); a prompt counts as shown when its time passes, not when it is seen.
- Milestones beyond the 12-week horizon are scheduled once the app has been opened within that window.
- Reminders follow the nearest race only; a later race gets none until the nearest is finished, removed or past, which happens at the next reconcile (launch, foreground or a change in the app), not at the moment the date passes if the app stays closed.
- A race has only a date (no time or timezone of its own); reminders follow the phone's local time.

## Development test tools (development variant only)

Settings → Developer tools → "Notification test tools" (development only). It shows live diagnostics (the real iOS authorization and its alert, lock-screen and banner settings, how many notifications iOS has pending, how many races the app has loaded for this account and how many are upcoming, the device clock and timezone) and six tests. Each test: checks the real iOS permission and names any blocker (with an Open iOS Settings shortcut); explains a missing prerequisite instead of doing nothing; asks iOS when the trigger will next fire (which proves the trigger shape is valid); schedules with a time limit; **reads iOS's pending list back** to confirm the identifier exists; and shows either an actionable error or the identifier and expected delivery time. Every step is time-bounded and the busy state always clears. Test notifications are identified `rs-test:` and normal reconciliation never cancels them.

1. **Test notification in 60 seconds**: a time-interval trigger, no race, entitlement or model call. Run this first: it proves basic local delivery.
2. **Calendar-trigger test**: the same calendar trigger real reminders use, with a standalone payload. If 1 delivers and 2 does not, the calendar trigger is the problem.
3. to 5. Race-prep weekly, seven-day and two-day: need a real upcoming race (dated today or later); otherwise they say exactly why not, with the account's counts.
6. **Between-race prompt**: the Signal payload (no race needed).

Tapping the basic or calendar test shows "Test notification tapped" (development variant only), proving tap handling. Race and prompt tests open the checklist or Signal as real ones do.

## Device test record

**2026-10-05, first attempt: failed.** The race-prep test scheduled nothing (the account had no active upcoming race; its registered races were removed) and the old tool gave no counts. The between-race prompt test was not delivered, cause never established: the old tool swallowed scheduling errors, never read iOS's pending list back and showed no authorization details. The rebuilt tools answer those questions.

**Passed on the iPhone (development build, no rebuild), reported by the owner:**

Test-tool deliveries (accelerated; see the note below):
- Basic and calendar-trigger notifications delivered, and their taps worked.
- Between-race prompts opened Signal with the matching starter, without sending a question.
- Weekly race-prep notification showed the correct countdown: **13 days** for the California race, then **6 days** for the December race after its date was edited. The countdown fix (`39f8f02`) is now device-verified for the accelerated weekly test.
- The accelerated two-day milestone delivered "Two days until Ironman december", and tapping it opened that race with Race Prep expanded.

Taps, Signal and focus:
- An empty Signal composer received the starter and the keyboard opened (**automatic keyboard focus: passed** for the starter flow; the dev-only focus line's text was not reported).
- "Keep my draft" preserved the text and dismissed the choice.
- "Add starter" appended the starter after the existing text and opened the keyboard. Nothing was sent automatically.
- Race-prep taps opened the correct race with its checklist expanded. The earlier "Hotel booked" highlight also worked after closing the app.

One race at a time:
- With two upcoming races, changing December's date to be nearer removed California's pending reminders; only December's two-day reminder remained. Selection by nearest date and cancellation of obsolete reminders on a date edit are **device-verified**.

**Accelerated test delivery is not the same as a real scheduled delivery.** The test tools schedule a notification about a minute ahead (the weekly and milestone tests preview the real wording and countdown at a near time). They prove trigger shape, delivery, tap routing and wording. They do **not** prove that a real weekly (Sunday, default 4 p.m.) or real seven-day or two-day milestone, scheduled by reconciliation for its actual date and time, is delivered at that time. That has not been observed.

**Still pending (not passed, not tested):**
- Real scheduled deliveries at normal times: a weekly reminder at its set time, and real seven-day and two-day milestones on their dates. The seven-day accelerated test was not reported either.
- Timezone changes: reminders rebuilt at the preferred hour after the phone's timezone changes.
- Permission changes: deny then enable via iOS Settings, and revoke after enabling, then reopen.
- Account cleanup: sign-out and account deletion leave nothing pending; a different account sees nothing from the first.
- Invitation timing: appears on the second fresh launch with no upcoming race, never over onboarding, the initial paywall or the consent sheet.
- Larger text sizes in Settings, the invitation sheet and the starter offer.
- Single-race focus when the nearest race's checklist is completed, the race is removed, or its date passes (only the date-edit case was exercised on the device).
- Not separately reported: starter delivery from the lock screen, from another app and with the app closed; the checklist toggle and delete reschedule cases.

**The notification feature is not release-ready.** The items above are release blockers until they are verified (or consciously accepted and recorded as such).

## Countdown wording: the "21 days" finding (2026-10-05)

The development weekly test said "21 days until [race]" while the race screen showed 14. Cause: the **test tool** passed a hard-coded 21 to the weekly wording builder, a leftover placeholder, not a calculation. It was not a real-reminder bug: the planner already computes each weekly reminder's countdown from **its own delivery date** (`calendarDaysBetween(slot day, race date)`), so a reminder delivered on a Sunday counts the days from that Sunday, not from the day it was scheduled. Fixed in the tool: the weekly test now counts the days from the delivery date of the test notification (the next whole minute at least a minute ahead, so it is correct even across midnight), refuses to schedule on race day (as real reminders do), and reports the number it used. The seven-day and two-day tests preview the real milestone wording, which is by definition 7 or 2 days before the race; their result now says when the real reminder is delivered and how many days away the race is today. New tests pin the countdown for every weekly slot (for example, a race 74 days away today is 70 days away for a reminder delivered four days from now) and show the wording is fixed for its delivery date. **Device-verified (accelerated weekly test):** 13 days for the California race and 6 days for the edited December race, matching the race screen. A real Sunday delivery has not yet been observed.

## Full re-test list (development build, no rebuild expected)

1. Reload the app from Metro. Open Settings → Developer tools and find "Notification test tools". Note the diagnostics lines: permission should read `granted` with alerts `on`.
2. Tap **Test notification in 60 seconds**. Expect a green line with an identifier starting `rs-test:` and a delivery time. Lock the phone (or leave the app) and wait about a minute. Expect a banner "RaceSignal test". Tap it: the app opens and shows "Test notification tapped".
3. If nothing arrives, check Notification Center (swipe down) and Focus: a Focus can deliver silently. Tap **Show pending notifications** and confirm the identifier is listed.
4. Tap **Calendar-trigger test**. Same checks. Compare with step 2.
5. Tap **Between-race prompt**: wait, tap the banner: Signal opens with the starter in an editable composer, nothing sent.
6. Save an upcoming race (a date in the future), then run **Race-prep weekly** and the milestone tests; tapping opens the race with the checklist expanded and an item highlighted.
7. In Settings → Notifications (under Preferences), with a type switched on, check the status line under the switch (reminders scheduled and the next one).

If step 1 reports permission or alert problems, it names the iOS Settings path. If it reports "iOS did not accept the notification", paste the message: it contains the native error. If the native module is reported unavailable, a rebuild would be needed; nothing so far indicates that.

## Verified automatically (Jest)
Planner (defaults, suppression, milestone preservation, 12-week horizon, OS cap, today-or-later eligibility, completed checklists, sport relevance, uncertain sport, copy, one-race-at-a-time focus with stable ties, moving focus on completion, removal, past date and date edits, no combined milestones, between-race pause, 12-month retrospective rule, stability), rotation (no replacement, cycle boundary, persisted assignments, advance, re-seating, pause and resume, eligibility changes), payload validation and routing, reconcile diffing against a fake scheduler, the provider (opt-in and permission, denied, revoked permission, checklist and race changes, loading data, timezone rebuild, account isolation, session loss, launch counting, one-time invitation, rotation persistence), tap routing (once, cleared, wrong account, onboarding, held until safe), the invitation sheet (gating, latching, copy, choices, denied), the Settings section, checklist expand and highlight, Signal drafts and starters (never overwritten, never sent, per athlete, cold start, cleared on send, exhausted paywall unchanged), and sign-out and deletion cleanup.

## Needs a device (open items; items 2 to 4 and part of 6 passed in accelerated tests, see Device test record)
1. Enable each type: the iOS prompt appears only then; deny, then enable via iOS Settings; revoke later and reopen.
2. Test tools: a banner appears; tapping it (app foreground, background, and killed) opens the right screen exactly once.
3. Highlight: the tapped checklist item is expanded, highlighted and scrolled into view.
4. Starter: empty composer fills and the keyboard focuses; with a saved draft the draft is kept and the offer appears; nothing is sent; the free balance is unchanged.
5. **Timezone**: schedule, change the phone's timezone, reopen the app, and confirm the reminders were rebuilt at 4 p.m. in the new timezone ("Show pending notifications" lists the new times).
6. Checklist toggles, race edit, delete and completion reschedule; with two upcoming races only the nearest has reminders (see the targeted re-test).
7. Sign-out and account deletion leave nothing pending; signing in as a different account shows nothing from the first.
8. The invitation appears on the second fresh launch with no upcoming race and never over onboarding, the initial paywall or the consent sheet.
9. Larger text sizes in Settings, the invitation sheet and the starter offer.
10. Background delivery of a real weekly slot (set the weekly time a few minutes ahead).

## Remaining re-test (development build)

Done on the device (see Device test record): countdown, keyboard focus, Keep my draft, Add starter, single-race selection and date-edit cancellation, accelerated weekly and two-day delivery and taps. Still to do:

1. **Real weekly delivery.** Set the weekly time a few minutes ahead in Settings, leave the app, and confirm the reminder arrives at that time with the countdown for its delivery date (not just the accelerated test). Do the same for a real milestone if a race date allows (two or seven days out).
2. **Single-race focus.** With two upcoming races, mark the nearest race's checklist complete (pending lines for it disappear; the later race must not be used). Then delete the nearest race: the later race becomes the focus.
3. **Timezone.** Schedule, change the phone's timezone, reopen the app, and check that "Show pending notifications" lists the new times.
4. **Permission, account and invitation**: items 1, 7 and 8 above. **Larger text**: item 9 above.
5. Switch off Race-prep reminders, then on again: the status line under the switch shows the count and next reminder.
