// Named Signal regression cases — see README.md for how to run these. Deterministic correctness
// (percentiles, time deltas) is covered by fast, zero-model-call Jest unit tests in
// __tests__/signalContext.test.ts; THIS harness's job is end-to-end behavior against the live
// model — reliability, plus best-effort automated red-flags for the exact wrong phrasings found
// during the Step 5 eval, with full replies always printed for a quick human read.
import { findRaceByName, sendTurn, setupEnv, type SignalEvalEnv, type Turn } from './harness';

interface CaseResult {
  name: string;
  pass: boolean;
  notes: string[];
}

function replyText(json: unknown): string | null {
  const r = json as { available?: boolean; data?: { reply?: string } };
  return r.available && r.data?.reply ? r.data.reply : null;
}

/** Regression: Eagleman-vs-Victoria run-leg time difference was miscalculated by the model
 *  (~13 min claimed, ~16.5 min actual). The fix computes this delta in the app, not the model —
 *  see buildSignalContext's timeDeltasVsSeed (unit-tested directly in signalContext.test.ts). This
 *  live case just confirms the end-to-end conversation still succeeds and flags the exact wrong
 *  phrasing if it ever reappears. */
async function eaglemanVsVictoriaArithmetic(env: SignalEvalEnv): Promise<CaseResult> {
  const eagleman = findRaceByName(env.races, 'Eagleman');
  const notes: string[] = [];
  if (!eagleman) return { name: 'eagleman-vs-victoria-arithmetic', pass: false, notes: ['No Eagleman race found in this athlete\'s data — cannot run this case.'] };

  const result = await sendTurn(env, eagleman.id, [], 'Compare Eagleman with Victoria. What changed the most?');
  const reply = replyText(result.json);
  notes.push(`status=${result.status}`, `reply:\n${reply ?? JSON.stringify(result.json)}`);
  if (!reply) return { name: 'eagleman-vs-victoria-arithmetic', pass: false, notes };

  const claimsThirteenMinutes = /\b13\s*(min|minutes)\b/i.test(reply) && /run/i.test(reply);
  if (claimsThirteenMinutes) notes.push('RED FLAG: reply still claims the old wrong ~13 minute run delta — check timeDeltasVsSeed wiring.');
  return { name: 'eagleman-vs-victoria-arithmetic', pass: !claimsThirteenMinutes, notes };
}

/** Regression: Signal generalized a top-3% half-marathon percentile onto the 10K (whose real best
 *  is top 6%). The fix is the bestPerDistance summary (unit-tested directly). This live case asks
 *  specifically about 10K performance and flags the exact wrong percentile if it reappears. */
async function tenKPercentileAccuracy(env: SignalEvalEnv): Promise<CaseResult> {
  const notes: string[] = [];
  const result = await sendTurn(env, undefined, [], 'How have I done at the 10K distance specifically? What percentile is my best 10K result?');
  const reply = replyText(result.json);
  notes.push(`status=${result.status}`, `reply:\n${reply ?? JSON.stringify(result.json)}`);
  if (!reply) return { name: 'tenk-percentile-accuracy', pass: false, notes };

  const claimsTopTwoOrThree = /top\s*2[\s-]*(to|-)?\s*3\s*%/i.test(reply);
  if (claimsTopTwoOrThree) notes.push('RED FLAG: reply claims "top 2-3%" for the 10K — that figure belongs to the half marathon, not the 10K.');
  return { name: 'tenk-percentile-accuracy', pass: !claimsTopTwoOrThree, notes };
}

/** Regression: "strongest discipline" answers flipped between bike and running across separate
 *  runs with no hedge either time. Ask it twice, fresh, and check both replies at least
 *  acknowledge how close the evidence is, rather than confidently naming a single winner both
 *  times with no qualifier. */
