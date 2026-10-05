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
- Settings → Notifications: a separate switch per type, editable weekly day and time, editable race-milestone time.
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

Settings → "Notification test tools (development only)". It shows live diagnostics (the real iOS authorization and its alert, lock-screen and banner settings, how many notifications iOS has pending, how many races the app has loaded for this account and how many are upcoming, the device clock and timezone) and six tests. Each test: checks the real iOS permission and names any blocker (with an Open iOS Settings shortcut); explains a missing prerequisite instead of doing nothing; asks iOS when the trigger will next fire (which proves the trigger shape is valid); schedules with a time limit; **reads iOS's pending list back** to confirm the identifier exists; and shows either an actionable error or the identifier and expected delivery time. Every step is time-bounded and the busy state always clears. Test notifications are identified `rs-test:` and normal reconciliation never cancels them.

1. **Test notification in 60 seconds**: a time-interval trigger, no race, entitlement or model call. Run this first: it proves basic local delivery.
2. **Calendar-trigger test**: the same calendar trigger real reminders use, with a standalone payload. If 1 delivers and 2 does not, the calendar trigger is the problem.
3. to 5. Race-prep weekly, seven-day and two-day: need a real upcoming race (dated today or later); otherwise they say exactly why not, with the account's counts.
6. **Between-race prompt**: the Signal payload (no race needed).

Tapping the basic or calendar test shows "Test notification tapped" (development variant only), proving tap handling. Race and prompt tests open the checklist or Signal as real ones do.

## Device test record

**2026-10-05, first attempt: failed.** The race-prep test scheduled nothing (the account had no active upcoming race; its registered races were removed) and the old tool gave no counts. The between-race prompt test was not delivered, cause never established: the old tool swallowed scheduling errors, never read iOS's pending list back and showed no authorization details. The rebuilt tools answer those questions.

**Passed on the iPhone (development build, no rebuild):**
- Basic notification delivery and tap handling.
- Calendar-trigger delivery and tap handling.
- A between-race notification opens Signal with the matching editable starter.
- An existing draft (a swimming draft) remains intact, with the starter choice shown.
- A race-prep notification opens the correct race, expands its checklist and highlights "Hotel booked". The same flow works after swiping the app closed.

**Still open (not passed):**
- **Automatic keyboard focus.** A screenshot of the Signal screen showed the starter but no keyboard. The earlier code focused the composer from a single 400 ms timer. That can silently do nothing on iOS: a focus is ignored while the app is not yet active (a notification tap launches or resumes the app while it is inactive) and while the navigation transition is still running. It is now handled by `useInputFocusRequest`, which waits for the screen to be focused, the transition to finish and the app to be ACTIVE, then focuses, checks `isFocused()`, and retries up to four more times (and again whenever the app becomes active) until the input really holds focus. The development build also shows a line under the Signal composer ("Keyboard focus (development): focused / NOT focused after N attempts, app active") after a starter, so a device test reads the result from the input rather than from a timer. Unit tests cover the waiting, retry and give-up behavior; **whether the iOS keyboard actually opens is unconfirmed until it is tried on the iPhone.**
- "Keep my draft" dismissal and "Add starter" behavior have each passed in automated tests but have not been separately confirmed on the device.
- Milestone delivery (seven-day, two-day), timezone changes, account cleanup (sign-out and deletion), permission changes, invitation timing and larger text sizes.
- **The countdown fix is not device-verified.** The latest closed-app weekly test still showed 21 days while the race screen showed 14. It was scheduled at 11:15:50, about when the fix (`39f8f02`) shipped, so it may have been scheduled by the earlier bundle (a notification keeps the text it was scheduled with). Re-test with a fresh reload; see below.
- **Single-race focus is not device-verified** (new, below).

## Countdown wording: the "21 days" finding (2026-10-05)

