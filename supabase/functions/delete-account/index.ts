// delete-account Edge Function (Step 7.3) — Apple 5.1.1(v) requires that any app supporting
// account creation also let the athlete initiate account deletion in-app. Every action requires a
// signed-in athlete, so this function relies on the platform gateway's own JWT verification (see
// config.toml, same as `signal`) and additionally re-validates the bearer token itself to read the
// caller's own user id — the same pattern `signal` and `race-discovery` already use.
//
// Deletion is a single call to the Auth admin API: `auth.admin.deleteUser` removes the
// `auth.users` row, and every RaceSignal table that holds this athlete's data references that row
// (directly or transitively) with `on delete cascade` — athlete_profiles -> races ->
// signal_rate_limit, signal_conversations -> signal_messages (see migrations 0001, 0005, 0006).
// Postgres's own foreign-key cascade does the actual data removal; this function does not, and
// must not, delete rows from those tables itself. `discovery_rate_limit` is keyed by IP address,
// not by athlete, and holds no personal data — nothing to remove there.
//
// The client never sees the service-role key: this function is the only place it's read, from
// Deno.env, exactly like `signal` and `race-discovery`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { type AppleRevocationStatus, readAppleConfig, revokeAppleSignIn } from './apple.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type UnavailableReason = 'unauthorized' | 'server_error';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function unavailable(reason: UnavailableReason, status = 200) {
  return json({ available: false, reason }, status);
}

function serviceRoleClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

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

  const user = await requireAuthenticatedUser(req);
  if (!user) return unavailable('unauthorized', 401);

  // Optional: a single-use Sign in with Apple authorization code from a fresh Apple sign-in at deletion
  // time. Revocation is best-effort and bounded; it can never stop the account from being deleted (Apple
  // itself says deletion must be fulfilled even without the tokens), so every outcome falls through.
  let appleRevocation: AppleRevocationStatus = 'not_attempted';
  const body = await req.json().catch(() => null);
  const code = typeof body?.appleAuthorizationCode === 'string' ? body.appleAuthorizationCode : '';
  if (code && code.length <= 4096) {
    const appleConfig = readAppleConfig(Deno.env);
    if (appleConfig) appleRevocation = await revokeAppleSignIn(code, appleConfig);
  }

  const { error } = await serviceRoleClient().auth.admin.deleteUser(user.id);
  if (error) {
    console.warn('[delete-account] admin.deleteUser failed for', user.id, '-', error.message);
    return unavailable('server_error', 500);
  }

  return json({ available: true, data: { deleted: true, appleRevocation } });
});
