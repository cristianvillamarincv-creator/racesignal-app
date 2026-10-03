#!/usr/bin/env node
// Seeds the DEVELOPMENT Supabase project with two SYNTHETIC athletes used only by the Signal voice evaluation
// (mobile/scripts/signal-eval/voiceCases.ts): a rich fixture athlete and a sparse (one race) athlete. Fixed facts
// on purpose, so every evaluation case has known right answers. Never reads production data.
//
//   DEV_SUPABASE_URL=... DEV_SERVICE_ROLE_KEY=... node supabase/dev/seed-signal-eval.mjs
//
// Same dev-only guard as seed-dev.mjs. Prints the two user ids (not secrets). Idempotent: reseeds each athlete's races.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const devRef = JSON.parse(readFileSync(join(here, '../../mobile/config/environments.json'), 'utf8')).development.supabaseProjectRef;
const url = process.env.DEV_SUPABASE_URL ?? '';
const key = process.env.DEV_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Set DEV_SUPABASE_URL and DEV_SERVICE_ROLE_KEY (never commit them).'); process.exit(1); }
if (new URL(url).hostname !== `${devRef}.supabase.co`) { console.error(`Refusing: not the development project (${devRef}).`); process.exit(1); }

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function call(method, path, body, extra = {}) {
  const res = await fetch(`${url}${path}`, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const sec = (h, m, s) => h * 3600 + m * 60 + s;
const leg = (label, split, total) => ({ label, splitSeconds: split, totalSeconds: total });
function tri(sw, t1, bk, t2, rn) {
  return [leg('Swim', sw, sw), leg('T1', t1, sw + t1), leg('Bike', bk, sw + t1 + bk), leg('T2', t2, sw + t1 + bk + t2), leg('Run', rn, sw + t1 + bk + t2 + rn)];
}
const base = (athlete, n, o) => ({
  athlete_id: athlete, import_status: 'confirmed', race_status: 'completed', provider: 'sportstats', provider_result_id: `eval-${n}`,
  provider_athlete_name: 'Eval Athlete', import_method: 'discovery_automated', date_precision: 'day', location: 'Synthetic City',
  source_notes: ['Synthetic evaluation data'], age_group_category: 'M35-39', ...o,
});

// Fixed facts (the evaluation's answer key):
//  70.3: Coastal 2025 5:09:40 (swim 36:40, bike 2:41:20, run 1:46:00) -> Ridgeline 2026 4:58:50 (swim 35:50, bike 2:36:10, run 1:41:30) = 10:50 faster
//        (bike 5:10, run 4:30, swim 0:50, T1 0:10, T2 0:10). 10K: Riverside 2024 46:10 -> 2026 44:35 = 1:35 faster.
export function richRaces(a) {
  const s = (n, name, cat, sport, date, splits, finish, r) =>
    base(a, n, { event_name: name, category: cat, sport, event_date: date, event_year: Number(date.slice(0, 4)), splits, finish_seconds: finish, ...r });
  const rows = [
    s(1, 'Harbor Sprint Triathlon', 'Sprint Triathlon', 'triathlon', '2024-06-09', tri(sec(0, 13, 10), 95, sec(0, 38, 40), 65, sec(0, 21, 30)), sec(1, 16, 0),
      { overall_rank_place: 52, overall_rank_field: 310, age_group_rank_place: 6, age_group_rank_field: 41 }),
    s(2, 'Lakeview Olympic Triathlon', 'Olympic Triathlon', 'triathlon', '2025-07-12', tri(sec(0, 25, 20), 120, sec(1, 6, 30), 80, sec(0, 43, 10)), sec(2, 18, 20),
      { overall_rank_place: 61, overall_rank_field: 420, age_group_rank_place: 4, age_group_rank_field: 55 }),
    s(3, 'Coastal 70.3', '70.3', 'triathlon', '2025-09-14', tri(sec(0, 36, 40), 190, sec(2, 41, 20), 150, sec(1, 46, 0)), sec(5, 9, 40),
      { overall_rank_place: 240, overall_rank_field: 1650, age_group_rank_place: 28, age_group_rank_field: 210 }),
    s(4, 'Ridgeline 70.3', '70.3', 'triathlon', '2026-06-14', tri(sec(0, 35, 50), 180, sec(2, 36, 10), 140, sec(1, 41, 30)), sec(4, 58, 50),
      { overall_rank_place: 175, overall_rank_field: 1720, age_group_rank_place: 17, age_group_rank_field: 198 }),
    s(5, 'Riverside 10K', '10km', 'running', '2024-04-20', [], sec(0, 46, 10), { overall_rank_place: 142, overall_rank_field: 2050, age_group_rank_place: 15, age_group_rank_field: 190 }),
    s(6, 'Riverside 10K', '10km', 'running', '2026-04-19', [], sec(0, 44, 35), { overall_rank_place: 98, overall_rank_field: 2210, age_group_rank_place: 9, age_group_rank_field: 205 }),
    s(7, 'Spring Half Marathon', 'Half Marathon', 'running', '2025-10-05', [], sec(1, 39, 20), { overall_rank_place: 311, overall_rank_field: 3900, age_group_rank_place: 34, age_group_rank_field: 380 }),
  ];
  rows.push({ athlete_id: a, import_status: 'confirmed', race_status: 'registered', provider: 'manual', provider_result_id: null, import_method: 'manual_entry',
    event_date: '2027-04-17', event_year: 2027, date_precision: 'day', event_name: 'Desert IRONMAN', category: 'Ironman', sport: 'triathlon', location: 'Synthetic City', checklist_completed: [] });
  return rows;
}
export function sparseRaces(a) {
  return [base(a, 1, { event_name: 'Parkside 5K', category: '5km', sport: 'running', event_date: '2026-05-03', event_year: 2026, splits: [], finish_seconds: sec(0, 24, 10),
    overall_rank_place: 210, overall_rank_field: 640, age_group_rank_place: 31, age_group_rank_field: 90 })];
}

async function ensureAthlete(email, name, rowsFn) {
  const list = await call('GET', '/auth/v1/admin/users?per_page=200');
  let user = (list.users ?? []).find((u) => u.email === email);
  if (!user) user = await call('POST', '/auth/v1/admin/users', { email, email_confirm: true });
  const now = new Date().toISOString();
  await call('POST', '/rest/v1/athlete_profiles?on_conflict=id', { id: user.id, racing_name: name, birth_year: 1988, onboarding_completed_at: now, initial_paywall_seen_at: now }, { Prefer: 'resolution=merge-duplicates' });
  await call('DELETE', `/rest/v1/races?athlete_id=eq.${user.id}`);
  const rows = rowsFn(user.id);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  await call('POST', '/rest/v1/races', rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? (k === 'checklist_completed' ? [] : null)]))));
  console.log(`${email}: user ${user.id}, ${rows.length} races`);
}
await ensureAthlete('signal.eval@example.com', 'Eval Athlete', richRaces);
await ensureAthlete('signal.eval.sparse@example.com', 'Sparse Athlete', sparseRaces);
