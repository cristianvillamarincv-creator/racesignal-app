import { supabase } from '@/lib/supabaseClient';
import { withTimeout } from '@/lib/timeout';

/**
 * Thin client for the `delete-account` Edge Function (Step 7.3 — Apple 5.1.1(v) in-app account
 * deletion). Requires a session — supabase-js attaches the current session's access token
 * automatically (see lib/auth.tsx). Same 20s bound already used for every Supabase call in this
 * app (see lib/timeout.ts).
 */
const DELETE_ACCOUNT_TIMEOUT_MS = 20000;

export type DeleteAccountResult = { available: true } | { available: false; reason: 'unauthorized' | 'server_error' | 'network_error' };

export async function deleteAccount(): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('delete-account', { body: {} }),
      DELETE_ACCOUNT_TIMEOUT_MS,
      'delete-account',
    );
    if (error) {
      console.warn('[deleteAccount] functions.invoke failed —', error.message ?? error);
      return { available: false, reason: 'network_error' };
    }
    const body = data as { available?: boolean; reason?: 'unauthorized' | 'server_error' } | null;
    if (body?.available) return { available: true };
    return { available: false, reason: body?.reason ?? 'server_error' };
  } catch (err) {
    console.warn('[deleteAccount] did not complete —', err);
    return { available: false, reason: 'network_error' };
  }
}
