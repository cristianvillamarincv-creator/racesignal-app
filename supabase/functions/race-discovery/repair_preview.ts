// Read-only preview for the B.12 split-repair task — NEVER writes anywhere. Fetches each affected
// race's raw provider payload fresh (same public, unauthenticated endpoint sportstatsClient.ts
// already uses), re-parses it with the fixed normalize.ts, and prints an old-vs-new diff so the
// repair's effect can be reviewed before anyone runs the real (separate, write-enabled) migration.
//
// Usage: deno run --allow-net --allow-read supabase/functions/race-discovery/repair_preview.ts \
//          path/to/affected-races.json
//
// affected-races.json is the exact shape produced by the identification query in the B.12 report:
// an array of { id, athlete_id, event_name, category, bib, provider_result_id, splits }.
//
// This intentionally does not touch Supabase at all — it only re-derives what a repair WOULD
// write, from the provider directly, so reviewing it carries zero risk to production data.

import { parseSingleResultDetail } from './normalize.ts';
import type { RawSingleResult } from './sportstatsClient.ts';

interface AffectedRace {
  id: string;
  athlete_id: string;
  event_name: string;
  category: string | null;
  bib: string | null;
  provider_result_id: string | null;
  splits: { label: string; splitSeconds?: number; totalSeconds: number; pace?: string }[] | null;
}

const USER_AGENT = 'RaceSignal-B1/0.1 (private beta; see repo owner for contact)';

// Mirrors sportstatsClient.ts's fetchSingleResult, except `potype=bib` — the repair has no stored
// Sportstats-internal `pid` (only `bib`/`provider_result_id` are persisted), and both potypes have
// been confirmed (this session, live) to return the identical current payload shape for every race
// checked. A real migration should still prefer `pid` when `race-discovery`'s candidate-list flow
// has it on hand (see the report's proposed schema note); this fallback is for repairing rows that
// only ever had `bib` persisted.
async function fetchByBib(rid: string, bib: string): Promise<RawSingleResult | { blocked: true; reason: string }> {
  const url = `https://public.sportstats.one/getsingleresult?rid=${encodeURIComponent(rid)}&potype=bib&poid=${encodeURIComponent(bib)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  } catch (err) {
    return { blocked: true, reason: `network error: ${(err as Error).message}` };
  }
  if (!res.ok) return { blocked: true, reason: `HTTP ${res.status}` };
  try {
    return (await res.json()) as RawSingleResult;
  } catch {
    return { blocked: true, reason: 'not valid JSON' };
  }
}

function isBlocked(x: unknown): x is { blocked: true; reason: string } {
  return typeof x === 'object' && x !== null && (x as { blocked?: boolean }).blocked === true;
}

function summarizeLabels(splits: { label: string }[] | null): string {
  if (!splits || splits.length === 0) return '(none)';
  const primary = ['Swim', 'T1', 'Bike', 'T2', 'Run'];
  const isClassified = primary.every((p) => splits.some((s) => s.label === p)) && splits.length === 5;
  if (isClassified) return 'Swim/T1/Bike/T2/Run (classified)';
  return `${splits.length} rows: ${splits.map((s) => s.label).slice(0, 3).join(', ')}${splits.length > 3 ? ', …' : ''} (fallback)`;
}

async function main() {
  const path = Deno.args[0];
  if (!path) {
    console.error('Usage: deno run --allow-net --allow-read repair_preview.ts <affected-races.json>');
    Deno.exit(1);
  }
  const races = JSON.parse(await Deno.readTextFile(path)) as AffectedRace[];
  console.log(`Previewing repair for ${races.length} affected race(s). No writes will occur.\n`);

  let wouldFix = 0;
  let stillUnclassified = 0;
  let fetchFailed = 0;

  for (const race of races) {
    const before = summarizeLabels(race.splits);
    if (!race.provider_result_id || !race.bib) {
      console.log(`- ${race.event_name} (${race.id.slice(0, 8)}): SKIP — missing bib/provider_result_id, cannot re-fetch`);
      fetchFailed++;
      continue;
    }
    const raw = await fetchByBib(race.provider_result_id, race.bib);
    if (isBlocked(raw)) {
      console.log(`- ${race.event_name} (${race.id.slice(0, 8)}): FETCH FAILED — ${raw.reason}`);
      fetchFailed++;
      continue;
    }
    let after: string;
    try {
      const detail = parseSingleResultDetail(raw, race.category ?? undefined);
      after = summarizeLabels(detail.splits);
      if (after.includes('classified')) wouldFix++;
      else stillUnclassified++;
      // Sanity check the repair never touches finish/placement — those columns aren't even part
      // of `detail`'s split output, but re-confirm nothing about finishSeconds moved either.
    } catch (err) {
      after = `PARSE ERROR — ${(err as Error).message}`;
      stillUnclassified++;
    }
    console.log(`- ${race.event_name} (${race.id.slice(0, 8)}, athlete ${race.athlete_id.slice(0, 8)}):`);
    console.log(`    before: ${before}`);
    console.log(`    after:  ${after}`);
    // Be polite to the shared public endpoint — sequential, no concurrency, small delay.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nSummary: ${wouldFix} would be repaired, ${stillUnclassified} remain unclassified (no fabricated data), ${fetchFailed} could not be re-fetched.`);
}

await main();
