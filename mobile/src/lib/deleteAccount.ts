import { supabase } from '@/lib/supabaseClient';
import { withTimeout } from '@/lib/timeout';

/**
 * Thin client for the `delete-account` Edge Function (Step 7.3 — Apple 5.1.1(v) in-app account
 * deletion). Requires a session — supabase-js attaches the current session's access token
 * automatically (see lib/auth.tsx). Same 20s bound already used for every Supabase call in this
 * app (see lib/timeout.ts).
 */
const DELETE_ACCOUNT_TIMEOUT_MS = 20000;

export type AppleRevocationStatus = 'revoked' | 'failed' | 'not_attempted';

export type DeleteAccountResult =
  | { available: true; appleRevocation: AppleRevocationStatus }
  | { available: false; reason: 'unauthorized' | 'server_error' | 'network_error' };

/** `appleAuthorizationCode` (optional) lets the server revoke the athlete's Sign in with Apple tokens as
 *  part of deletion. It is never required: without it the account is deleted all the same. */
export async function deleteAccount(options: { appleAuthorizationCode?: string } = {}): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('delete-account', {
        body: options.appleAuthorizationCode ? { appleAuthorizationCode: options.appleAuthorizationCode } : {},
      }),
      DELETE_ACCOUNT_TIMEOUT_MS,
      'delete-account',
    );
    if (error) {
      console.warn('[deleteAccount] functions.invoke failed —', error.message ?? error);
      return { available: false, reason: 'network_error' };
    }
    const body = data as {
      available?: boolean;
      reason?: 'unauthorized' | 'server_error';
      data?: { appleRevocation?: AppleRevocationStatus };
    } | null;
    if (body?.available) return { available: true, appleRevocation: body.data?.appleRevocation ?? 'not_attempted' };
    return { available: false, reason: body?.reason ?? 'server_error' };
  } catch (err) {
    console.warn('[deleteAccount] did not complete —', err);
    return { available: false, reason: 'network_error' };
  }
}
