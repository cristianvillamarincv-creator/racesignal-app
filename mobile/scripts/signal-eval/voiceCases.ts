// Developer-only Signal VOICE evaluation (not part of the app; same exclusions as harness.ts). Runs a fixed set of
// cases against the REAL deployed `signal` Edge Function with two SYNTHETIC dev athletes seeded by
// supabase/dev/seed-signal-eval.mjs (fixed facts, so every case has a known answer key), and writes every reply plus
// cheap mechanical metrics to a JSON file for side-by-side comparison. A human (or reviewer) reads the replies; the
// metrics only flag mechanical voice problems (length, em dashes, stock phrases, headings), never correctness.
//
//   SUPABASE_SERVICE_ROLE_KEY=... npx tsx --env-file=.env.development scripts/signal-eval/voiceCases.ts out.json [case ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchTestAthleteRaces, findRaceByName, mintTestSession, sendTurn, type SignalEvalEnv, type Turn } from './harness';

const RICH_EMAIL = 'signal.eval@example.com';
const SPARSE_EMAIL = 'signal.eval.sparse@example.com';

interface TurnRecord { message: string; reply: string | null; failure?: string; words: number; emDashes: number; stockPhrases: string[]; headings: boolean; ms: number }
interface CaseRecord { name: string; turns: TurnRecord[] }

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

async function ask(env: SignalEvalEnv, seedRaceId: string | undefined, history: Turn[], message: string, image?: { base64: string; mediaType: string }): Promise<TurnRecord & { text: string | null }> {
  const r = await sendTurn(env, seedRaceId, history, message, image);
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
  const [out, ...names] = process.argv.slice(2);
  if (!out) throw new Error('usage: voiceCases.ts <out.json> [case ...]');
  const rich = await envFor(RICH_EMAIL);
  const sparse = await envFor(SPARSE_EMAIL);
  const selected = names.length ? names : Object.keys(CASES);
  const records: CaseRecord[] = [];
  for (const name of selected) {
    console.log(`running ${name}…`);
    const record = await CASES[name]!(rich, sparse);
    records.push({ ...record, turns: record.turns.map(({ text: _t, ...rest }: TurnRecord & { text?: string | null }) => rest as TurnRecord) });
  }
  writeFileSync(out, JSON.stringify(records, null, 2));
  for (const r of records) for (const t of r.turns) console.log(`${r.name}: words=${t.words} emDashes=${t.emDashes} stock=${t.stockPhrases.length} headings=${t.headings}${t.failure ? ' FAILED ' + t.failure : ''}`);
}
main().catch((e) => { console.error('EVAL ERROR', e); process.exitCode = 1; });
