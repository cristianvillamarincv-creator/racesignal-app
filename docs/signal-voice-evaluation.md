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


---

# Second revision (2026-10-04, development only): consolidation, conditional strength rule, screenshot caution

## What changed

- **Prompt consolidated.** Ten overlapping voice bullets (self-correction, absolute-time ranking, counting, same-distance scope, internal labels, "strongest" wording, cross-distance splits, arithmetic, certainty, per-leg ranking) became three: get the numbers right, keep comparisons in scope, stop at the answer. The static prompt (empty context) went from 16,105 to 15,591 characters (2,705 to 2,618 words).
- **Fact versus interpretation** now reads: separate observed facts from supported interpretation, explain useful patterns when the evidence supports them, do not invent causes or turn a result into an unsupported claim about fitness, course difficulty, or field strength.
- **Cross-distance discussion** is allowed when the athlete asks for it, with its scope stated. Raw times, splits and percentiles from different distances are never ranked against each other as equivalent measures.
- **Strongest or weakest discipline** may be named only from comparable discipline-level evidence: the athlete's rank or percentile in swim, bike and run against the same race field (a "leg rank" on a split). Pace, power, duration and overall or age-group placement do not qualify. Without that evidence: a short limitation scoped to "among swim, bike, and run", then the improvement evidence, no implied winner, transitions separate. The Edge Function formatter renders an optional `legRank` on a split. The app does not send it today, so production behaviour is unchanged.
- **Screenshot:** the "From your uploaded evidence" section stays the complete factual record; the narrative is selective and cautious; no load judgements; no invented causes; a difference between two screenshot figures is never presented as read from the image (if asked, it is shown as inline arithmetic, e.g. "212 W minus 188 W is 24 W"); no derived figure in the evidence section.
- Replies use the first person ("I don't have your training volume") instead of "RaceSignal doesn't have...".

## Live check: six asks, run once, nothing repeated

Cases: strongest discipline (no per-leg evidence); strongest discipline with synthetic per-leg ranks (Ridgeline swim 412/1720 Top 24%, bike 96/1720 Top 6%, run 188/1720 Top 11%; Coastal swim 395/1650 Top 24%, bike 143/1650 Top 9%, run 221/1650 Top 14%); same-distance race comparison; "Break down my Ridgeline 70.3" then "Which leg gained the most compared with Coastal?" (2 asks); screenshot analysis. Replies: `mobile/scripts/signal-eval/fixtures/voice-rev5.json`.

Tokens (exact, `signal_usage_log`): 6 asks, input 46,104 (6,949; 7,069; 7,487; 7,489; 7,881; 9,229 with image), output 1,660 (209; 285; 301; 374; 151; 340). Longest reply 374 of the 700 cap.

Failures found (reading every reply, then rescored with the corrected checker):
1. Strongest with per-leg ranks: opens with "The results don't establish which of swim, bike, and run is your strongest: there are no per-leg rankings against the field for every race, though Ridgeline 70.3 and Coastal 70.3 both have them." The evidence branch did not produce a direct verdict; the body gives the right ranks (bike Top 6% and Top 9%, run Top 11% and Top 14%, swim Top 24% twice) and says bike ranks ahead of run and run ahead of swim in both races, but never says "strongest". It also says "The swim gained the least" for the two-race gain, which is true among the three disciplines but unscoped (the transitions gained less).
2. Race comparison: the closing paragraph says the finish moved the athlete "from first-recorded-70.3 territory into a PR with a notable age-group result", unsupported and generic; the opening sentence repeats itself.
3. Breakdown, turn 1: "The bike and run account for almost all of the 10:50 overall improvement" is a proportional claim from the model's own arithmetic (9:40 of 10:50); it also volunteers a strongest-discipline remark nobody asked about and adds "which fits with the across-the-board time drop".
4. Screenshot: lists "climbs, surges, terrain changes" as examples of why power varied, then says it can't say what caused it; it closes with a generic remark ("a training ride, not a race result... I haven't compared it to any of your triathlon bike legs").

