# Race prediction in Signal (release 1.1)

Signal can give a **historical reference range** for an upcoming race: the fastest and slowest recorded time among the athlete's own recent results at the same sport and the same standard distance. It is not a validated forecast. There is no center, no padding, no confidence score and no probability, and nothing promises that a future finish will fall inside it. It asks no extra model call: it is a normal counted ask.

## Status

Implemented on `release-1.1` and deployed to the **development** project only. Not deployed to production. Not yet device-tested. No paid model evaluation has been run, so the example answers below are **editorial**: they show the intended behavior and have not been checked against the real model.

## The one calculation

`supabase/functions/signal/racePrediction.ts` is the source of truth. `mobile/src/lib/racePrediction.ts` is a byte-identical mirror, used only to decide which suggestions to show. The file has no imports; `mobile/__tests__/racePredictionParity.test.ts` fails if the copies differ. After editing the supabase copy run `cp supabase/functions/signal/racePrediction.ts mobile/src/lib/racePrediction.ts`.

Rules, applied there and nowhere else:

- **Comparable result:** completed, with a recorded finish time (a whole number of seconds above zero), the same sport and the same standard distance as the target, and a date that is not in the future.
- **Distance** comes only from the distance label, matched as a whole label (case, spacing and punctuation normalized) against a table scoped by sport: running (5K, 10K, half marathon, marathon, with common spellings such as 21.1K and 42.2 km) and triathlon (Olympic, 70.3, 140.6 / full distance). The event name is never read. A bare "Ironman" and every "Sprint" label are deliberately unmapped (a sprint distance varies by event and a result carries no distance that could establish comparability; "Ironman" names a brand). Other sports and custom labels have no standard distance and get no estimated time or range. Signal can still quote the athlete's recorded results at those distances when asked; only an estimate for the upcoming race is withheld.
- **Recent** means within 24 calendar months before today, inclusive. A year-only date is recent only when the whole year (from January 1) is inside the window; otherwise it is an older reference described by its year. Up to the five most recent recent results are used.
- **Range:** two or more recent results give the fastest and slowest of the results used, the races behind them, and a precomputed difference ("22 seconds"). **One recent result** is a dated reference only. **Older results** (up to three) are references labelled as older, never blended into a range. **None** means no estimate, and no use of other distances.
- **Considering and registered races** receive the same range. Proactive suggestions are limited to **registered** races (below).
- **Duplicates:** two records are counted once only when the normalized event name, date and finish time are all identical (disclosed as "identical records counted once"). Different events with the same date and time are never merged, and a same-name, same-date record with a different time is kept.
- **Unusual results** are kept as recorded. Signal is told not to guess a cause or call a result an outlier.

### What is and is not filtered (checked against the import code)