The development weekly test said "21 days until [race]" while the race screen showed 14. Cause: the **test tool** passed a hard-coded 21 to the weekly wording builder, a leftover placeholder, not a calculation. It was not a real-reminder bug: the planner already computes each weekly reminder's countdown from **its own delivery date** (`calendarDaysBetween(slot day, race date)`), so a reminder delivered on a Sunday counts the days from that Sunday, not from the day it was scheduled. Fixed in the tool: the weekly test now counts the days from the delivery date of the test notification (the next whole minute at least a minute ahead, so it is correct even across midnight), refuses to schedule on race day (as real reminders do), and reports the number it used. The seven-day and two-day tests preview the real milestone wording, which is by definition 7 or 2 days before the race; their result now says when the real reminder is delivered and how many days away the race is today. New tests pin the countdown for every weekly slot (for example, a race 74 days away today is 70 days away for a reminder delivered four days from now) and show the wording is fixed for its delivery date.

## Full re-test list (development build, no rebuild expected)

1. Reload the app from Metro. Open Settings → scroll to "Notification test tools". Note the diagnostics lines: permission should read `granted` with alerts `on`.
2. Tap **Test notification in 60 seconds**. Expect a green line with an identifier starting `rs-test:` and a delivery time. Lock the phone (or leave the app) and wait about a minute. Expect a banner "RaceSignal test". Tap it: the app opens and shows "Test notification tapped".
3. If nothing arrives, check Notification Center (swipe down) and Focus: a Focus can deliver silently. Tap **Show pending notifications** and confirm the identifier is listed.
4. Tap **Calendar-trigger test**. Same checks. Compare with step 2.
5. Tap **Between-race prompt**: wait, tap the banner: Signal opens with the starter in an editable composer, nothing sent.
6. Save an upcoming race (a date in the future), then run **Race-prep weekly** and the milestone tests; tapping opens the race with the checklist expanded and an item highlighted.
7. In Settings → Notifications, with a type switched on, check the status line under the switch (reminders scheduled and the next one).

If step 1 reports permission or alert problems, it names the iOS Settings path. If it reports "iOS did not accept the notification", paste the message: it contains the native error. If the native module is reported unavailable, a rebuild would be needed; nothing so far indicates that.

## Verified automatically (Jest)
Planner (defaults, suppression, milestone preservation, 12-week horizon, OS cap, today-or-later eligibility, completed checklists, sport relevance, uncertain sport, copy, one-race-at-a-time focus with stable ties, moving focus on completion, removal, past date and date edits, no combined milestones, between-race pause, 12-month retrospective rule, stability), rotation (no replacement, cycle boundary, persisted assignments, advance, re-seating, pause and resume, eligibility changes), payload validation and routing, reconcile diffing against a fake scheduler, the provider (opt-in and permission, denied, revoked permission, checklist and race changes, loading data, timezone rebuild, account isolation, session loss, launch counting, one-time invitation, rotation persistence), tap routing (once, cleared, wrong account, onboarding, held until safe), the invitation sheet (gating, latching, copy, choices, denied), the Settings section, checklist expand and highlight, Signal drafts and starters (never overwritten, never sent, per athlete, cold start, cleared on send, exhausted paywall unchanged), and sign-out and deletion cleanup.

## Needs a device (development build 2, not yet done)
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

## Targeted re-test (after `Reload` in the app)

1. **Countdown.** In Settings → test tools run **Race-prep weekly in ~1 min** with your nearest race. The result line states "The countdown is N days"; the notification body must say the same N, and N must equal the days from the delivery day to the race (the race screen shows days from today, so they can differ by the days between today and delivery only if delivery is on another day; with a one-minute test they match). Do not reuse a notification scheduled before the reload.
2. **Keyboard focus.** Tap a between-race prompt (test tool or banner) from the lock screen, from another app, and with the app closed. In Signal, with an empty composer, the starter should appear and the keyboard should open. Read the development line under the composer: "focused after N attempts" is a pass; "NOT focused" or no keyboard is a fail (note the attempts and app state it shows). Then, with a saved draft, tap **Add starter** and confirm the keyboard opens and the starter is added after your text; separately tap **Keep my draft** and confirm the draft is unchanged.
3. **One race at a time.** Save two upcoming races. In Settings → test tools tap **Show pending notifications**: every race-prep line must mention the nearer race only. Edit the farther race's date to be nearer: after reopening Settings (or returning to the app) the pending list should switch to that race and the old lines disappear. Mark the nearest race's checklist complete: pending race-prep lines for it disappear and the later race is NOT used.
4. Switch off Race-prep reminders, then on again: the status line under the switch shows the count and next reminder.