async function strongestDisciplineAmbiguity(env: SignalEvalEnv): Promise<CaseResult> {
  const notes: string[] = [];
  const [r1, r2] = await Promise.all([
    sendTurn(env, undefined, [], "What's my strongest discipline?"),
    sendTurn(env, undefined, [], "What's my strongest discipline?"),
  ]);
  const reply1 = replyText(r1.json);
  const reply2 = replyText(r2.json);
  notes.push(`reply 1:\n${reply1 ?? JSON.stringify(r1.json)}`, `reply 2:\n${reply2 ?? JSON.stringify(r2.json)}`);
  if (!reply1 || !reply2) return { name: 'strongest-discipline-ambiguity', pass: false, notes };

  const hedgeWords = /\b(close|toss-up|tossup|either|genuinely close|hard to say|no clear|roughly even|neck and neck)\b/i;
  const bothHedge = hedgeWords.test(reply1) && hedgeWords.test(reply2);
  if (!bothHedge) notes.push('Note: at least one reply did not explicitly acknowledge how close bike vs. run is — review manually.');
  return { name: 'strongest-discipline-ambiguity', pass: bothHedge, notes };
}

/** Regression: the California prediction cited an invented population benchmark ("athletes at
 *  this level typically finish at 2.3x-2.6x their 70.3 time") not present in RaceSignal's data. */