Rows with no recorded finish time are unusable: the discovery normalizer sets `finishSeconds` only when the provider returns a numeric overall time, the app stores a null `finish_seconds` otherwise, and manual entry allows a completed race without a time. **There is no DNF or DNS detection.** If a provider returned a numeric time for a participant who did not finish, it would be indistinguishable from a finish. The fixtures contain no such case and real provider payloads were not inspected (that would mean reading other athletes' data). Signal's wording therefore speaks of "results" and "times", never of confirmed finishes. Open item: check a real DNF payload from the provider before relying on this for athletes who may have them.

## Server derivation and trust

`signal` loads the signed-in athlete's own confirmed races (only the columns the calculation needs, never ranks, splits or notes), runs the shared calculation with the server's UTC date, and puts the result in the prompt as the RACE HISTORY CHECK section. The request carries no range and the function never reads one. A source-level test pins that. The seed race, whose ownership is already checked, is always included even beyond the nearest-five cap.

If the races cannot be loaded, the section says the history could not be checked and tells the model to give no range; Signal then says it could not check the race history just now. That is a different message from "no comparable result on file", and there is no fallback to anything client-supplied. The ask itself is not failed or refunded for this.

The rest of the context is still client-built (unchanged), so the model can see raw races; the prompt forbids deriving a range from them. That is a prompt-level guard, verified only by real-model testing that has not happened yet.

## Prompt changes

Removed: the instruction to give a "provisional range" and state confidence, the 2-4 pieces of evidence list, and the cited-benchmark wording. Added rules: lead with the range or reference, name the supporting races, give one short limitation (said once per conversation), use only the supplied numbers, never use confidence/interval/probability language, never comment on there being only one result, and never expose how results were chosen, never build a time from another distance, and the could-not-check behavior. Model, quotas and the output cap (700 tokens) are unchanged.

## Suggestions

A next-race question is suggested proactively (Signal tab "Your next race" module, the race screen's Signal module, and the suggested chips) only for a **registered** race dated today or later with **at least two recent comparable results**, using the mirrored rule and the phone's local date. A custom question is never gated. Near the date boundary the phone (local date) and server (UTC date) can differ by a day; the server is authoritative for answers.

## Production rollout (deferred to the release checkpoint; nothing deployed to production)

1. **Server before app.** Deploy the `signal` function to production first. The request and response shapes are unchanged and no field is required, so Build 18 keeps working.
2. **Behavior change for Build 18 users the moment the server deploys.** Build 18 still shows its old loose suggestion ("What does my history suggest..." for any upcoming race with any history) and has no app-side gating. Those questions now get the new behavior: a historical range, a single dated reference, older references, "no comparable result", or "could not check". Signal no longer invents a provisional range or states a confidence for them. This changes production Signal answers without an app update, so it is a product decision at the checkpoint (alternative: ship the server with the 1.1 app).
3. **Then release the 1.1 app.** A 1.1 app against the old production server would show the new gated suggestions but still get invented ranges for custom questions, so the server must be live first.
4. Production deploys use the repo's production link (not `supabase/dev/dev-supabase.sh`), after the release checkpoint's explicit go-ahead.

## Example answers (editorial, not yet tested against the real model)

Assuming today is Oct 5, 2026 and synthetic races.

- **Two results:** "Your two recent Olympic results ran from 2:41:55 (Riverside, Aug 17, 2026) to 2:48:20 (Harbor, Jul 6, 2025). That's how those two races went; it doesn't account for training, the course or the weather, so Lakefront can land outside it."
- **Nearly identical:** "Your two recent half marathons were 1:44:09 (Spring Half, Apr 12, 2026) and 1:44:31 (Harbor Half, Nov 9, 2025), 22 seconds apart. Two races that close say little about the next course or conditions, so it can land outside that."
- **One result:** "Your one recent 10K on file is the Spring 10K on Mar 8, 2026, in 47:12. That's the reference I have for that distance."
- **Older history:** "Your last Olympic triathlon was Riverside on Aug 17, 2023, in 2:52:40, over 3 years ago. That's an older result, so I don't treat it as an estimate for Lakefront."
- **No comparable history:** "I don't have a half marathon result on file, and I don't turn your 10K times into a half marathon time. A recent half marathon result would let me give you a range."
- **Could not check:** "I couldn't check your race history just now. Try again in a moment."

The "22 seconds" figure is supplied by the calculation; Signal is told not to work out any other difference.

## Checks (synthetic only)

Deno (`deno test --allow-read=. supabase/functions/signal/`): calculation (windows and edges, year-only dates, cap of five, duplicates, unusable data, targets, tie-breaks, distance table, eligibility), loader (columns, filters, mapping, unavailable vs empty, seed beyond the cap, no client range), prompt (removed and added rules, rendering of every status). Jest: mirror parity and behavior, suggestion gating, both entry points with synthetic races. A mutation check (eligibility forced true) fails 14 tests.

## Device test (development build, `cristian.flipd@gmail.com` in racesignal-dev)

Synthetic fixtures added to the dev account only (existing races, profile, conversations, usage and RevenueCat state untouched; 7 existing races, 10 now):

| Race | Status | Date | Sport / label | Time |
|---|---|---|---|---|
| Prediction Test Riverside Olympic | completed | 2026-08-16 | triathlon / Olympic | 2:41:55 (9715 s) |
| Prediction Test Harbor Olympic | completed | 2025-07-13 | triathlon / Olympic | 2:48:20 (10100 s) |
| Prediction Test Olympic | registered | 2027-06-13 | triathlon / Olympic | none |

The account had no other Olympic results, so the range is exactly these two. Its other upcoming races (Ironman december, Ironman California) have no distance label, so they get no estimate. They are nearer than the test race, so the Signal tab's "Your next race" module does not show the test race: start from the race screen.

The app has no control for setting a race to "considering"; the status for step 3 is changed in the development database.

1. Open the upcoming test race, open its Signal module, ask "What does my history suggest for this race?". Expect: 2:41:55 to 2:48:20, naming Riverside (Aug 16, 2026, 2:41:55) and Harbor (Jul 13, 2025, 2:48:20), one short limitation.
2. Same thread: "Which result is the faster end based on?". Expect: Riverside, 2:41:55, without repeating the whole limitation.
3. After the test race is set to considering (force-quit and reopen so the app reloads races): no suggestion module on the race screen and no suggested question in Signal for it; a custom question about its finish-time reference gets the same range.
