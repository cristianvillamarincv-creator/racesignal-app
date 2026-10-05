# Notifications (release 1.1)

Two optional notification types, both **off by default**, scheduled **locally on the device** (no server, no push token, no backend change, no production change). Built on `expo-notifications` (already in the native fingerprint of the existing development build 2; no rebuild is needed to try it there).

## What they do

**Race-prep reminders** (offered after saving an upcoming race: "Stay ahead of race prep", Enable reminders / Not now)
- A weekly reminder, Sunday 4 p.m. local time by default (editable), about ONE unchecked relevant checklist item of the nearest eligible race, plus a **seven-day** and a **two-day** milestone at 4 p.m. (time editable). A weekly reminder within 48 hours of any milestone is suppressed; both milestones are always kept. No weekly reminder on or after race day.
- Only incomplete races dated **today or later** count (a past-dated "registered" race is ignored). One weekly reminder in total, for the nearest race that still has open relevant items; a completed checklist gets nothing.
- Relevance: the checklist is one shared 30-item template and is never changed. For notifications only, a running race excludes swim and bike items, a cycling race swim and run items, and so on (`lib/notifications/relevance.ts`). An unclassifiable sport ("other") is "uncertain": generic wording only ("You have unfinished race-prep items."), no invented task.
- Same-day milestones for several races combine into ONE notification that opens the Races list (no staggering).
- Copy (body): "21 days until [race]. Is your transportation sorted?" (a specific question only for an item that is unchecked); "One week until [race]. Have you checked your gear?" (gear unchecked; otherwise a specific question); "Two days until [race]. You have unfinished prep items."
- Tap: opens the race and expands the checklist, highlighting the item (scrolled into view) when it is still unchecked; a checked item opens the checklist with no highlight; a deleted or completed race opens the Races list.

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
- A race has only a date (no time or timezone of its own); reminders follow the phone's local time.

## Development test tools (development variant only)

Settings → "Notification test tools (development only)". It shows live diagnostics (the real iOS authorization and its alert, lock-screen and banner settings, how many notifications iOS has pending, how many races the app has loaded for this account and how many are upcoming, the device clock and timezone) and six tests. Each test: checks the real iOS permission and names any blocker (with an Open iOS Settings shortcut); explains a missing prerequisite instead of doing nothing; asks iOS when the trigger will next fire (which proves the trigger shape is valid); schedules with a time limit; **reads iOS's pending list back** to confirm the identifier exists; and shows either an actionable error or the identifier and expected delivery time. Every step is time-bounded and the busy state always clears. Test notifications are identified `rs-test:` and normal reconciliation never cancels them.

1. **Test notification in 60 seconds**: a time-interval trigger, no race, entitlement or model call. Run this first: it proves basic local delivery.
2. **Calendar-trigger test**: the same calendar trigger real reminders use, with a standalone payload. If 1 delivers and 2 does not, the calendar trigger is the problem.
3. to 5. Race-prep weekly, seven-day and two-day: need a real upcoming race (dated today or later); otherwise they say exactly why not, with the account's counts.
6. **Between-race prompt**: the Signal payload (no race needed).

Tapping the basic or calendar test shows "Test notification tapped" (development variant only), proving tap handling. Race and prompt tests open the checklist or Signal as real ones do.

## Device test record (2026-10-05)

- **Race-prep test: FAILED, nothing was scheduled.** The account used for the test (`cristian.flipd@gmail.com`) has no active upcoming race: its two registered races ("Ironman cali" 2026-10-18 and "Ironman dec" 2026-12-20) are marked removed, so the app correctly had none to use. The old tool said "Save an upcoming race first" and gave no counts.
- **Between-race prompt test: FAILED, not delivered, cause not yet established.** The old tool swallowed scheduling errors (a rejected call showed nothing), never read iOS's pending list back, and showed no authorization details, so it could not say whether the notification was refused, dropped, silenced or simply not delivered. The tools above were built to answer that.
- Settings showed both switches on with no confirmation of anything scheduled. Settings now reads iOS's pending list back and shows the count and the next reminder (or why there are none).
- Both delivery tests remain **pending**: neither has passed.

## Re-test on the iPhone (development build, no rebuild expected)

1. Reload the app from Metro. Open Settings → scroll to "Notification test tools". Note the diagnostics lines: permission should read `granted` with alerts `on`.
2. Tap **Test notification in 60 seconds**. Expect a green line with an identifier starting `rs-test:` and a delivery time. Lock the phone (or leave the app) and wait about a minute. Expect a banner "RaceSignal test". Tap it: the app opens and shows "Test notification tapped".
3. If nothing arrives, check Notification Center (swipe down) and Focus: a Focus can deliver silently. Tap **Show pending notifications** and confirm the identifier is listed.
4. Tap **Calendar-trigger test**. Same checks. Compare with step 2.
5. Tap **Between-race prompt**: wait, tap the banner: Signal opens with the starter in an editable composer, nothing sent.
6. Save an upcoming race (a date in the future), then run **Race-prep weekly** and the milestone tests; tapping opens the race with the checklist expanded and an item highlighted.
7. In Settings → Notifications, with a type switched on, check the status line under the switch (reminders scheduled and the next one).

If step 1 reports permission or alert problems, it names the iOS Settings path. If it reports "iOS did not accept the notification", paste the message: it contains the native error. If the native module is reported unavailable, a rebuild would be needed; nothing so far indicates that.

## Verified automatically (Jest)
Planner (defaults, suppression, milestone preservation, 12-week horizon, OS cap, today-or-later eligibility, completed checklists, sport relevance, uncertain sport, copy, multi-race, combined milestones, between-race pause, 12-month retrospective rule, stability), rotation (no replacement, cycle boundary, persisted assignments, advance, re-seating, pause and resume, eligibility changes), payload validation and routing, reconcile diffing against a fake scheduler, the provider (opt-in and permission, denied, revoked permission, checklist and race changes, loading data, timezone rebuild, account isolation, session loss, launch counting, one-time invitation, rotation persistence), tap routing (once, cleared, wrong account, onboarding, held until safe), the invitation sheet (gating, latching, copy, choices, denied), the Settings section, checklist expand and highlight, Signal drafts and starters (never overwritten, never sent, per athlete, cold start, cleared on send, exhausted paywall unchanged), and sign-out and deletion cleanup.

## Needs a device (development build 2, not yet done)
1. Enable each type: the iOS prompt appears only then; deny, then enable via iOS Settings; revoke later and reopen.
2. Test tools: a banner appears; tapping it (app foreground, background, and killed) opens the right screen exactly once.
3. Highlight: the tapped checklist item is expanded, highlighted and scrolled into view.
4. Starter: empty composer fills and the keyboard focuses; with a saved draft the draft is kept and the offer appears; nothing is sent; the free balance is unchanged.
5. **Timezone**: schedule, change the phone's timezone, reopen the app, and confirm the reminders were rebuilt at 4 p.m. in the new timezone ("Show pending notifications" lists the new times).
6. Checklist toggles, race edit, delete and completion reschedule; a second upcoming race changes the weekly subject; same-day milestones combine.
7. Sign-out and account deletion leave nothing pending; signing in as a different account shows nothing from the first.
8. The invitation appears on the second fresh launch with no upcoming race and never over onboarding, the initial paywall or the consent sheet.
9. Larger text sizes in Settings, the invitation sheet and the starter offer.
10. Background delivery of a real weekly slot (set the weekly time a few minutes ahead).
