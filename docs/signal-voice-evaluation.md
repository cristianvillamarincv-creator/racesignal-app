# Signal voice (P0 #2): evaluation and results

Scope: the system prompt's voice (`supabase/functions/signal/systemPrompt.ts`). Not changed: the model, the allowances, the chat UI, retention, race prediction. Deployed to the **development** Supabase project only; production `signal` is untouched (v16).

## Method

- Fixed synthetic fixtures (`supabase/dev/seed-signal-eval.mjs`): a rich athlete (4 triathlons, two 70.3s, two 10Ks, a half marathon, an upcoming IRONMAN) and a sparse athlete (one 5K). The answer key: Coastal 70.3 (2025-09-14) 5:09:40 -> Ridgeline 70.3 (2026-06-14) 4:58:50, **10:50 faster** (bike 5:10, run 4:30, swim 0:50, T1 0:10, T2 0:10); Riverside 10K 46:10 (2024-04-20) -> 44:35 (2026-04-19), **1:35 faster**; one half marathon (2025-10-05, 1:39:20); one Olympic (2025-07-12); no training, nutrition, power, or heart-rate data.
- Eight cases through the **real deployed function**: race comparison (seed Ridgeline: "How does this compare with my other 70.3?"), year over year, strongest discipline, screenshot analysis (a generated ride-summary image with known numbers), sparse data, an unsupported claim (training volume and nutrition), a short factual question, and a two-turn follow-up. Baseline = the old prompt (identical to production's); revised = the new one. Replies and mechanical metrics are in `mobile/scripts/signal-eval/fixtures/voice-baseline.json` and `voice-final.json`. Judged by reading each reply against the answer key for factual correctness, specificity, naturalness, relevance, and completeness; the mechanical metrics only flag voice problems.
- Bounded: 5 full or partial iterations, 40-ish live calls on synthetic dev accounts.

## What changed in the prompt

The forced four-part answer structure (direct answer, so-what, confidence, "what would improve") and the 100-250 word target were replaced by a voice section: answer in the first sentence, be concrete (race, year, split, supplied comparison), about 80-150 words for ordinary analysis (a sentence or two for simple questions, longer on request), short paragraphs with no headings or repeated template, no filler or stock phrases or closing recaps, rare em dashes, fact and interpretation kept apart in plain words, a takeaway or follow-up question only when it adds something, and four short tone examples about a made-up athlete. Every factual safeguard is kept (precomputed numbers, percentile direction, distance comparability, field-strength claims, predictions without invented benchmarks, plain text, screenshot grounding with the "From your uploaded evidence" section, now placed after the answer). Rules added because the baseline showed the failure: rank by absolute time and list gains largest first, count before claiming a count, use the dates in the context, no cross-distance split comparisons or "pace" that is not listed, no per-leg ranking claims. One app-side fact was added in the prompt formatter: for each other race, the legs are **pre-ranked** against the seed (largest absolute difference first, finish excluded), because the model kept naming the wrong largest gain (4:30 over 5:10) when asked to rank deltas itself.

## Results (same 9 turns, baseline vs final)

| | Baseline | Final |
|---|---|---|
| Mean words per reply | 198 (max 257) | 125 (max 190) |
| Em dashes (total) | 28 | 15 |
| Stock phrases / headings | 0 / 0 | 0 / 0 |
| Failures | 0 | 0 |
| Mean output tokens per ask | 387 (max 506) | 266 (max 405) |
| Mean input tokens per ask | 5,664 | 6,802 |

**Truncation:** the existing 700-token output cap was never reached (baseline max 506, final max 405), so it is unchanged. **Cost:** output tokens per ask fell about 31%, input tokens rose about 20% (the voice section and examples add roughly 3,700 characters to the system prompt). If output is priced around five times input (assumption, not confirmed from the account), the net is a few percent more per ask.

## Representative answers

**Race comparison.** Fixture facts above. Baseline (208 words): "You were faster across the board at Ridgeline than at Coastal, and the run is where the gap really opened up." That is wrong (the bike gained the most) and it then explains the bike as the biggest chunk. Final (141 words): "Ridgeline 70.3 (this race, June 2026) was faster across the board than Coastal 70.3 (September 2025), 4:58:50 vs 5:09:40, a 10:50 margin. Biggest gain was the bike, 5:10 faster, followed by the run at 4:30 faster, then the swim at 0:50 faster..."

**Short factual ("What's my 10K PB?").** Baseline (59 words) opens "Your 10K PR is 44:35, from Riverside 10K on 2026-04-19" and adds a year-over-year aside; final (36 words): the time, the race, the date, the placement, nothing else.

**Unsupported claim (training volume and nutrition).** Both versions correctly say RaceSignal has no training or nutrition data. Baseline then speculated that better fueling "tends to show up exactly like this" in the run split; final says what the data shows (bike 5:10, run 4:30, swim 0:50), says plainly it cannot tell why, and names the logs that would answer it.

**Sparse data ("Am I getting faster?").** Baseline 144 words, final 88: one race on file, so no trend; one clear next step.

**Screenshot.** Both read every number correctly (92.4 km, 2:42:10, 188 W, 212 W NP, 148/171 bpm, TSS 168, 1,120 m). Baseline opened with the evidence list and moralised about training load; final answers first (variable effort, consistent with the climbing), says it cannot compare to race power because none is stored, then lists "From your uploaded evidence". It still ends with a follow-up question about the IRONMAN build.

**Follow-up ("Which leg gained the most compared with Coastal?").** Baseline: "The run gained the most... the bike gained 5:10, which is actually the single biggest" (self-contradiction, 175 words). Final (44 words): "The bike, by 5:10. Run next at 4:30, swim 50s, transitions 10s each." After the pre-ranked legs were added, 6 of 6 sampled turns named the bike correctly; before it, 2 of 4 got it wrong or corrected themselves.

## Regressions and unresolved limitations

- **Intermittent factual slips remain (sampling noise).** In the final full run the year-over-year reply wrote the second 10K as "April 2025" instead of April 2026, although earlier runs of the same case had it right. The prompt tells the model to use the context's dates and to count before claiming a count; that reduced but did not eliminate slips. A reviewer should still scan dates in answers.
- **Strongest discipline is still weakly grounded.** The data has no per-leg ranking or field comparison, and both baseline and final answers still lean on impressions ("run splits are where you've shown the most standout results"; "swim and bike steady but unremarkable") and, in the final run, a claim that two races were the "best overall placements" that the ranks do not support. The "close call" hedge and the scope split (triathlon versus overall) are present, but the specific swim/bike/run verdict is not strongly supported. Needs either a per-leg signal in the data or a stricter rule.
- The race-comparison reply in the final run added "the run gain is proportionally the bigger jump", a proportional ranking the new rule discourages. Minor.
- Screenshot replies can end with a follow-up question that does not materially improve the answer.
- Replies are not deterministic (default sampling). One sample per case is anecdote, not a benchmark; ordinary variation across runs was visible. A larger sample was out of scope.
- A rewrite of the strongest-discipline logic, predictions, and prediction-specific cases was not part of this pass.

## iPhone test (development app, `dev.athlete@example.com`, password sign-in, 3 free asks)

The account's synthetic races: Sprint triathlon 2024-06-09 (1:13:00), Olympic 2025-07-12 (2:33:30), 70.3 2026-06-14 (5:14:10), 10K 2025-04-20 (44:30), Half Marathon 2025-10-05 (1:38:12), Marathon 2024-10-13 (3:29:55), 5K 2023-09-17 (21:40); upcoming "Synthetic Upcoming IRONMAN". Each question below uses one ask.

1. Open the **70.3** race, tap Ask Signal and ask: "How does this compare with my Olympic?" (Expect the first sentence to say or clearly imply the distances are not directly comparable, then something concrete, in about 80-150 words.)
2. Signal tab: "What's my 10K PB?" (Expect 44:30 at the Synthetic 10K on 2025-04-20 in one or two sentences, no extra analysis.)
3. Signal tab: "How much did my training volume and nutrition affect my 70.3?" (Expect a plain "I don't have that data" in the opening, what the race data does show, and no invented training detail.)
4. If you want a fourth, reset the counter (`python3 supabase/dev/verify-signal.sh` clears it) and ask: "Which leg of my 70.3 was my strongest?" (A good answer hedges, since there is no per-leg ranking; watch for confident swim/bike/run verdicts.)

---

# Correctness pass (2026-10-03, development only)

## Dates: the context was correct; the April 2025 error was a model error

The exact context for "Have I been improving year over year?" was reproduced from the fixture athlete (the same `buildSignalContext` and `buildSystemPrompt` the function uses). Every race carried its correct ISO date (the 44:35 10K was `2026-04-19`, the 46:10 10K `2024-04-20`); nothing in the fixtures contradicted anything. Two things made the facts easy to cross-wire: both 10Ks share the name "Riverside 10K", and the personal-best line read "10K: Riverside 10K, 44:35" with no date. So the model attached the wrong year in one sample. The formatter now writes every date as a named month with its year ("Apr 19, 2026") and attaches the date to each personal-best line by matching name and finish time (server-side, so installed app builds benefit). That removes ambiguity but does not guarantee the model never slips; the verification below reports what actually happened.

## What changed in this pass

- **Strongest discipline:** the old guidance (which let the model lean toward swim or running) is replaced by a rule that never names a strongest, weakest, or "standout" discipline in any scope. The first sentence says the results don't establish one ("I can identify where you improved most, but these results don't establish your strongest discipline"), then cites separate evidence: the largest improvement between two races of the same distance (explicitly labelled as improvement, not strength), standalone results with their own distance-specific percentile, and what would settle it. Overall and age-group placement is never presented as a discipline ranking.
- **Deterministic comparisons kept and extended:** the ranked "legs vs the seed" line is unchanged (its arithmetic and scope are correct). A new SAME-DISTANCE REPEATS block, computed in the formatter, gives earlier-to-later finish and leg differences, largest first, for any distance raced more than once (the seed-based deltas only exist when a seed race is open, and without them the model once named the run, not the bike, as the biggest gain).
- **Voice:** no em dashes or en dashes at all (ranges are written with "to" or a plain hyphen), end when the answer is complete with no closing question or offer unless the answer genuinely needs more information, no proportional claims about gains, no volunteered cross-distance comparisons, no internal labels ("vs seed", "deltas"), and "strongest/standout" reserved for the disciplines rule (a race is the athlete's "best" or "fastest").
- Unchanged: model, 700-token output cap (max observed 427), allowances, and every earlier factual safeguard.

## Verification (fixed answer key, three runs per case, 7 cases)

Cases: year over year, short factual (10K PB), strongest discipline (no seed), strongest leg within triathlon, race comparison, two-turn follow-up (breakdown, then "which leg gained the most"), two-turn screenshot follow-up. Answer key: 70.3 10:50 faster (bike 5:10, run 4:30, swim 0:50, T1 0:10, T2 0:10); 10K 46:10 (Apr 20, 2024) to 44:35 (Apr 19, 2026), 1:35 faster; one half marathon, one Olympic, one sprint; screenshot NP 212 W, average 188 W, gap 24 W. A mechanical checker scores dates, gain order, counts, discipline verdicts, dashes, trailing questions, and internal labels; every reply was also read in full. Replies are in `mobile/scripts/signal-eval/fixtures/voice-verify-{1,2,3}.json` (1 = before the repeats block, 2 = with it, 3 = final prompt).

| Run | Prompt | Case-runs flagged | Real failures found by reading |
|---|---|---|---|
| 1 | structure of the first pass plus dates/discipline rules | 3 of 21 (after fixing checker false positives) | strongest discipline: "the run improved the most" then self-corrected to the bike; breakdown replies volunteered Olympic and Sprint comparisons with self-computed numbers (89:40, 58:20) and called Ridgeline "your strongest 70.3, full stop" |
| 2 | + SAME-DISTANCE REPEATS | 5 of 21 | "vs-seed deltas" jargon leaked once; "strongest 70.3" wording twice; a cross-distance percentile claim; one strongest-leg reply listed whole-race placements next to disclaimers |
| 3 (final) | + wording and internal-label rules | 5 of 21 | see below |

**Final prompt, every factual failure found (21 case-runs, 27 asks):**
1. Follow-up #1, turn 1: "The swim improved the least in absolute terms." Wrong: the transitions (0:10 each) improved least; the swim gained 0:50.
2. Screenshot follow-up #2, turn 1: "...a longer, hillier ride than any bike leg you've raced to date." Unsupported: RaceSignal has no course profile or distance for race bike legs.
3. Three replies compare percentiles across distances ("your best percentile on file", "your fastest percentile finish on file", strongest-discipline #2 and #3, short-factual #2), which the prompt forbids.
4. Strongest-discipline #1 says the running results are "your most decorated placements on file" and #3 mentions "where your standout results are": both tilt toward running while saying a strongest discipline cannot be named.
5. Follow-up #3, turn 1 mentions that the Olympic and Sprint results are faster in raw time (no numbers), an unnecessary cross-distance remark.
6. Strongest-triathlon #1 offers the Ridgeline swim split next to the Olympic swim split ("different distances, can't be compared"), which is off topic.

**Not failures in the final run:** all dates correct in 6 of 6 date-sensitive replies (3 year-over-year, 3 short factual); the largest gain named correctly in 12 of 12 gain-ordering replies and 3 of 3 "which leg gained the most" follow-ups; no em dashes, no closing questions, no internal labels in any final reply; every screenshot number correct, "From your uploaded evidence" present, and every screenshot follow-up gave 212 W and 24 W without resending the image; in all 6 strongest-discipline and strongest-leg replies the first sentence says the results don't establish a strongest discipline and none names one.

**Token totals (exact, from `signal_usage_log`, 27 asks each):** run 1 input 190,601 / output 6,665; run 2 input 202,211 / output 6,579; run 3 (final) input 206,982 / output 6,451 (max single reply 427 output tokens, far below the 700 cap). Per ask the final prompt averages 7,666 input and 239 output tokens, against 5,664 input and 387 output for the original prompt (the first evaluation's nine asks: 50,977 input, 3,487 output). Dollar cost is not estimated here.

## Unresolved

The prompt reduces but does not eliminate these slips; sampling still produces occasional ones. The answer is probably a stricter content check or further examples for the strongest-discipline and cross-distance-percentile cases; that was not attempted in this pass.

## iPhone test (development app, `dev.athlete@example.com`, password sign-in)

**Account preparation (already done, nothing runs when you test):** earlier in this session I cleared this synthetic account's free-ask counter once, so it has all **3 free asks** and nothing has used one since (checked just now: no usage row). Each question below uses one ask, and no script, sign-in, or screen consumes or resets asks on its own. The facts below are read from the account's actual data through the app's own context builder:

| Race | Date | Finish | Placement |
|---|---|---|---|
| Synthetic IRONMAN 70.3 | Jun 14, 2026 | 5:14:10 | overall Top 12% (210/1800), age group Top 12% (22/190) |
| Synthetic Olympic Triathlon | Jul 12, 2025 | 2:33:30 | overall Top 15% (58/410), age group Top 6% (3/52) |
| Synthetic Half Marathon | Oct 5, 2025 | 1:38:12 | overall Top 9% (340/3900) |
| Synthetic 10K | Apr 20, 2025 | 44:30 | overall Top 6% (120/2100) |
| Synthetic Marathon | Oct 13, 2024 | 3:29:55 | overall Top 13% (800/6200) |
| Synthetic Sprint Triathlon | Jun 9, 2024 | 1:13:00 | overall Top 13% (41/320), age group Top 14% (5/38) |
| Synthetic Manual 5K | Sep 17, 2023 | 21:40 | none |
| Synthetic Upcoming IRONMAN | Dec 16, 2026 | upcoming | |

No distance is repeated, so there are no same-distance comparisons on this account.

1. Signal tab: "What's my half marathon PB?" Expect 1:38:12 at the Synthetic Half Marathon on Oct 5, 2025, top 9% overall, in one or two sentences, no dashes, no closing question.
2. Open the 70.3 race, tap Ask Signal: "How does this compare with my Olympic?" Expect it to say they are different distances so there is no like-for-like comparison (70.3 5:14:10, Olympic 2:33:30), not a leg-by-leg analysis.
3. Signal tab: "What's my strongest discipline?" Expect the first sentence to say the results don't establish one, that there is no per-leg ranking, and no swim, bike, or run named as strongest. Flag it if it says running (or anything) "stands out".
4. Signal tab: "Have I been improving year over year?" Expect it to say no distance has been raced twice, so there is no like-for-like pair, and to list single results with the correct years (Sprint 2024, Olympic 2025, half marathon 2025, 10K 2025, 70.3 2026, marathon 2024).