async function californiaPredictionNoInventedBenchmark(env: SignalEvalEnv): Promise<CaseResult> {
  const eagleman = findRaceByName(env.races, 'Eagleman');
  const notes: string[] = [];
  if (!eagleman) return { name: 'california-prediction-no-benchmark', pass: false, notes: ['No Eagleman race found — cannot run this case.'] };

  const result = await sendTurn(env, eagleman.id, [], 'Based on my history, what is a realistic finish-time range for IRONMAN California?');
  const reply = replyText(result.json);
  notes.push(`status=${result.status}`, `reply:\n${reply ?? JSON.stringify(result.json)}`);
  if (!reply) return { name: 'california-prediction-no-benchmark', pass: false, notes };

  const citesRatioBenchmark = /\d\.\d\s*x\s*[-–]\s*\d\.\d\s*x/i.test(reply) || /athletes at (this|your) level/i.test(reply);
  const givesRange = /\d{1,2}:\d{2}/.test(reply) || /\brange\b/i.test(reply);
  // Mentioning "double" near "70.3" isn't itself a problem — the desired behavior is explicitly
  // REJECTING a naive double (e.g. "not just double the fatigue"), which necessarily uses both
  // words together. Only flag doubling used as an actual, unhedged calculation.
  const explicitlyRejectsDoubling = /\b(not|n't|never|isn't|doesn't|wasn't)\b[^.]{0,40}\bdouble\b|\bdouble\b[^.]{0,40}\b(not|n't|never)\b/i.test(reply);
  const usesDoublingAsCalculation = /\bdouble\b/i.test(reply) && /70\.3/.test(reply) && !explicitlyRejectsDoubling;
  if (citesRatioBenchmark) notes.push('RED FLAG: reply appears to cite an invented population ratio/benchmark not present in context.');
  if (!givesRange) notes.push('Note: reply may not clearly state a provisional range — review manually.');
  if (usesDoublingAsCalculation) notes.push('RED FLAG: reply mentions doubling a 70.3 time without explicitly rejecting it as the method — review manually.');
  return { name: 'california-prediction-no-benchmark', pass: !citesRatioBenchmark && givesRange && !usesDoublingAsCalculation, notes };
}

/** Acceptance test: 5+ consecutive turns in one conversation with zero failures. */
async function fiveTurnReliability(env: SignalEvalEnv): Promise<CaseResult> {
  const eagleman = findRaceByName(env.races, 'Eagleman');
  const notes: string[] = [];
  if (!eagleman) return { name: 'five-turn-reliability', pass: false, notes: ['No Eagleman race found — cannot run this case.'] };

  const prompts = [
    'Analyze my Eagleman race.',
    'Compare Eagleman with Victoria. What changed the most?',
    "What's my strongest discipline?",
    'Have I been improving year over year?',
    'Based on my history, what is a realistic finish-time range for IRONMAN California?',
  ];
  const history: Turn[] = [];
  let failures = 0;
  for (const [i, prompt] of prompts.entries()) {
    const result = await sendTurn(env, eagleman.id, history, prompt);
    const reply = replyText(result.json);
    notes.push(`turn ${i + 1} (${prompt}): status=${result.status}, elapsedMs=${result.elapsedMs}, requestBytes=${result.requestBytes}${reply ? '' : ` FAILED: ${JSON.stringify(result.json)}`}`);
    if (!reply) {
      failures += 1;
      continue;
    }
    history.push({ role: 'user', text: prompt });
    history.push({ role: 'assistant', text: reply });
  }
  return { name: 'five-turn-reliability', pass: failures === 0, notes };
}

/** Screenshot extraction + follow-up: attach an image once, confirm evidence extraction and the
 *  labeled section, then confirm a follow-up answers from carried-forward text without resending
 *  the image (checked via request size, not just a status code). Needs SIGNAL_EVAL_IMAGE_PATH
 *  (a local image file) — skipped with a clear note if not provided. */
async function screenshotExtractionAndFollowUp(env: SignalEvalEnv): Promise<CaseResult> {
  const notes: string[] = [];
  const imagePath = process.env.SIGNAL_EVAL_IMAGE_PATH;
  if (!imagePath) {
    return { name: 'screenshot-extraction-and-followup', pass: false, notes: ['Skipped: set SIGNAL_EVAL_IMAGE_PATH to a local screenshot to run this case.'] };
  }
  const fs = await import('node:fs');
  const base64 = fs.readFileSync(imagePath).toString('base64');
  const mediaType = imagePath.endsWith('.png') ? 'image/png' : imagePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

  const r1 = await sendTurn(env, undefined, [], "Here's my ride data. Can you pull out the key numbers?", { base64, mediaType });
  const reply1 = replyText(r1.json);
  notes.push(`turn 1: status=${r1.status}, requestBytes=${r1.requestBytes}`, `reply 1:\n${reply1 ?? JSON.stringify(r1.json)}`);
  if (!reply1) return { name: 'screenshot-extraction-and-followup', pass: false, notes };

  const hasEvidenceSection = /from your uploaded evidence/i.test(reply1);
  if (!hasEvidenceSection) notes.push('RED FLAG: first reply after an image is missing the "From your uploaded evidence" section.');

  const history: Turn[] = [{ role: 'user', text: "Here's my ride data. Can you pull out the key numbers?" }, { role: 'assistant', text: reply1 }];
  const r2 = await sendTurn(env, undefined, history, 'What was my normalized power again?'); // no image
  const reply2 = replyText(r2.json);
  notes.push(`turn 2 (no image): status=${r2.status}, requestBytes=${r2.requestBytes}`, `reply 2:\n${reply2 ?? JSON.stringify(r2.json)}`);
  if (!reply2) return { name: 'screenshot-extraction-and-followup', pass: false, notes };

  const imageWasNotResent = r2.requestBytes < r1.requestBytes / 2; // a resent image would dominate the payload
  if (!imageWasNotResent) notes.push('RED FLAG: follow-up request body is nearly as large as the image turn — the image may have been resent.');

  return { name: 'screenshot-extraction-and-followup', pass: hasEvidenceSection && imageWasNotResent, notes };
}

export const REGRESSION_CASES: Record<string, (env: SignalEvalEnv) => Promise<CaseResult>> = {
  'eagleman-vs-victoria-arithmetic': eaglemanVsVictoriaArithmetic,
  'tenk-percentile-accuracy': tenKPercentileAccuracy,
  'strongest-discipline-ambiguity': strongestDisciplineAmbiguity,
  'california-prediction-no-benchmark': californiaPredictionNoInventedBenchmark,
  'five-turn-reliability': fiveTurnReliability,
  'screenshot-extraction-and-followup': screenshotExtractionAndFollowUp,
};

async function main() {
  const requestedNames = process.argv.slice(2);
  const names = requestedNames.length > 0 ? requestedNames : Object.keys(REGRESSION_CASES);

  const env = await setupEnv();
  console.log(`Loaded ${env.races.length} races for the test athlete.\n`);

  const results: CaseResult[] = [];
  for (const name of names) {
    const runCase = REGRESSION_CASES[name];
    if (!runCase) {
      console.warn(`Unknown case "${name}" — skipping. Known cases: ${Object.keys(REGRESSION_CASES).join(', ')}`);
      continue;
    }
    console.log(`\n=== ${name} ===`);
    const result = await runCase(env);
    for (const note of result.notes) console.log(note);
    console.log(`--> ${result.pass ? 'PASS' : 'FAIL'}`);
    results.push(result);
  }

  console.log('\n\n=== SUMMARY ===');
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log(`\n${failed.length} of ${results.length} case(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} case(s) passed.`);
  }
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exitCode = 1;
});
