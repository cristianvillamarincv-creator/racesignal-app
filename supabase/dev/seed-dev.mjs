#!/usr/bin/env node
// Seeds the RaceSignal DEVELOPMENT Supabase project with ONE synthetic athlete and synthetic races.
// Safety: refuses to run unless DEV_SUPABASE_URL belongs to the development project listed in
// mobile/config/environments.json. Never reads or copies production data. No credentials are
// stored in this file: the service-role key comes from the environment, and the dev account's
// password is generated into ~/.racesignal-dev/dev-account-password (mode 600) if not provided.
//
//   DEV_SUPABASE_URL=... DEV_SERVICE_ROLE_KEY=... node supabase/dev/seed-dev.mjs [--reset]
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envs = JSON.parse(readFileSync(join(here, '../../mobile/config/environments.json'), 'utf8'));
const devRef = envs.development.supabaseProjectRef;

const url = process.env.DEV_SUPABASE_URL ?? '';
const serviceKey = process.env.DEV_SERVICE_ROLE_KEY ?? '';
if (!url || !serviceKey) {
  console.error('Set DEV_SUPABASE_URL and DEV_SERVICE_ROLE_KEY (never commit them).');
  process.exit(1);
}
if (new URL(url).hostname !== `${devRef}.supabase.co`) {
  console.error(`Refusing to run: DEV_SUPABASE_URL is not the development project (${devRef}).`);
  process.exit(1);
}

