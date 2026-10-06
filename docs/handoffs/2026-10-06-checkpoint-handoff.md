# RaceSignal 1.1 development checkpoint handoff (2026-10-06)

Branch `release-1.1`. Development only: nothing has been deployed to production, built for production, version-bumped or submitted. The release is **not ready**; see `docs/release-1.1-qa-status.md` for the full passed, pending and blocked lists.

## Completed scope (all on `release-1.1`, pushed)
- **Signal:** conversation layout, supported suggestions, brief missing-evidence answers, a read-only `usage` action with client refresh.
- **Premium awareness:** allowance copy on the Signal tab, conversation and Settings; exhausted-send paywall hand-off that preserves the draft and attachment; free 3 lifetime asks, Premium 40 per UTC month.
- **Authentication:** Sign in with Apple, Google through Supabase browser OAuth, connected accounts, Welcome-back review-or-skip (development only; production flags off).
- **Local notifications:** race-prep (weekly, seven-day, two-day, one race at a time) and between-race prompts; Settings controls, an invitation, tap routing, a development test-tool screen; reliable composer focus for starters.
- **Race prediction:** one deterministic calculation (`supabase/functions/signal/racePrediction.ts`, mirrored byte for byte in `mobile/src/lib/racePrediction.ts`, with a parity test) gives a historical reference range from up to five recent same-sport, same-distance results (24 months). The `signal` function derives it from the athlete's stored races and never trusts a client range. The old invented-range prompt is gone. Proactive suggestions need a registered race plus two recent comparable results; custom questions are never gated. Documented in `docs/race-prediction.md`.
- **Deferred, recorded only:** Find a race, screenshot or wallet-pass import, next-season exploration (`docs/future-ideas.md`). The manual upcoming-race flow is unchanged.

Latest commits: `9a26236` (prediction wording and header corrections), `088a1f5` (prediction device QA); the checkpoint docs commit follows them.

## Known limitations
- No DNF/DNS detection in the race import; a non-finisher with a recorded time would count as a result.
- Race prediction is a historical range, not a validated forecast. Only the two registered/considering two-result cases have run on the real model on a device.
- Only running and triathlon standard distances are recognized for prediction; "Sprint" and a bare "Ironman" are deliberately unmapped.
- Notifications are local only; a timezone change rebuilds the schedule when the app is next opened; real scheduled-time delivery has not been observed.
- Several QA areas are untested on a device (listed in the QA status doc), and no production setup has started.
- The context Signal receives is still client-built apart from the prediction range.

## Next steps
1. The owner checks that the Signal module has returned on Prediction Test Olympic (restored to `registered`).
2. One more task to be scoped before TestFlight (to be given).
3. Work through the pending device checks and owner decisions in the QA status doc.
4. At the release checkpoint, and only on an explicit instruction: the ordered production setup in `docs/release-1.1-checklist.md` (signal function to production before the app), a version bump, a production build and TestFlight QA with throwaway accounts.

## Working notes
- Development backend only through `supabase/dev/dev-supabase.sh` (the repo's Supabase link points at production). Dev project `sjmixferxnkwbzkcofnp`; production `ibdqeagutcjmbbjnquzv` (`signal` v16, `race-discovery` v8, `delete-account` v2, unchanged).
- Checks: `cd mobile && npx tsc --noEmit && npx eslint . && npx jest`; `deno test --allow-read=. supabase/functions/signal/`.
- Device testing uses the installed RaceSignal Dev build and Metro (`.claude/launch.json` is untracked and has LAN and tunnel configurations; tunnel mode works when the phone cannot reach the Mac's LAN).
- Dev-account fixtures: three labelled "Prediction Test ..." races in `cristian.flipd@gmail.com`. They were added and changed with one-off SQL through the Management API, not a committed script.
- Rules that have held throughout: development first, production unchanged, no native build, account reset or paid model call without explicit authorization, commit and push only on instruction, and QA recorded only as the owner confirms it.
