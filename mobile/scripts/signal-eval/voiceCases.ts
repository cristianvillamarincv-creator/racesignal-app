// Developer-only Signal VOICE evaluation (not part of the app; same exclusions as harness.ts). Runs a fixed set of
// cases against the REAL deployed `signal` Edge Function with two SYNTHETIC dev athletes seeded by
// supabase/dev/seed-signal-eval.mjs (fixed facts, so every case has a known answer key), and writes every reply plus
// cheap mechanical metrics to a JSON file for side-by-side comparison. A human (or reviewer) reads the replies; the
// metrics only flag mechanical voice problems (length, em dashes, stock phrases, headings), never correctness.
//
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx --env-file=.env.development scripts/signal-eval/voiceCases.ts out.json [case ...]
import { readFileSync, writeFileSync } from 'node:fs';
import type { SignalContext } from '../../src/lib/signalContext';
import { fetchTestAthleteRaces, findRaceByName, mintTestSession, sendTurn, type SignalEvalEnv, type Turn } from './harness';

const RICH_EMAIL = 'signal.eval@example.com';
const SPARSE_EMAIL = 'signal.eval.sparse@example.com';

interface TurnRecord { message: string; reply: string | null; failure?: string; words: number; emDashes: number; stockPhrases: string[]; headings: boolean; ms: number }
interface CaseRecord { name: string; run?: number; turns: TurnRecord[]; failures?: string[] }

const STOCK = [/let'?s dive in/i, /great question/i, /based on your (race )?history/i, /the available evidence suggests/i, /it'?s worth noting/i, /(^|\n)overall,/i, /in summary/i, /to summarize/i, /keep (it )?up/i, /you'?ve got this/i, /i hope this helps/i, /here'?s (a |the )?(breakdown|summary)/i];

function metrics(message: string, reply: string | null, ms: number, failure?: string): TurnRecord {
  const text = reply ?? '';
  return {
    message, reply, failure, ms,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    emDashes: (text.match(/—/g) ?? []).length,
    stockPhrases: STOCK.filter((re) => re.test(text)).map((re) => re.source),
    headings: /^(what i know|what it suggests|confidence|what would improve)/im.test(text) || /^\s*#{1,6}\s/m.test(text) || /\*\*/.test(text),
  };
}

async function ask(env: SignalEvalEnv, seedRaceId: string | undefined, history: Turn[], message: string, image?: { base64: string; mediaType: string }, transform?: (context: SignalContext) => SignalContext): Promise<TurnRecord & { text: string | null }> {
  const r = await sendTurn(env, seedRaceId, history, message, image, transform);
  const j = r.json as { available?: boolean; data?: { reply?: string }; reason?: string };
  const reply = j.available && j.data?.reply ? j.data.reply : null;
  return { ...metrics(message, reply, r.elapsedMs, reply ? undefined : `status=${r.status} reason=${j.reason ?? 'unknown'}`), text: reply };
}

async function envFor(email: string): Promise<SignalEvalEnv> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const session = await mintTestSession(url, email);
  return { supabaseUrl: url, anonKey: anon, accessToken: session.access_token, races: await fetchTestAthleteRaces(url, anon, session.access_token) };
}


