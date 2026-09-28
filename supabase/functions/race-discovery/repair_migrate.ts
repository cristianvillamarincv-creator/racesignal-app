// B.12 existing-data repair for the split-classification fix in normalize.ts. NOT executed as
// part of this change — this is the reviewable script for a separate, explicitly-approved run.
//
// Scope, by design:
//  - Touches ONLY the `splits` column of `races` rows already identified as affected (generic
//    "Checkpoint N"/"Finish" splits on a triathlon/duathlon row). Every other column — athlete_id,
//    finish_seconds, overall/gender/age-group rank+field, bib, manual entries, import_status,
//    checklist_completed — is never read for a write and never appears in the UPDATE payload.
//  - Only ever WIDENS what's known: a race is only updated when the freshly re-parsed result
//    actually produces a real Swim/T1/Bike/T2/Run classification. A race that still can't be
//    classified (ambiguous provider shape) is left exactly as it is — never forced into a guess.
//  - Atomic, database-enforced concurrency guard: every write (apply OR rollback) is a single
//    PATCH whose URL filter includes `updated_at=eq.<the value this script last read>` — Postgres
//    evaluates that condition and performs the write in one indivisible statement, so there is no
//    window in which a concurrent change (the athlete editing/removing/re-importing this exact
//    race) can be missed. `Prefer: return=representation` is used so the response itself proves
//    whether the row actually matched (array of 1) or was skipped (empty array) — never inferred
//    from a separate, earlier read. A prior version of this script instead read the row, compared
//    in application code, and then issued an *unconditional* write — that comparison-then-write
//    gap was not atomic and could not actually guarantee anything about a concurrent change; this
//    version's guarantee comes entirely from the database evaluating the WHERE clause and the PATCH
//    together, in one round trip.
//  - Full rollback data: before any write, every row's OLD *and* NEW `splits` value, plus the
//    `updated_at` this script observed both before and immediately after its own write, is written
//    to a timestamped JSON backup file — `--rollback` uses the post-write `updated_at` as its own
//    atomic guard, so it can only ever restore a row that still holds exactly what this repair
//    wrote, never a row a later change has since touched.
//
// Modes (all read the same identification query; nothing runs by default):
//   deno run --allow-net --allow-read --allow-write --allow-env repair_migrate.ts --preview
//     Read-only. Prints the same before/after diff as repair_preview.ts, using the real Supabase
//     REST API (service role) instead of a static JSON dump. Writes nothing, not even a backup file.
//
//   deno run --allow-net --allow-read --allow-write --allow-env repair_migrate.ts --apply
//     Writes the backup file, then applies only the rows that would be genuinely repaired. Requires
//     SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. Requires explicit human
//     confirmation (see CONFIRM_APPLY below) — this is intentionally not a single innocuous flag.
//
//   deno run --allow-net --allow-read --allow-write --allow-env repair_migrate.ts --rollback <backup.json>
//     Replays a previous --apply run's backup file, restoring every affected row's OLD `splits`
//     value exactly. Idempotent — safe to run more than once against the same backup file.

import { parseSingleResultDetail } from './normalize.ts';
import type { RawSingleResult } from './sportstatsClient.ts';

type Splits = { label: string; splitSeconds?: number; totalSeconds: number; pace?: string }[] | null;

interface RaceRow {
  id: string;
  athlete_id: string;
  event_name: string;
  category: string | null;
  sport: string | null;
  provider: string | null;
  bib: string | null;
  provider_result_id: string | null;
  import_status: string;
  splits: Splits;
  updated_at: string;
}

function splitsDeepEqual(a: Splits, b: Splits): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const USER_AGENT = 'RaceSignal-B1/0.1 (private beta; see repo owner for contact)';

function requireEnv(): { url: string; key: string } {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.');
    Deno.exit(1);
  }
  return { url: SUPABASE_URL, key: SERVICE_ROLE_KEY };
}