Not failures: strongest discipline without evidence (correct limitation, bike gain 5:10 then run 4:30 then swim 0:50, no implied winner), the 24 W shown as "(212 minus 188)", no load judgement, evidence section complete with no derived figure, "Which leg gained the most" correct, no dashes, no closing questions, dates correct.

Checker note: the first automatic score flagged "names a strongest discipline" on a reply that restates the question ("which of swim, bike, and run is your strongest"); that was a false positive and is fixed. It missed the proportional claim, "notable/territory", the invented-cause list and the generic add-on; those are now flagged. Prompt-string tests and the checker are supporting checks; the replies were read against the fixture facts.

---

# Final revision (2026-10-04, development only): scoped discipline evidence, trimmed commentary

## Why the strongest-discipline answer contradicted itself

`mobile/scripts/signal-eval/dumpModelInput.ts` prints the exact system prompt the function sends for a context variant (no model call). For the synthetic fixture it shows the per-leg ranks did reach the model (the Ridgeline and Coastal split lines carry `leg rank: 96/1720 (Top 6%)` and so on); the function passes the context through untouched and only checks that four arrays exist. The contradiction came from the prompt: the no-evidence branch was described as "the usual case" and quoted the sentence "there are no per-leg rankings against the field", which the model reproduced even with ranks present.

## Changes