// ---------------------------------------------------------------------------------------------------------
// Fixed answer key (see the header comment of supabase/dev/seed-signal-eval.mjs). Each check returns the list of
// FACTUAL or VOICE failures found in a case's replies; an empty list means the case passed that run. These are
// deliberately mechanical and conservative, so every reply is still printed in full for a human to read.
// ---------------------------------------------------------------------------------------------------------
const NAMES_A_WINNER = [
  /\b(swim|bike|run|running)\b[^.\n]{0,60}\b(is|are|was|looks|looked|appears|seems|stands out as|has been)\b[^.\n]{0,25}\b(your )?(the )?(strongest|stronger|standout|best|ahead)\b/i,
  /\b(strongest|best|standout|stronger)\b[^.\n]{0,25}\b(discipline|leg|sport)?\b[^.\n]{0,15}\b(is|looks|appears|seems|would be)\b[^.\n]{0,15}\b(swim|bike|run|running)\b/i,
  /\b(slight|slightly) (edge|lean|ahead)\b/i,
  /\bclose (call|to a toss-up)\b.*\b(swim|bike|run)\b/i,
];
const DECLINES = /(don'?t|doesn'?t|do not|does not|cannot|can'?t|not|no basis( to)?|no way( to)?)( actually| really)? (establish|determine|show|tell|identify|name|support|answer|call|compare)|no (comparable )?(per-leg|per-discipline|discipline-level)/i;
const WRONG_LARGEST = /\b(run|swim)\b[^.\n]{0,50}\b(improved|gained|dropped|faster)\b[^.\n]{0,25}\b(the )?(most|biggest|largest)\b/i;
const SELF_CORRECTION = /apolog|to be precise|actually (the )?(bigger|larger|more)|correction|let me correct|that'?s actually/i;
const SWIM_LEAST = /\bswim\b[^.\n]{0,60}\b(improved|gained|moved)\b[^.\n]{0,25}\bthe least\b|\bleast\b[^.\n]{0,30}\bswim\b/i;
const UNSUPPORTED_RIDE = /hillier|longer[^.\n]{0,40}than any/i;
const LEAKS_INTERNALS = /vs[- ]seed|\bdeltas?\b|precomputed|already[- ]computed|the context/i;
const OTHER_DISTANCES = /\b(Lakeview|Olympic|Harbor|Sprint)\b/;
const TEN_FIFTY = /10:50|10 minutes,? 50|10m ?50|nearly 11 minutes|almost 11 minutes/i;
const FIVE_TEN = /5:10|5 minutes,? 10 seconds|5m ?10/i;

/** "...which of swim, bike, and run is your strongest" restates the question; it is not a verdict. */
const withoutQuestionRestated = (text: string) => text.replace(/which (of )?(swim|the three|your)[^.:\n]{0,40}(strongest|weakest)/gi, '');

function voiceFailures(text: string, label: string): string[] {
  const out: string[] = [];
  if (SWIM_LEAST.test(text)) out.push(`${label}: FACT ERROR: says the swim improved the least (transitions improved least)`);
  if (UNSUPPORTED_RIDE.test(text)) out.push(`${label}: UNSUPPORTED claim comparing the ride's hills or length with past races`);
  if (/most decorated|where your standout|your standout/i.test(text)) out.push(`${label}: tilts toward a sport ("most decorated"/"standout")`);
  if (LEAKS_INTERNALS.test(text)) out.push(`${label}: mentions an internal label (vs seed / deltas / context)`);
  if (/\b(strongest|stronger|standout) (70\.3|race|result|10K|half|olympic|sprint)\b/i.test(text)) out.push(`${label}: uses "strongest" for a race`);
  if (/stands? out|stood out|stand out/i.test(text) && /\\b(run|running|swim|bike)\\b/i.test(text)) out.push(`${label}: says a sport's results "stand out"`);
  if (/(best|top) (age-group )?percentile (of anything|on file)|best age-group percentile/i.test(text)) out.push(`${label}: ranks percentiles across distances`);
  if (/\b(solid|solidly|demanding|not extreme|moderate load|hard session|easy (day|session|ride))\b/i.test(text)) out.push(`${label}: judges the load or effort for this athlete (no baseline exists)`);
  if (/uneven power|stop-start|surges/i.test(text)) out.push(`${label}: invents or mislabels a cause or pattern for the power gap`);
  if (/\b(fitter|fitness|better shape|in better form|stronger athlete)\b/i.test(text)) out.push(`${label}: turns a result into a fitness claim`);
  if (/makes sense (since|because)|only so much time to find|typical(ly)? for|expected given/i.test(text)) out.push(`${label}: adds a generic explanation after answering`);
  if (/RaceSignal (doesn'?t|does not|has no|holds no|only has)/i.test(text)) out.push(`${label}: refers to RaceSignal in the third person ("RaceSignal doesn't...")`);
  if (/(almost|nearly) all of|most of the (overall |total )?(gain|improvement|time)|account(s|ed)? for [^.\n]{0,40}(of the|%)/i.test(text)) out.push(`${label}: proportional claim about gains`);
  if (/\bnotable\b|territory/i.test(text)) out.push(`${label}: unsupported characterisation ("notable", "territory")`);
  if (/(climbs|surges|terrain changes)\)/i.test(text)) out.push(`${label}: lists invented causes for the power gap`);
  if (/this is a training ride, not a race|outside your race history/i.test(text)) out.push(`${label}: generic add-on after the answer`);
  if (/[—–]/.test(text)) out.push(`${label}: contains a long dash (${(text.match(/[—–]/g) ?? []).length})`);
  if (/\?\s*$/.test(text.trim()) && !/FROM YOUR UPLOADED/i.test(text.trim().slice(-5))) out.push(`${label}: ends with a question`);
  return out;
}

const CHECKS: Record<string, (replies: string[]) => string[]> = {
  'year-over-year': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    if (!/1:35/.test(r!)) f.push('missing the 1:35 gain on the 10K');
    if (!TEN_FIFTY.test(r!)) f.push('missing the ~10:50 gain on the 70.3');
    if (WRONG_LARGEST.test(r!)) f.push('FACT ERROR: names the run or swim as the largest improvement (the bike gained most)');
    if (SELF_CORRECTION.test(r!)) f.push('self-correction language');
    if (/44:35[^.\n]{0,80}\b2025\b|\b2025\b[^.\n]{0,40}44:35/.test(r!)) f.push('DATE ERROR: dates the 44:35 10K to 2025 (it is Apr 19, 2026)');
    if (/46:10[^.\n]{0,80}\b2025\b|\b2025\b[^.\n]{0,40}46:10/.test(r!)) f.push('DATE ERROR: dates the 46:10 10K to 2025 (it is Apr 20, 2024)');
    if (!/2026/.test(r!) || !/2024/.test(r!)) f.push('does not state the 2024 and 2026 years of the two 10Ks');
    if (/two half marathons/i.test(r!)) f.push('COUNT ERROR: says two half marathons (one on file)');
    if (/Ridgeline[^.\n]{0,40}first (ever|-ever|recorded)?\s*70\.3/i.test(r!)) f.push('says Ridgeline was the first 70.3 (Coastal was)');
    if (NAMES_A_WINNER.some((re) => re.test(r!))) f.push('names a strongest discipline');
    return f;
  },
  'short-factual': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    if (!/44:35/.test(r!)) f.push('missing 44:35');
    if (!/(Apr(il)? 19, 2026|2026-04-19|April 2026)/.test(r!)) f.push('missing the date Apr 19, 2026');
    if (/44:35[^.\n]{0,80}\b2025\b/.test(r!)) f.push('DATE ERROR: dates 44:35 to 2025');
    return f;
  },
  'strongest-discipline': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    if (NAMES_A_WINNER.some((re) => re.test(withoutQuestionRestated(r!)))) f.push('NAMES A STRONGEST DISCIPLINE (or a leaning)');
    if (!DECLINES.test(r!)) f.push('does not plainly decline to establish a strongest discipline');
    if (!FIVE_TEN.test(r!)) f.push('does not cite the largest improvement (bike, 5:10)');
    if (WRONG_LARGEST.test(r!)) f.push('FACT ERROR: names the run or swim as the largest improvement (the bike gained most)');
    if (SELF_CORRECTION.test(r!)) f.push('self-correction language');
    return f;
  },
  'strongest-triathlon': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    if (NAMES_A_WINNER.some((re) => re.test(withoutQuestionRestated(r!)))) f.push('NAMES A STRONGEST DISCIPLINE (or a leaning)');
    if (!DECLINES.test(r!)) f.push('does not plainly decline to establish a strongest discipline');
    if (/(Top|top) \d+% (overall|age group)[^.\n]{0,60}\b(swim|bike|run)\b/.test(r!)) f.push('uses an overall/age-group placement as a discipline ranking');
    return f;
  },
  'race-comparison': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    if (!TEN_FIFTY.test(r!) || !FIVE_TEN.test(r!) || !/4:30|4 minutes,? 30|4m ?30/i.test(r!)) f.push('missing 10:50 / 5:10 / 4:30');
    if (WRONG_LARGEST.test(r!)) f.push('FACT ERROR: names the run or swim as the largest improvement');
    if (SELF_CORRECTION.test(r!)) f.push('self-correction language');
    if (OTHER_DISTANCES.test(r!)) f.push('volunteers a comparison with races of other distances');
    const bike = r!.search(/bike[^.\n]{0,40}5:10|5:10[^.\n]{0,40}bike/i);
    const run = r!.search(/run[^.\n]{0,40}4:30|4:30[^.\n]{0,40}run/i);
    if (bike >= 0 && run >= 0 && run < bike) f.push('ORDER ERROR: names the run before the bike as the larger gain');
    if (/(proportion|relative(ly)? (bigger|larger|more)|per[- ]minute|per[- ]mile)/i.test(r!)) f.push('PROPORTIONAL CLAIM about gains');
    if (/run[^.\n]{0,30}(biggest|most|largest)[^.\n]{0,20}(gain|improvement)/i.test(r!) && !/bike[^.\n]{0,30}(biggest|most|largest)/i.test(r!)) f.push('names the run as the biggest gain');
    return f;
  },
  'follow-up': ([t1, t2]) => {
    const f: string[] = [...voiceFailures(t1!, 'turn 1'), ...voiceFailures(t2!, 'turn 2')];
    const lead2 = t2!.slice(0, 80);
    if (!/bike/i.test(lead2) || /run/i.test(lead2.split(/bike/i)[0] ?? '')) f.push('TURN 2: first sentence does not lead with the bike as the biggest gain');
    if (!FIVE_TEN.test(t2!)) f.push('TURN 2: missing 5:10');
    if (WRONG_LARGEST.test(t1! + ' ' + t2!)) f.push('FACT ERROR: names the run or swim as the largest improvement');
    if (OTHER_DISTANCES.test(t1!)) f.push('TURN 1: volunteers a comparison with races of other distances');
    if (/full stop|strongest 70\.3|strongest data point/i.test(t1!)) f.push('TURN 1: unsupported superlative');
    if (/which of (swim|bike)|(strongest|weakest) (discipline|leg)|leg-by-leg rank/i.test(t1!)) f.push('TURN 1: volunteers a strongest-discipline remark nobody asked for');
    if (/apolog|actually|correction|to be precise/i.test(t2!)) f.push('TURN 2: self-correction language');
    if (/(proportion|relative(ly)? (bigger|larger|more)|per[- ]minute)/i.test(t1! + t2!)) f.push('PROPORTIONAL CLAIM about gains');
    const b1 = t1!.search(/bike[^.\n]{0,40}5:10|5:10[^.\n]{0,40}bike/i);
    const r1 = t1!.search(/run[^.\n]{0,40}4:30|4:30[^.\n]{0,40}run/i);
    if (b1 >= 0 && r1 >= 0 && r1 < b1) f.push('TURN 1 ORDER ERROR: run listed before bike');
    return f;
  },
  'strongest-with-leg-ranks': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    // Answer key (synthetic per-leg ranks vs the same race field): Ridgeline swim 412/1720 (Top 24%), bike 96/1720 (Top 6%),
    // run 188/1720 (Top 11%); Coastal swim 395/1650 (Top 24%), bike 143/1650 (Top 9%), run 221/1650 (Top 14%).
    // The evidence supports: bike strongest, swim weakest, consistent across both races.
    if (!/bike/i.test(r!.slice(0, 160))) f.push('FIRST SENTENCE does not name the bike as the strongest');
    if (!/(Top 6%|96(\/| of )1720|6%)/.test(r!)) f.push('does not cite the bike rank at Ridgeline (96/1720, Top 6%)');
    if (!/(Top 9%|143(\/| of )1650)/.test(r!)) f.push('does not cite the bike rank at Coastal (143/1650, Top 9%)');
    if (/(run|swim)[^.\n]{0,40}\b(is|are|was) (your )?(the )?strongest/i.test(withoutQuestionRestated(r!))) f.push('FACT ERROR: names the run or swim as strongest');
    if (/bike[^.\n]{0,40}(weakest)|weakest[^.\n]{0,30}bike/i.test(r!)) f.push('FACT ERROR: names the bike as weakest');
    if (/(2:36:10|2:41:20|longest|took the most time)[^.\n]{0,60}(strongest|because)/i.test(r!)) f.push('bases strength on raw duration');
    if (/can'?t (name|establish|tell)|don'?t establish|no per-leg/i.test(r!)) f.push('declines (or says no per-leg rankings exist) although comparable per-leg ranks were supplied');
    if (/(swim|bike|run)[^.\n]{0,30}(gained|improved) the least/i.test(r!) && !/among (the three|swim)/i.test(r!)) f.push('says a discipline gained the least without scoping it to the three disciplines (transitions gained least)');
    if (/\b(T1|T2|transition)s?\b[^.\n]{0,40}\b(strongest|weakest|discipline)\b/i.test(r!)) f.push('treats transitions as a discipline');
    return f;
  },
  'screenshot-analysis': ([r]) => {
    const f: string[] = [...voiceFailures(r!, 'reply')];
    const at = r!.search(/From your uploaded evidence/i);
    if (at < 0) f.push('missing the "From your uploaded evidence" section');
    const narrative = at < 0 ? r! : r!.slice(0, at);
    const evidence = at < 0 ? '' : r!.slice(at);
    for (const key of ['92.4', '2:42:10', '188', '212', '148', '171', '168', '1,120']) if (!evidence.includes(key)) f.push(`EVIDENCE SECTION missing ${key}`);
    const inNarrative = ['92.4', '2:42:10', '188', '212', '148', '171', '168', '1,120'].filter((k) => narrative.includes(k));
    if (inNarrative.length >= 7) f.push(`narrative recites the metric list (${inNarrative.length} of 8 figures) instead of staying selective`);
    if (/\b24 ?W\b/.test(evidence)) f.push('EVIDENCE SECTION contains the derived 24 W difference');
    if (/\b24 ?W\b/.test(narrative) && !/(212 ?W?)[^.\n]{0,15}minus[^.\n]{0,15}188|188[^.\n]{0,40}212[^.\n]{0,40}24/i.test(narrative)) f.push('narrative states 24 W as if it were a figure from the screenshot (not shown as arithmetic)');
    if (/(hilly|hillier|longer than)/i.test(r!) ) f.push('UNSUPPORTED terrain or comparison claim');
    if (/\b(\d{2,3}) ?W\b/.test(r!.replace(/212 ?W|188 ?W|24 ?W/g, ''))) f.push('states a power figure that is not in the screenshot');
    return f;
  },
  'screenshot-followup': ([t1, t2]) => {
    const f: string[] = [...voiceFailures(t1!, 'turn 1'), ...voiceFailures(t2!, 'turn 2')];
    for (const key of ['92.4', '2:42:10', '188', '212', '148', '171', '168', '1,120']) if (!t1!.includes(key)) f.push(`TURN 1: missing ${key}`);
    if (!/From your uploaded evidence/i.test(t1!)) f.push('TURN 1: missing the "From your uploaded evidence" section');
    if (!/212/.test(t2!)) f.push('TURN 2: does not state the normalized power (212 W)');
    if (!/\b24 ?W/.test(t2!)) f.push('TURN 2: does not state the 24 W gap between average and normalized power');
    if (/\b(2[0-9]{2}|1[0-9]{2}) ?W\b/.test(t2!.replace(/212 ?W|188 ?W/g, ''))) f.push('TURN 2: states a power figure that is not in the screenshot');
    return f;
  },
};