async function fetchAffectedRaces(): Promise<RaceRow[]> {
  const { url, key } = requireEnv();
  const res = await fetch(
    `${url}/rest/v1/races?sport=in.(triathlon,duathlon)&provider=eq.sportstats&select=id,athlete_id,event_name,category,sport,provider,bib,provider_result_id,import_status,splits,updated_at`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Failed to list races: HTTP ${res.status}`);
  const rows = (await res.json()) as RaceRow[];
  return rows.filter((r) => isFallbackShape(r.splits));
}

function isFallbackShape(splits: RaceRow['splits']): boolean {
  if (!splits || splits.length === 0) return false;
  const primary = new Set(['Swim', 'T1', 'Bike', 'T2', 'Run']);
  const allGeneric = splits.every((s) => /^Checkpoint \d+$/.test(s.label) || s.label === 'Finish');
  const anyPrimary = splits.some((s) => primary.has(s.label));
  return allGeneric && !anyPrimary;
}

async function fetchRawByBib(rid: string, bib: string): Promise<RawSingleResult | null> {
  const url = `https://public.sportstats.one/getsingleresult?rid=${encodeURIComponent(rid)}&potype=bib&poid=${encodeURIComponent(bib)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as RawSingleResult;
  } catch {
    return null;
  }
}

interface RepairCandidate {
  race: RaceRow;
  newSplits: RaceRow['splits'];
}

async function computeRepairs(races: RaceRow[]): Promise<RepairCandidate[]> {
  const out: RepairCandidate[] = [];
  for (const race of races) {
    if (!race.provider_result_id || !race.bib) continue;
    const raw = await fetchRawByBib(race.provider_result_id, race.bib);
    if (!raw) continue;
    let detail;
    try {
      detail = parseSingleResultDetail(raw, race.category ?? undefined);
    } catch {
      continue;
    }
    // Only ever an improvement: skip anything that isn't now a real 5-row classification.
    const isNowClassified =
      detail.splits.length === 5 && ['Swim', 'T1', 'Bike', 'T2', 'Run'].every((l, i) => detail.splits[i]?.label === l);
    if (isNowClassified) out.push({ race, newSplits: detail.splits });
    await new Promise((r) => setTimeout(r, 250)); // polite to the shared public endpoint
  }
  return out;
}

async function runPreview() {
  const races = await fetchAffectedRaces();
  console.log(`${races.length} affected row(s) found. Computing repairs (read-only, no writes)...\n`);
  const repairs = await computeRepairs(races);
  for (const r of repairs) {
    console.log(`- ${r.race.event_name} (${r.race.id}): ${r.race.splits?.length ?? 0} generic rows -> Swim/T1/Bike/T2/Run`);
  }
  console.log(`\n${repairs.length} of ${races.length} would be repaired. Nothing was written.`);
}

/** The one write primitive both apply and rollback use: a SINGLE PATCH whose URL filter pins
 *  `id` AND `updated_at` to the exact value this script most recently observed. Postgres evaluates
 *  that WHERE clause and performs the UPDATE together, as one statement — there is no separate
 *  "check, then write" step for a concurrent change to slip through. `Prefer: return=representation`
 *  makes the response itself the source of truth for whether it matched: an empty array means the
 *  row's `updated_at` had already moved (someone else touched it) and NOTHING was written; a single
 *  returned row means the write applied, and its own `updated_at` is handed back so the caller can
 *  record exactly what a later rollback must match against.
 */
async function atomicConditionalWrite(
  url: string,
  key: string,
  id: string,
  expectedUpdatedAt: string,
  newSplits: Splits,
): Promise<{ outcome: 'applied'; updatedAt: string } | { outcome: 'conflict' } | { outcome: 'error'; status: number }> {
  const newUpdatedAt = new Date().toISOString();
  const res = await fetch(
    `${url}/rest/v1/races?id=eq.${id}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}&select=updated_at`,
    {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ splits: newSplits, updated_at: newUpdatedAt }),
    },
  );
  if (!res.ok) return { outcome: 'error', status: res.status };
  const rows = (await res.json()) as { updated_at: string }[];
  if (rows.length === 0) return { outcome: 'conflict' };
  return { outcome: 'applied', updatedAt: rows[0]!.updated_at };
}

interface BackupEntry {
  id: string;
  eventName: string;
  oldSplits: Splits;
  newSplits: Splits;
  updatedAtBeforeApply: string;
  /** The value this repair itself wrote — a future `--rollback`'s atomic guard. Absent only in
   *  backups produced by the pre-fix version of this script (see the compatibility note below). */
  updatedAtAfterApply?: string;
}

