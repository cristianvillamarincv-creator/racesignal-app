// revenuecat-cleanup: verifies and retries the RevenueCat customer deletions that follow account deletion.
//
// Not callable by athletes: the caller must present a key that can read `revenuecat_deletion_requests`, which only the project's
// service-role/secret key can (RLS is on with no policies, and all grants to anon/authenticated are revoked). The function proves
// that by making that read with the presented key, so it works for both the legacy JWT service-role key and the new-format
// `sb_secret_` key, and refuses the anon key, a signed-in athlete's token and anything else. The gateway JWT check is off for this
// function because an `sb_secret_` key is not a JWT; this probe is the whole authorization. It reads the key from the `apikey`
// header (the new-format key must travel only there), falling back to a Bearer token.
//
// It reads `revenuecat_deletion_requests` (migration 0012), looks each unverified customer up (404 = confirmed gone), re-requests
// deletion for the ones still there, and removes verified rows after 30 days. It never touches a customer whose RaceSignal account
// still exists. The reply contains counts only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { readRevenueCatConfig } from '../_shared/revenuecat.ts';
import { runSweep } from '../_shared/revenuecatCleanup.ts';
import { createDeletionStore } from '../_shared/revenuecatStore.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

/** True only for a key that can read the service-only table: the project's service-role key in either format. */
async function isServiceKey(presented: string): Promise<boolean> {
  if (!presented) return false;
  const { error } = await createClient(Deno.env.get('SUPABASE_URL')!, presented, { auth: { persistSession: false } })
    .from('revenuecat_deletion_requests')
    .select('app_user_id')
    .limit(1);
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const presented = req.headers.get('apikey') ?? req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!(await isServiceKey(presented))) return json({ error: 'unauthorized' }, 401);

  const config = readRevenueCatConfig(Deno.env);
  if (!config) return json({ available: false, reason: 'not_configured' }, 200);

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const accountExists = async (userId: string) => {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) {
      // "User not found" is the expected answer for a deleted account; anything else must not be mistaken for "gone".
      if ((error as { status?: number }).status === 404 || /not found/i.test(error.message)) return false;
      throw new Error('account lookup failed');
    }
    return Boolean(data?.user);
  };

  try {
    const summary = await runSweep(config, createDeletionStore(client), accountExists);
    // Retries cannot fix these: they are listed in revenuecat_deletion_requests (status not 'verified') for a person to resolve.
    if (summary.needsAttention > 0) console.error('[revenuecat-cleanup] requests needing manual follow-up:', summary.needsAttention);
    return json({ available: true, data: summary });
  } catch (err) {
    console.warn('[revenuecat-cleanup] sweep failed:', (err as Error)?.name ?? 'error');
    return json({ available: false, reason: 'server_error' }, 500);
  }
});