- The rule is now evaluated per race. A computed `DISCIPLINE-LEVEL EVIDENCE` line names the races whose splits carry swim, bike and run leg ranks; the verdict is for those races only ("The bike is your strongest-ranked discipline in these two 70.3s."), not for every race or current fitness, and missing ranks elsewhere are never a reason to withhold it. Without that line the short limitation plus improvement evidence remains. The primed example sentence is gone.
- "Stop at the answer" now ends on the last fact the question needed (no summary characterisation, no comment on what kind of data it is, nothing on a topic the athlete didn't raise). Sums of legs and shares of a total are not supplied, so they are left out.
- Screenshot: no possible causes unless asked, and the gap between two figures is stated only on request (as inline arithmetic).
- The checker now tags each finding `[fact]`, `[claim]` or `[style]`.

## Live check: three asks, run once (`mobile/scripts/signal-eval/fixtures/voice-rev6.json`)

Tokens (exact): input 7,315 / 7,078 / 9,358 (image) = 23,751; output 253 / 210 / 260 = 723. Static prompt (empty context): 16,067 characters, up from 15,591 in the previous revision and 16,105 originally; with the fixture the prompt is 19,982 characters with leg ranks and 19,525 without.

Findings, separated:
- Valid ranks: correct, scoped to the two 70.3s, no generalisation. No findings.
- No ranks: facts correct (bike 5:10, run 4:30, swim 0:50; no ranks on file). Style: the first sentence is garbled ("where leg ranks aren't listed but the paired comparison ... is") and the limitation arrives in the second sentence.
- Screenshot: facts correct, evidence section complete, no derived figure, no 24 W, no load judgement. Claim: "likely due to the 1,120 m of climbing" speculates a cause. Style: the narrative restates seven of eight figures and still ends with "This is training data, not tied to any race on your file..."
- No dashes, no closing questions, no internal labels.

Remaining limitations (prompt tuning stops here for iPhone review): the speculative cause and closing remark on screenshots persist; the app does not send leg ranks, so the discipline-verdict branch cannot occur on a device until a results provider supplies them.

## Unresolved after the final revision (recorded, not fixed; prompt tuning stopped for iPhone review)

1. Screenshot analysis can still offer an unsupported cause for the power variation ("likely due to the 1,120 m of climbing") although the prompt says not to list causes unless asked.
2. Screenshot analysis can still end with a repetitive closing remark ("This is training data, not tied to any race on your file...") and restates most of the figures in the narrative before the evidence section.
3. With no per-leg ranks, the first sentence can be an awkward blend of the limitation and the improvement evidence ("In these two 70.3s, where leg ranks aren't listed but the paired comparison ... is, ..."); the content is correct.
4. The per-leg verdict branch cannot occur on a device until a results provider supplies leg ranks (the app does not send them).

## iPhone test account preparation (2026-10-04)

`cristian.flipd@gmail.com` (user `315411d2-f74b-49ac-9f40-8a818064d4c8`, racesignal-dev `sjmixferxnkwbzkcofnp`, verified against `mobile/config/environments.json` and not the repo's production link): its free-ask counter (`signal_free_usage.lifetime_count`) was reset from 2 to 0 for the review, so all 3 lifetime asks are available (cap 3, no dev secret overrides it). Its 3 races, profile, email and Google identities, sign-in record and monthly rate rows were compared before and after and are unchanged; RevenueCat was not touched.


---

# iPhone review findings and corrections (2026-10-04)

Three questions in one Signal thread on the iPhone, account `cristian.flipd@gmail.com` (3 completed races, no ranks, no splits):

| Question | Result |
|---|---|
| "What's my strongest discipline overall?" | **Failed the missing-evidence behaviour.** Correctly named no discipline, but gave three paragraphs of unnecessary explanation; "I can't actually call one" and "If you want a real answer" read as dismissive; the suggestion offered a question the account's data cannot answer. |
| "What is my 10K personal best?" | **Pass.** "44:30, set at the Link Test 10K on April 20, 2025." Directness to be preserved. |
| "Which race was that and what year?" | **Pass** for conversational context: it correctly referred to the preceding 10K answer. This verifies continuity within the open thread only. |

Screenshot interpretation remains untested on the phone. Its previously observed unsupported cause ("likely due to the 1,120 m of climbing") and repetitive closing remark remain open.

## Corrections

- **Layout:** questions are right-aligned muted blue-grey bubbles (85% max width, 16pt regular, 14pt padding, 16pt corners); answers sit on the canvas (17pt regular, 25pt line height) under the Signal mark and a small SIGNAL label on every answer (replacing "ANALYSIS"); the first paragraph is no longer bold; 12pt between a question and its answer, 28pt before the next question, no rules between messages; screen-reader labels identify "Your question" and "Signal's answer"; no fixed-height containers. New content follows to the end only while the athlete is near the end or has just sent a message.
- **Missing evidence:** when the data cannot answer and no relevant comparison exists, one short paragraph: the limitation and the specific missing evidence. Another race's split times alone do not establish discipline strength. The conditional verdict (per-race leg ranks) and supported improvement comparisons are preserved.
- **Suggested questions** are deterministic and read the evidence from the context Signal would receive: strongest discipline needs comparable swim, bike and run leg ranks (the race model has none, so no real account sees it); year-over-year or comparison needs two completed results at the same sport and distance; the pacing question needs two or more splits; personal best and race summary need a completed result; next-race questions need an upcoming race and completed history. Nothing fills an empty slot. The Signal tab, the unseeded chat, a seeded race chat, the next-race module on the Signal tab and on an upcoming race, and the Signal module on a race with no result were all brought in line.

No new paid model evaluation was run for these changes and no allowance was reset; the prompt change is checked by prompt-string tests only, so the real-model behaviour of the new missing-evidence paragraph is untested.

## Read-only allowance lookup (2026-10-04)

The Signal screen showed an allowance only after a reply, so reopening it showed nothing and an already-open screen kept a stale count. The `signal` function now has a read-only `{ action: "usage" }`: it authenticates the caller, resolves entitlement with the same RevenueCat lookup a reply uses, and reads the same counters (free: `signal_free_usage.lifetime_count`, a lifetime counter; premium: `signal_rate_limit.premium_request_count` for the current UTC month), returning `remaining`, `cap` and `isPremium`. It returns before request dedup, reservation and the model call, uses only SELECTs, and reports an entitlement or counter failure as `service_unavailable` rather than a guessed count. The screen refreshes it when Signal opens, when it regains focus (focus event or app returning to the foreground), and after a send settles; a failed lookup shows no count (except right after a reply whose own count was just applied) and never blocks the conversation; a slow lookup cannot overwrite a fresher count. Development only. Checked live on development with the synthetic athletes: premium 4 of 40, free 3 of 3, repeated reads identical, no auth rejected, and the counters, usage log and dedup table unchanged before and after.

---

# Device results and final voice correction (2026-10-04, development only; Signal tuning stops here)

## Device results (iPhone, development build, `cristian.flipd@gmail.com`)

Confirmed working: the new conversation layout (question bubbles, SIGNAL label on every answer, spacing) and the post-answer allowance counts (the strip showed 2 of 3 and later 0 of 3 after replies); the 10K lookup ("44:30, set at the Link Test 10K on April 20, 2025"); the follow-up reference ("Which race was that and what year?"); and screenshot-context recall (the evidence section let a later question about average power be answered without resending the image).

Findings from the same session:
1. **Missing-evidence answer** ("What's my strongest discipline?" asked again): "Same answer as before: I can't call one." followed by an inventory of the Sprint Triathlon, 10K and half marathon. Correct but too long, refers to an earlier answer, and lists unrelated races.
2. **Screenshot of a Garmin road ride** (150.80 km, 5:12:34, 28.9 km/h, 501 m, 131 W, title cut off at "…(3 x 50 minutes @ IM p"):
   - addressed the athlete as "this athlete";
   - read the truncated title as "structured IRONMAN-pace work", treating the title as if it described what was ridden;
   - restated most figures in the narrative before the evidence section;
   - the follow-up ("What does average power tell you?") said average power was "produced across the full 5:12:34 ride", assuming the recording covers the whole displayed duration (pause and auto-stop settings are unknown). The rest of that answer, including "I don't have a baseline or threshold" and the normalized-power limitation, was sound.

## Correction

- Missing evidence: two short sentences when there is no useful comparison, the limitation and then the specific missing evidence, said fresh each time, with no reference to an earlier answer and no unrelated races. The discipline rule points to it.
- Address the athlete as "you".
- Screenshots: the narrative interprets only the two or three figures that answer the question; the "From your uploaded evidence" section stays the complete factual record (a cut-off title marked as truncated). Metrics are explained briefly with one relevant limitation. A workout title is stated intent, not proof the intervals were completed, and a truncated title stays explicitly uncertain. An average is not assumed to cover the whole displayed duration.
- Consolidated: the static prompt is 16,075 characters (2,686 words), against 16,144 (2,698) before this correction.

Model, 700-token cap, quotas and factual safeguards unchanged. No paid evaluation, allowance reset, native rebuild or production change; the correction is covered by prompt-string tests only and is untested against the real model.

## Remaining limitations (Signal tuning is closed)

- The prompt-string tests do not prove the model follows the new wording; the earlier real-model runs showed it follows some rules inconsistently (an unsupported cause and a repetitive closing on screenshots were still seen after earlier corrections).
- The per-leg verdict branch cannot occur on a device until a results provider supplies leg ranks.
- A reopened thread loses the "Screenshot attached" tag on stored questions.
- Screenshot reading is only as good as the image: truncated titles and unknown recording settings stay uncertain.


## QA record correction (2026-10-04)

Device screenshots confirmed the allowance counts shown after answers (2 of 3, then 0 of 3). They did not confirm the refresh added in `28ab346`: that the count is fetched from the server when Signal opens, when it regains focus, or when the app returns to the foreground, before any send. That behaviour is covered by automated tests and a live check of the function on development, but still needs an explicit device check (for example: use asks, reset or change the allowance server-side, reopen Signal, and confirm the strip shows the server's count before sending anything).
