// race-discovery Edge Function — the only place Sportstats-specific request/parsing logic lives
// (per the B.1 architecture decision). Three actions, two trust tiers:
//
//   search  (no auth required) -> racing name -> candidate athlete identities
//   history (no auth required) -> one identity -> lightweight candidate races
//   detail  (auth REQUIRED, validated explicitly inside this function below — the function is
//            deployed with verify_jwt=false so search/history can run pre-signup, so `detail`
//            must check the caller's JWT itself rather than relying on the gateway) -> one
//            selected race -> full result detail
//
// This function NEVER writes to `races` or `athlete_profiles`. It returns normalized data only;
// the authenticated mobile client persists selected races itself, through normal Supabase RLS.
// The only tables this function's service-role client touches are `provider_config` (kill switch)
// and `discovery_rate_limit` (outbound Sportstats request cap) — both are provider-infrastructure
// tables with RLS enabled and no policies, so the service-role key's broader privileges are never
// exercised against athlete data from here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { extractInitialResults, parseSingleResultDetail, toCandidateRaces } from './normalize.ts';
import { fetchAthleteHistoryHtml, fetchSingleResult, isBlocked, searchAthlete } from './sportstatsClient.ts';
import type { AthleteIdentity, DiscoveryResponse, UnavailableReason } from './types.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DAILY_REQUEST_CAP = Number(Deno.env.get('SPORTSTATS_DAILY_REQUEST_CAP') ?? '30');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function unavailable(reason: UnavailableReason) {
  return json({ available: false, reason } satisfies DiscoveryResponse<never>);
}

function serviceRoleClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

function getClientIp(req: Request): string {
  // Supabase's edge runtime forwards the real client IP in this header.
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function isProviderEnabled(): Promise<boolean> {
  const { data, error } = await serviceRoleClient()
    .from('provider_config')
    .select('enabled')
    .eq('provider', 'sportstats')
    .maybeSingle();
  if (error || !data) return true; // fail open on a config-read error, not closed — a DB hiccup shouldn't take discovery down
  return data.enabled === true;
}

/** Rate limiting applies to every action that reaches Sportstats — search, history, AND detail
 *  (a batch of N selected races still means N outbound `detail` calls, all counted). */
async function checkAndIncrementRateLimit(ip: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const client = serviceRoleClient();

  const { data: existing } = await client
    .from('discovery_rate_limit')
    .select('request_count')
    .eq('ip_address', ip)
    .eq('window_date', today)
    .maybeSingle();

  const currentCount = existing?.request_count ?? 0;
  if (currentCount >= DAILY_REQUEST_CAP) return false;

  await client
    .from('discovery_rate_limit')
    .upsert({ ip_address: ip, window_date: today, request_count: currentCount + 1 }, { onConflict: 'ip_address,window_date' });

  return true;
}

/** Explicit JWT validation for the `detail` action. This function is deployed with
 *  verify_jwt=false (search/history must work pre-signup) — so `detail`, the one action that
 *  should only run for a signed-in athlete, checks the caller's token itself rather than relying
 *  on the platform gateway. */
async function requireAuthenticatedUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return unavailable('bad_request');
  }

  const action = body.action;
  if (action !== 'search' && action !== 'history' && action !== 'detail') {
    return unavailable('bad_request');
  }

  if (!(await isProviderEnabled())) {
    return unavailable('disabled');
  }

  const ip = getClientIp(req);
  if (!(await checkAndIncrementRateLimit(ip))) {
    return unavailable('rate_limited');
  }

  if (action === 'search') {
    const racingName = typeof body.racingName === 'string' ? body.racingName.trim() : '';
    if (!racingName) return unavailable('bad_request');

    const result = await searchAthlete(racingName);
    if (isBlocked(result)) return unavailable('provider_blocked');

    const identities: AthleteIdentity[] = result.map((r) => ({ providerAthleteId: r.nid, displayName: r.dn }));
    return json({ available: true, data: identities } satisfies DiscoveryResponse<AthleteIdentity[]>);
  }

  if (action === 'history') {
    const providerAthleteId = typeof body.providerAthleteId === 'string' ? body.providerAthleteId : '';
    if (!providerAthleteId) return unavailable('bad_request');

    const html = await fetchAthleteHistoryHtml(providerAthleteId);
    if (isBlocked(html)) return unavailable('provider_blocked');

    try {
      const rawEntries = extractInitialResults(html);
      const candidates = toCandidateRaces(rawEntries);
      return json({ available: true, data: candidates });
    } catch {
      return unavailable('not_found');
    }
  }

  // action === 'detail' — the one authenticated action.
  const user = await requireAuthenticatedUser(req);
  if (!user) return unavailable('unauthorized');

  const providerResultId = typeof body.providerResultId === 'string' ? body.providerResultId : '';
  const providerAthleteResultId = typeof body.providerAthleteResultId === 'string' ? body.providerAthleteResultId : '';
  // The candidate's own category label (e.g. "70.3", "Olympic", "Half Marathon") — the mobile
  // client already has this from the search/history step. Used ONLY as a fallback distance
  // source for split pace/speed (see normalize.ts's distance-trust rules); never trusted for
  // anything else, and detail parsing still succeeds without it, just with fewer paces shown.
  const category = typeof body.category === 'string' ? body.category : undefined;
  if (!providerResultId || !providerAthleteResultId) return unavailable('bad_request');

  const raw = await fetchSingleResult(providerResultId, providerAthleteResultId);
  if (isBlocked(raw)) return unavailable('provider_blocked');

  try {
    const detail = parseSingleResultDetail(raw, category);
    return json({ available: true, data: detail });
  } catch {
    return unavailable('not_found');
  }
});