const EMAIL = process.env.DEV_ACCOUNT_EMAIL ?? 'dev.athlete@example.com';
const secretDir = join(homedir(), '.racesignal-dev');
const pwPath = join(secretDir, 'dev-account-password');
let password = process.env.DEV_ACCOUNT_PASSWORD;
if (!password) {
  mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  if (existsSync(pwPath)) password = readFileSync(pwPath, 'utf8').trim();
  else {
    password = randomBytes(18).toString('base64url');
    writeFileSync(pwPath, password + '\n', { mode: 0o600 });
    chmodSync(pwPath, 0o600);
  }
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
async function call(method, path, body, extra = {}) {
  const res = await fetch(`${url}${path}`, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// 1. Dedicated synthetic dev account (email-confirmed so password sign-in works immediately).
let userId;
const list = await call('GET', `/auth/v1/admin/users?per_page=200`);
const existing = (list.users ?? []).find((u) => u.email === EMAIL);
if (existing) {
  userId = existing.id;
  await call('PUT', `/auth/v1/admin/users/${userId}`, { password });
  console.log('dev account exists; password reset to the stored value');
} else {
  const created = await call('POST', '/auth/v1/admin/users', { email: EMAIL, password, email_confirm: true });
  userId = created.id;
  console.log('dev account created');
}

// 2. Profile (already onboarded; initial paywall marked seen so tests start at Stats).
const now = new Date().toISOString();
await call('POST', '/rest/v1/athlete_profiles?on_conflict=id', {
  id: userId, racing_name: 'Dev Athlete', birth_year: 1988, onboarding_completed_at: now, initial_paywall_seen_at: now,
}, { Prefer: 'resolution=merge-duplicates' });

// 3. Synthetic races.
const have = await call('GET', `/rest/v1/races?athlete_id=eq.${userId}&select=id`);
if (have.length > 0 && !process.argv.includes('--reset')) {
  console.log(`athlete already has ${have.length} races; skipping (use --reset to replace)`);
} else {
  if (have.length > 0) await call('DELETE', `/rest/v1/races?athlete_id=eq.${userId}`);
  const sec = (h, m, s) => h * 3600 + m * 60 + s;
  const imported = (n, name, category, sport, date, splits, finish, ranks) => ({
    athlete_id: userId, import_status: 'confirmed', race_status: 'completed', provider: 'sportstats',
    provider_result_id: `synthetic-${n}`, provider_athlete_name: 'Dev Athlete', import_method: 'discovery_automated',
    event_date: date, event_year: Number(date.slice(0, 4)), date_precision: 'day', event_name: name, category, sport,
    location: 'Synthetic City', finish_seconds: finish, splits, source_notes: ['Synthetic development data'], ...ranks,
  });
  const tri = (sw, t1, bk, t2, rn) => [
    { label: 'Swim', splitSeconds: sw, totalSeconds: sw }, { label: 'T1', splitSeconds: t1, totalSeconds: sw + t1 },
    { label: 'Bike', splitSeconds: bk, totalSeconds: sw + t1 + bk }, { label: 'T2', splitSeconds: t2, totalSeconds: sw + t1 + bk + t2 },
    { label: 'Run', splitSeconds: rn, totalSeconds: sw + t1 + bk + t2 + rn },
  ];
  const rows = [
    imported(1, 'Synthetic Sprint Triathlon', 'Sprint Triathlon', 'triathlon', '2024-06-09', tri(sec(0, 12, 40), 95, sec(0, 38, 20), 60, sec(0, 21, 5)), sec(1, 13, 0),
      { overall_rank_place: 41, overall_rank_field: 320, age_group_rank_place: 5, age_group_rank_field: 38, age_group_category: 'M35-39' }),
    imported(2, 'Synthetic Olympic Triathlon', 'Olympic Triathlon', 'triathlon', '2025-07-12', tri(sec(0, 24, 30), 110, sec(1, 6, 0), 70, sec(0, 41, 20)), sec(2, 33, 30),
      { overall_rank_place: 58, overall_rank_field: 410, age_group_rank_place: 3, age_group_rank_field: 52, age_group_category: 'M35-39' }),
    imported(3, 'Synthetic IRONMAN 70.3', '70.3', 'triathlon', '2026-06-14', tri(sec(0, 38, 10), 240, sec(2, 36, 0), 200, sec(1, 40, 0)), sec(5, 14, 10),
      { overall_rank_place: 210, overall_rank_field: 1800, age_group_rank_place: 22, age_group_rank_field: 190, age_group_category: 'M35-39' }),
    imported(4, 'Synthetic 10K', '10km', 'running', '2025-04-20', [], sec(0, 44, 30), { overall_rank_place: 120, overall_rank_field: 2100 }),
    imported(5, 'Synthetic Half Marathon', 'Half Marathon', 'running', '2025-10-05', [], sec(1, 38, 12), { overall_rank_place: 340, overall_rank_field: 3900 }),
    imported(6, 'Synthetic Marathon', 'Marathon', 'running', '2024-10-13', [], sec(3, 29, 55), { overall_rank_place: 800, overall_rank_field: 6200 }),
  ];
  const upcomingDate = new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10);
  rows.push({
    athlete_id: userId, import_status: 'confirmed', race_status: 'registered', provider: 'manual', provider_result_id: null,
    import_method: 'manual_entry', event_date: upcomingDate, event_year: Number(upcomingDate.slice(0, 4)), date_precision: 'day',
    event_name: 'Synthetic Upcoming IRONMAN', category: 'Ironman', sport: 'triathlon', location: 'Synthetic City', checklist_completed: [],
  });
  rows.push({
    athlete_id: userId, import_status: 'confirmed', race_status: 'completed', provider: 'manual', provider_result_id: null,
    import_method: 'manual_entry', event_date: '2023-09-17', event_year: 2023, date_precision: 'day', event_name: 'Synthetic Manual 5K',
    category: '5km', sport: 'running', location: 'Synthetic City', finish_seconds: sec(0, 21, 40),
  });
  // PostgREST bulk inserts require every object to have identical keys.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const uniform = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? (k === 'checklist_completed' ? [] : null)])));
  await call('POST', '/rest/v1/races', uniform);
  console.log(`inserted ${rows.length} synthetic races`);
}
console.log(`dev account: ${EMAIL}`);
console.log(`password: stored in ${pwPath} (mode 600, never printed)`);
