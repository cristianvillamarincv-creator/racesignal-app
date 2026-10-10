// Records and retries the RevenueCat customer deletion that follows a RaceSignal account deletion.
//
// The account deletion itself never depends on any of this. Every outcome is written to `revenuecat_deletion_requests`
// (migration 0012) so a request that failed, or was accepted but is not yet confirmed gone, can be identified and retried
// without anyone having to ask. An accepted (asynchronous) request counts as PENDING until a lookup returns "not found".

import {
  checkCustomerPresence,
  requestCustomerDeletion,
  type CallOptions,
  type RevenueCatConfig,
} from './revenuecat.ts';

export type DeletionStatus = 'queued' | 'accepted' | 'failed' | 'verified';

export interface DeletionRow {
  app_user_id: string;
  status: DeletionStatus;
  attempts: number;
  first_requested_at: string;
  last_attempt_at: string | null;
  verified_at: string | null;
  last_error: string | null;
}

export type DeletionPatch = Partial<Pick<DeletionRow, 'status' | 'attempts' | 'last_attempt_at' | 'verified_at' | 'last_error'>>;

/** The persistence the logic needs; the Edge Functions implement it over the service-role Supabase client. */
export interface DeletionStore {
  upsertQueued(userId: string): Promise<void>;
  update(userId: string, patch: DeletionPatch): Promise<void>;
  remove(userId: string): Promise<void>;
  /** Rows that are not verified yet, least recently attempted first. */
  listOpen(limit: number): Promise<DeletionRow[]>;
  /** Verified rows verified at or after the given ISO time (to catch a customer that reappears after removal). */
  listVerifiedSince(isoTime: string, limit: number): Promise<DeletionRow[]>;
  /** How many unverified rows have used up their attempts or are older than the given ISO time: these need a person. */
  countNeedingAttention(olderThanIso: string, maxAttempts: number): Promise<number>;
  /** Removes verified rows verified before the given ISO time; returns how many. */
  purgeVerifiedBefore(isoTime: string): Promise<number>;
}

export type RevenueCatDeletionResult = 'requested' | 'failed' | 'not_configured';

/** How long an accepted (asynchronous) request is given before the sweep asks again. */
export const ACCEPTED_GRACE_MS = 15 * 60 * 1000;
/** After this many requests the sweep stops re-asking and leaves the row visible for a person to look at. */
export const MAX_ATTEMPTS = 10;
/**
 * A customer CAN reappear after it was removed: any call from the app's RevenueCat SDK that still uses the deleted account id (a
 * refresh that was already in flight) creates it again. Verified rows are therefore looked up again for this long, and a customer
 * that is back is deleted again.
 */
export const RECHECK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** An unverified request this old needs a person even if it has not used up its attempts (for example the key stopped working). */
export const ATTENTION_AGE_MS = 24 * 60 * 60 * 1000;
/** Verified rows are kept this long (so a customer that reappears can still be noticed), then removed. */
export const VERIFIED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function safely(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    // Never include the error text: it could echo a request. The label and class are enough to find it in the logs.
    console.warn('[revenuecat-cleanup]', label, 'did not complete:', (err as Error)?.name ?? 'error');
  }
}

/** Called right after the account was deleted. Never throws; the result only goes into the response and the log. */
export async function handleRevenueCatDeletion(
  userId: string,
  config: RevenueCatConfig | null,
  store: DeletionStore,
  options: CallOptions & { now?: () => Date } = {},
): Promise<RevenueCatDeletionResult> {
  const now = options.now ?? (() => new Date());
  if (!config) {
    await safely('record not_configured', () => store.update(userId, { status: 'failed', last_error: 'not_configured', last_attempt_at: now().toISOString() }));
    console.warn('[delete-account] RevenueCat deletion not attempted: no secret key configured. Recorded for retry.');
    return 'not_configured';
  }
  const outcome = await requestCustomerDeletion(userId, config, options);
  const at = now().toISOString();
  if (outcome.status === 'accepted') {
    await safely('record accepted', () => store.update(userId, { status: 'accepted', attempts: 1, last_attempt_at: at, last_error: null }));
    return 'requested';
  }
  if (outcome.status === 'absent') {
    await safely('record absent', () => store.update(userId, { status: 'verified', attempts: 1, last_attempt_at: at, verified_at: at, last_error: null }));
    return 'requested';
  }
  await safely('record failure', () => store.update(userId, { status: 'failed', attempts: 1, last_attempt_at: at, last_error: outcome.code }));
  console.warn('[delete-account] RevenueCat deletion request failed:', outcome.code, '- recorded for retry.');
  return 'failed';
}