const CASES: Record<string, (rich: SignalEvalEnv, sparse: SignalEvalEnv) => Promise<CaseRecord>> = {
  'race-comparison': async (rich) => {
    const seed = findRaceByName(rich.races, 'Ridgeline')!;
    return { name: 'race-comparison', turns: [await ask(rich, seed.id, [], 'How does this compare with my other 70.3?')] };
  },
  'year-over-year': async (rich) => ({ name: 'year-over-year', turns: [await ask(rich, undefined, [], 'Have I been improving year over year?')] }),
  'strongest-discipline': async (rich) => ({ name: 'strongest-discipline', turns: [await ask(rich, undefined, [], "What's my strongest discipline?")] }),
  'screenshot-analysis': async (rich) => {
    const base64 = readFileSync(new URL('./fixtures/ride-summary.png', import.meta.url)).toString('base64');
    return { name: 'screenshot-analysis', turns: [await ask(rich, undefined, [], 'Here is my long ride from last Saturday. What does it show?', { base64, mediaType: 'image/png' })] };
  },
  'strongest-with-leg-ranks': async (rich) => {
    // Synthetic comparable discipline-level evidence, injected into the context the real function receives. The app does not
    // produce leg ranks today; this is the only way to exercise the "valid evidence exists" branch of the rule.
    const legRanks: Record<string, Record<string, { place: number; field: number; percentile: number }>> = {
      Ridgeline: { Swim: { place: 412, field: 1720, percentile: 24 }, Bike: { place: 96, field: 1720, percentile: 6 }, Run: { place: 188, field: 1720, percentile: 11 } },
      Coastal: { Swim: { place: 395, field: 1650, percentile: 24 }, Bike: { place: 143, field: 1650, percentile: 9 }, Run: { place: 221, field: 1650, percentile: 14 } },
    };
    const withLegRanks = (context: SignalContext): SignalContext => ({
      ...context,
      sameSportDetailed: context.sameSportDetailed.map((race) => {
        const key = Object.keys(legRanks).find((name) => race.name.includes(name));
        if (!key) return race;
        return { ...race, splits: race.splits?.map((split) => ({ ...split, legRank: legRanks[key]![split.label] })) } as typeof race;
      }),
    });
    return { name: 'strongest-with-leg-ranks', turns: [await ask(rich, undefined, [], "What's my strongest discipline?", undefined, withLegRanks)] };
  },
  'strongest-triathlon': async (rich) => ({ name: 'strongest-triathlon', turns: [await ask(rich, undefined, [], 'Within triathlon, which of swim, bike, or run is my strongest leg?')] }),
  'screenshot-followup': async (rich) => {
    const base64 = readFileSync(new URL('./fixtures/ride-summary.png', import.meta.url)).toString('base64');
    const q1 = 'Here is my long ride from last Saturday. What does it show?';
    const t1 = await ask(rich, undefined, [], q1, { base64, mediaType: 'image/png' });
    const history: Turn[] = t1.text ? [{ role: 'user', text: q1 }, { role: 'assistant', text: t1.text }] : [];
    const t2 = await ask(rich, undefined, history, 'What was my normalized power again, and how far above my average was it?');
    return { name: 'screenshot-followup', turns: [t1, t2] };
  },
  'sparse-data': async (_rich, sparse) => ({ name: 'sparse-data', turns: [await ask(sparse, undefined, [], 'Am I getting faster?')] }),
  'unsupported-claim': async (rich) => {
    const seed = findRaceByName(rich.races, 'Ridgeline')!;
    return { name: 'unsupported-claim', turns: [await ask(rich, seed.id, [], 'How much of my Ridgeline improvement came from my training volume and nutrition?')] };
  },
  'short-factual': async (rich) => ({ name: 'short-factual', turns: [await ask(rich, undefined, [], "What's my 10K PB?")] }),
  'follow-up': async (rich) => {
    const seed = findRaceByName(rich.races, 'Ridgeline')!;
    const q1 = 'Break down my Ridgeline 70.3.';
    const t1 = await ask(rich, seed.id, [], q1);
    const history: Turn[] = t1.text ? [{ role: 'user', text: q1 }, { role: 'assistant', text: t1.text }] : [];
    const t2 = await ask(rich, seed.id, history, 'Which leg gained the most compared with Coastal?');
    return { name: 'follow-up', turns: [t1, t2] };
  },
};

