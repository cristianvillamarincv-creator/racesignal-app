// Developer-only Signal regression harness — NOT part of the app. Never imported from `src/`,
// excluded from tsconfig.json/eslint.config.js, and irrelevant to the Metro bundle (Expo/Metro
// only bundles what's reachable from src/app/*, which never imports anything under scripts/).
//
// Exercises the SAME deployed `signal` Edge Function, the SAME system prompt, and the SAME
// buildSignalContext()/dbRowToRace() logic the real app uses — never a mock/fake Signal
// implementation. Data access goes through the athlete's own real, RLS-scoped session, exactly
// like the app does — the only elevated credential needed is the project's service-role key, used
// solely to mint that session non-interactively (no email actually gets sent). See README.md for
// setup and required environment variables — none of which are hardcoded here.
import { createClient } from '@supabase/supabase-js';
import { dbRowToRace, type RaceRow } from '../../src/lib/raceMapping';
import { buildSignalContext, type SignalContext } from '../../src/lib/signalContext';
import type { Race } from '../../src/fixtures/races';

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SendTurnResult {
  status: number;
  requestBytes: number;
  elapsedMs: number;
  json: { available: true; data: { reply: string } } | { available: false; reason: string; detail?: string } | { parseError: true };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See scripts/signal-eval/README.md for the full list and how to run this harness.`,
    );
  }
  return value;
}

/**
 * Mints a real, live session for the given athlete via the Admin API's generate_link + verify
 * flow — the non-interactive equivalent of tapping a magic-link email, so the harness never needs
 * to actually send/receive email. Requires SUPABASE_SERVICE_ROLE_KEY (never committed, never
 * logged) purely for this one call; every other request in this harness uses the resulting
 * ordinary user session, scoped by RLS exactly like the app.
 */
export async function mintTestSession(supabaseUrl: string, email: string) {
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const genLinkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!genLinkRes.ok) throw new Error(`generate_link failed: HTTP ${genLinkRes.status}`);
  const genLinkJson = await genLinkRes.json();

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: genLinkJson.hashed_token }),
  });
  if (!verifyRes.ok) throw new Error(`verify failed: HTTP ${verifyRes.status}`);
  const session = await verifyRes.json();
  if (!session.access_token || !session.user?.id) throw new Error('verify did not return a usable session');
  return session as { access_token: string; refresh_token: string; user: { id: string } };
}

/** Fetches the athlete's own confirmed races through the normal `races` RLS policy (same query
 *  shape as lib/db/races.ts's fetchConfirmedRaces) — not a service-role bypass. */
export async function fetchTestAthleteRaces(supabaseUrl: string, anonKey: string, accessToken: string): Promise<Race[]> {
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data, error } = await client
    .from('races')
    .select(
      'id, athlete_id, import_status, race_status, provider, provider_result_id, provider_athlete_name, source_url, import_method, source_notes, event_date, event_year, date_precision, event_name, location, sport, category, finish_seconds, bib, overall_rank_place, overall_rank_field, gender_rank_place, gender_rank_field, age_group_rank_place, age_group_rank_field, age_group_category, splits, checklist_completed',
    )
    .eq('import_status', 'confirmed')
    .order('event_year', { ascending: false });
  if (error) throw error;
  return (data as unknown as RaceRow[]).map(dbRowToRace);
}

export interface SignalEvalEnv {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  races: Race[];
}

/** One-shot setup: mints a session for SIGNAL_EVAL_EMAIL and loads that athlete's real races. */
export async function setupEnv(): Promise<SignalEvalEnv> {
  const supabaseUrl = requireEnv('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const email = requireEnv('SIGNAL_EVAL_EMAIL');

  const session = await mintTestSession(supabaseUrl, email);
  const races = await fetchTestAthleteRaces(supabaseUrl, anonKey, session.access_token);
  return { supabaseUrl, anonKey, accessToken: session.access_token, races };
}

/** Calls the real deployed `signal` Edge Function — identical request shape to lib/signal.ts. */
export async function sendTurn(
  env: SignalEvalEnv,
  seedRaceId: string | undefined,
  history: Turn[],
  message: string,
  image?: { base64: string; mediaType: string },
): Promise<SendTurnResult> {
  const context: SignalContext = buildSignalContext(env.races, seedRaceId);
  const body = { context, history, message, image };
  const requestBytes = JSON.stringify(body).length;
  const startedAt = Date.now();
  const res = await fetch(`${env.supabaseUrl}/functions/v1/signal`, {
    method: 'POST',
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const json = await res.json().catch(() => ({ parseError: true as const }));
  return { status: res.status, requestBytes, elapsedMs, json };
}

/** Finds a race by a case-insensitive substring of its name — convenient for regression cases
 *  that reference a real race by name rather than a hardcoded id. */
export function findRaceByName(races: Race[], nameContains: string): Race | undefined {
  const needle = nameContains.toLowerCase();
  return races.find((race) => race.name.toLowerCase().includes(needle));
}