async function runApply() {
  const CONFIRM_APPLY = Deno.env.get('CONFIRM_APPLY');
  if (CONFIRM_APPLY !== 'yes-repair-production-splits') {
    console.error(
      'Refusing to apply: set CONFIRM_APPLY=yes-repair-production-splits in the environment for this run, ' +
        'as an explicit, separate confirmation beyond the --apply flag.',
    );
    Deno.exit(1);
  }
  const { url, key } = requireEnv();
  const races = await fetchAffectedRaces();
  const repairs = await computeRepairs(races);

  // Written BEFORE any PATCH, using only what was read during preview/compute — updatedAtAfterApply
  // is filled in per-row, right after that row's own write actually succeeds.
  const backupPath = `repair_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backup: BackupEntry[] = repairs.map((r) => ({
    id: r.race.id,
    eventName: r.race.event_name,
    oldSplits: r.race.splits,
    newSplits: r.newSplits,
    updatedAtBeforeApply: r.race.updated_at,
  }));
  await Deno.writeTextFile(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backup of ${backup.length} row(s)' old + new splits written to ${backupPath} before any write.`);

  let applied = 0;
  let skippedConflict = 0;
  let failed = 0;
  for (let i = 0; i < repairs.length; i++) {
    const r = repairs[i]!;
    const result = await atomicConditionalWrite(url, key, r.race.id, r.race.updated_at, r.newSplits);
    if (result.outcome === 'applied') {
      applied++;
      backup[i]!.updatedAtAfterApply = result.updatedAt;
    } else if (result.outcome === 'conflict') {
      console.log(`  SKIP ${r.race.event_name} (${r.race.id}): updated_at changed since this repair was previewed — not overwriting.`);
      skippedConflict++;
    } else {
      console.log(`  FAILED ${r.race.event_name} (${r.race.id}): HTTP ${result.status}`);
      failed++;
    }
  }
  // Re-persist with each row's actual post-write updated_at now filled in, so the backup file that
  // survives on disk is the complete, rollback-ready one.
  await Deno.writeTextFile(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nApplied: ${applied}. Skipped (conflict): ${skippedConflict}. Failed: ${failed}. Rollback file: ${backupPath}`);
}

async function runRollback(backupPath: string) {
  const { url, key } = requireEnv();
  const backup = JSON.parse(await Deno.readTextFile(backupPath)) as BackupEntry[];
  let restored = 0;
  let skipped = 0;
  for (const row of backup) {
    let expectedUpdatedAt = row.updatedAtAfterApply;
    if (!expectedUpdatedAt) {
      // Compatibility path for a backup written before this fix (no updatedAtAfterApply on disk —
      // exactly the file from the already-completed, already-verified 18-row repair). The write
      // below is still fully atomic: Postgres evaluates the id+updated_at WHERE clause and performs
      // the UPDATE as one statement. What's different from the normal path is only *where* the
      // comparison value came from — read fresh, right here, immediately before that one atomic
      // write — not that the write itself is any less conditional or any less atomic.
      const current = await fetch(`${url}/rest/v1/races?id=eq.${row.id}&select=splits,updated_at`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!current.ok) {
        console.log(`  SKIP ${row.eventName} (${row.id}): could not read current state (HTTP ${current.status}).`);
        skipped++;
        continue;
      }
      const rows = (await current.json()) as { splits: Splits; updated_at: string }[];
      if (rows.length === 0) {
        console.log(`  SKIP ${row.eventName} (${row.id}): row no longer exists.`);
        skipped++;
        continue;
      }
      if (!splitsDeepEqual(rows[0]!.splits, row.newSplits)) {
        console.log(`  SKIP ${row.eventName} (${row.id}): splits no longer match what this repair wrote — a later change would be overwritten.`);
        skipped++;
        continue;
      }
      expectedUpdatedAt = rows[0]!.updated_at;
    }

    const result = await atomicConditionalWrite(url, key, row.id, expectedUpdatedAt, row.oldSplits);
    if (result.outcome === 'applied') restored++;
    else if (result.outcome === 'conflict') {
      console.log(`  SKIP ${row.eventName} (${row.id}): row changed again between the pre-check and the write — not overwriting.`);
      skipped++;
    } else {
      console.log(`  FAILED ${row.eventName} (${row.id}): HTTP ${result.status}`);
      skipped++;
    }
  }
  console.log(`\nRestored ${restored} of ${backup.length} row(s) from ${backupPath}. Skipped: ${skipped}.`);
}

const mode = Deno.args[0];
if (mode === '--preview') await runPreview();
else if (mode === '--apply') await runApply();
else if (mode === '--rollback') await runRollback(Deno.args[1]);
else {
  console.error('Usage: repair_migrate.ts --preview | --apply | --rollback <backup.json>');
  Deno.exit(1);
}