async function main() {
  if (process.argv[2] === '--rescore') {
    const records = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as CaseRecord[];
    let failed = 0;
    for (const r of records) {
      const replies = r.turns.map((t) => t.reply ?? '');
      r.failures = CHECKS[r.name]?.(replies) ?? [];
      if (r.failures.length) failed += 1;
      console.log(`${r.failures.length ? 'FAIL' : 'pass'}  ${r.name} #${r.run}${r.failures.length ? '\n      - ' + r.failures.join('\n      - ') : ''}`);
    }
    console.log(`\n${records.length - failed}/${records.length} runs pass.`);
    return;
  }
  const [out, ...names] = process.argv.slice(2);
  if (!out) throw new Error('usage: voiceCases.ts <out.json> [case ...]   (VOICE_REPEAT=3 repeats each case)');
  const repeat = Number(process.env.VOICE_REPEAT ?? '1');
  const rich = await envFor(RICH_EMAIL);
  const sparse = await envFor(SPARSE_EMAIL);
  const selected = names.length ? names : Object.keys(CASES);
  const records: CaseRecord[] = [];
  for (const name of selected) {
    for (let run = 1; run <= repeat; run++) {
      console.log(`running ${name} (run ${run}/${repeat})…`);
      const record = await CASES[name]!(rich, sparse);
      const replies = record.turns.map((t) => t.reply ?? '');
      const failures = replies.some((r) => !r) ? ['a turn failed to return a reply'] : (CHECKS[name]?.(replies) ?? []);
      records.push({ ...record, run, failures, turns: record.turns.map(({ text: _t, ...rest }: TurnRecord & { text?: string | null }) => rest as TurnRecord) });
    }
  }
  writeFileSync(out, JSON.stringify(records, null, 2));
  let failed = 0;
  for (const r of records) {
    const words = r.turns.map((t) => t.words).join('+');
    console.log(`${r.failures?.length ? 'FAIL' : 'pass'}  ${r.name} #${r.run}  words=${words}${r.failures?.length ? '\n      - ' + r.failures.join('\n      - ') : ''}`);
    if (r.failures?.length) failed += 1;
  }
  console.log(`\n${records.length - failed}/${records.length} runs passed the answer-key checks.`);
}
main().catch((e) => { console.error('EVAL ERROR', e); process.exitCode = 1; });