export interface SweepSummary {
  checked: number;
  verified: number;
  stillPending: number;
  reRequested: number;
  reappeared: number;
  failed: number;
  gaveUp: number;
  skippedAccountExists: number;
  purged: number;
  /** Unverified requests that used up their attempts or are over a day old; retries alone will not resolve them. */
  needsAttention: number;
}

/**
 * One pass over the rows that are not verified yet. For each: never touch a customer whose account still exists; look the customer
 * up (404 = verified gone); if it is still there, re-request the deletion once an accepted request has had its grace period.
 */
export async function runSweep(
  config: RevenueCatConfig,
  store: DeletionStore,
  accountExists: (userId: string) => Promise<boolean>,
  options: CallOptions & { now?: () => Date; limit?: number } = {},
): Promise<SweepSummary> {
  const now = options.now ?? (() => new Date());
  const summary: SweepSummary = { checked: 0, verified: 0, stillPending: 0, reRequested: 0, reappeared: 0, failed: 0, gaveUp: 0, skippedAccountExists: 0, purged: 0, needsAttention: 0 };
  const limit = options.limit ?? 50;
  const rows = [
    ...(await store.listOpen(limit)),
    ...(await store.listVerifiedSince(new Date(now().getTime() - RECHECK_WINDOW_MS).toISOString(), limit)),
  ];

  for (const row of rows) {
    summary.checked++;
    const at = now().toISOString();
    try {
      // A row written for an account whose deletion then failed (or that was recreated) must never cause its customer to be deleted.
      if (await accountExists(row.app_user_id)) {
        await store.remove(row.app_user_id);
        summary.skippedAccountExists++;
        continue;
      }
      const looked = await checkCustomerPresence(row.app_user_id, config, options);
      if (row.status === 'verified') {
        // Already confirmed gone once: only a customer that has come back needs action; anything else leaves the row as it is.
        if (looked.presence === 'present') {
          const outcome = await requestCustomerDeletion(row.app_user_id, config, options);
          const failed = outcome.status === 'failed';
          await store.update(row.app_user_id, {
            status: failed ? 'failed' : 'accepted',
            attempts: row.attempts + 1,
            last_attempt_at: at,
            verified_at: null,
            last_error: failed ? outcome.code : 'reappeared',
          });
          summary.reappeared++;
        }
        continue;
      }
      if (looked.presence === 'absent') {
        await store.update(row.app_user_id, { status: 'verified', verified_at: at, last_attempt_at: at, last_error: null });
        summary.verified++;
        continue;
      }
      if (looked.presence === 'unknown') {
        await store.update(row.app_user_id, { last_error: looked.code, last_attempt_at: at });
        summary.failed++;
        continue;
      }
      // The customer still exists.
      const sinceAttempt = row.last_attempt_at ? now().getTime() - new Date(row.last_attempt_at).getTime() : Infinity;
      if (row.status === 'accepted' && sinceAttempt < ACCEPTED_GRACE_MS) {
        summary.stillPending++;
        continue;
      }
      if (row.attempts >= MAX_ATTEMPTS) {
        await store.update(row.app_user_id, { status: 'failed', last_error: 'gave_up_still_present', last_attempt_at: at });
        summary.gaveUp++;
        continue;
      }
      const outcome = await requestCustomerDeletion(row.app_user_id, config, options);
      if (outcome.status === 'failed') {
        await store.update(row.app_user_id, { status: 'failed', attempts: row.attempts + 1, last_attempt_at: at, last_error: outcome.code });
        summary.failed++;
      } else {
        await store.update(row.app_user_id, { status: 'accepted', attempts: row.attempts + 1, last_attempt_at: at, last_error: null });
        summary.reRequested++;
      }
    } catch (err) {
      summary.failed++;
      console.warn('[revenuecat-cleanup] a row could not be processed:', (err as Error)?.name ?? 'error');
    }
  }

  summary.needsAttention = await store
    .countNeedingAttention(new Date(now().getTime() - ATTENTION_AGE_MS).toISOString(), MAX_ATTEMPTS)
    .catch(() => 0);
  summary.purged = await store.purgeVerifiedBefore(new Date(now().getTime() - VERIFIED_RETENTION_MS).toISOString()).catch(() => 0);
  return summary;
}
