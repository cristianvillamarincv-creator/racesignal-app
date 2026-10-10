import { assert, assertEquals } from 'jsr:@std/assert@1';

import type { FetchFn } from './revenuecat.ts';
import {
  ACCEPTED_GRACE_MS,
  ATTENTION_AGE_MS,
  handleRevenueCatDeletion,
  MAX_ATTEMPTS,
  RECHECK_WINDOW_MS,
  runSweep,
  VERIFIED_RETENTION_MS,
  type DeletionPatch,
  type DeletionRow,
  type DeletionStore,
} from './revenuecatCleanup.ts';

const CONFIG = { secretKey: 'sk_test_SECRET_VALUE', projectId: 'proj123' };
const USER = '11111111-2222-3333-4444-555555555555';
const NOW = new Date('2026-10-10T12:00:00.000Z');
const fast = { retryDelayMs: 0, now: () => NOW };

function memoryStore(initial: Partial<DeletionRow>[] = []) {
  const rows = new Map<string, DeletionRow>();
  const blank = (id: string): DeletionRow => ({ app_user_id: id, status: 'queued', attempts: 0, first_requested_at: NOW.toISOString(), last_attempt_at: null, verified_at: null, last_error: null });
  for (const r of initial) rows.set(r.app_user_id!, { ...blank(r.app_user_id!), ...r });
  const store: DeletionStore & { rows: Map<string, DeletionRow>; failWrites: boolean } = {
    rows,
    failWrites: false,
    async upsertQueued(id) { if (store.failWrites) throw new Error('x'); rows.set(id, blank(id)); },
    async update(id, patch: DeletionPatch) { if (store.failWrites) throw new Error('x'); rows.set(id, { ...rows.get(id)!, ...patch }); },
    async remove(id) { rows.delete(id); },
    async listOpen(limit) { return [...rows.values()].filter((r) => r.status !== 'verified').slice(0, limit); },
    async listVerifiedSince(iso, limit) { return [...rows.values()].filter((r) => r.status === 'verified' && r.verified_at! >= iso).slice(0, limit); },
    async countNeedingAttention(olderIso, max) { return [...rows.values()].filter((r) => r.status !== 'verified' && (r.attempts >= max || r.first_requested_at < olderIso)).length; },
    async purgeVerifiedBefore(iso) {
      let n = 0;
      for (const [id, r] of rows) if (r.status === 'verified' && r.verified_at! < iso) { rows.delete(id); n++; }
      return n;
    },
  };
  return store;
}

function routes(handler: (method: string, id: string) => number | 'throw') {
  const calls: string[] = [];
  const fetchFn: FetchFn = (url, init) => {
    const id = decodeURIComponent(url.split('/customers/')[1]!);
    calls.push(`${init.method} ${id}`);
    const out = handler(String(init.method), id);
    if (out === 'throw') return Promise.reject(new TypeError('down'));
    return Promise.resolve(new Response('', { status: out }));
  };
  return { calls, fetchFn };
}

Deno.test('after deletion: an accepted request is recorded as accepted (pending), not verified', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  const { fetchFn } = routes(() => 200);
  assertEquals(await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn }), 'requested');
  const row = store.rows.get(USER)!;
  assertEquals([row.status, row.attempts, row.verified_at, row.last_error], ['accepted', 1, null, null]);
});

Deno.test('after deletion: a 404 means nothing to delete and is verified straight away', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  assertEquals(await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn: routes(() => 404).fetchFn }), 'requested');
  assertEquals(store.rows.get(USER)!.status, 'verified');
});

Deno.test('after deletion: a RevenueCat failure is recorded for retry with a short code and never throws', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  assertEquals(await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn: routes(() => 401).fetchFn }), 'failed');
  const row = store.rows.get(USER)!;
  assertEquals([row.status, row.last_error, row.attempts], ['failed', 'http_401', 1]);
  assertEquals(await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn: routes(() => 'throw').fetchFn }), 'failed');
  assertEquals(store.rows.get(USER)!.last_error, 'network');
});

Deno.test('after deletion: no key configured is recorded as failed/not_configured so it can be retried later', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  assertEquals(await handleRevenueCatDeletion(USER, null, store, fast), 'not_configured');
  const row = store.rows.get(USER)!;
  assertEquals([row.status, row.last_error], ['failed', 'not_configured']);
});

Deno.test('after deletion: even when recording fails the call still returns a result and does not throw', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  store.failWrites = true;
  assertEquals(await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn: routes(() => 200).fetchFn }), 'requested');
  assertEquals(await handleRevenueCatDeletion(USER, null, store, fast), 'not_configured');
});

Deno.test('sweep: a 404 lookup marks the request verified; the account-exists check never deletes a live account', async () => {
  const gone = 'aaaaaaaa-0000-0000-0000-000000000001';
  const live = 'aaaaaaaa-0000-0000-0000-000000000002';
  const store = memoryStore([{ app_user_id: gone, status: 'accepted', attempts: 1, last_attempt_at: NOW.toISOString() }, { app_user_id: live, status: 'queued' }]);
  const { calls, fetchFn } = routes(() => 404);
  const summary = await runSweep(CONFIG, store, async (id) => id === live, { ...fast, fetchFn });
  assertEquals(store.rows.get(gone)!.status, 'verified');
  assertEquals(store.rows.has(live), false);
  assertEquals([summary.verified, summary.skippedAccountExists], [1, 1]);
  assert(!calls.some((c) => c.includes(live)), 'no RevenueCat call at all for a live account');
});

Deno.test('sweep: an accepted request that is still present inside its grace period stays pending and is not re-sent', async () => {
  const recent = new Date(NOW.getTime() - ACCEPTED_GRACE_MS + 60_000).toISOString();
  const store = memoryStore([{ app_user_id: USER, status: 'accepted', attempts: 1, last_attempt_at: recent }]);
  const { calls, fetchFn } = routes(() => 200);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals(summary.stillPending, 1);
  assertEquals(calls, [`GET ${USER}`]);
  assertEquals(store.rows.get(USER)!.status, 'accepted');
});

Deno.test('sweep: still present after the grace period (or failed earlier) is re-requested and counted', async () => {
  const old = new Date(NOW.getTime() - ACCEPTED_GRACE_MS - 1000).toISOString();
  const other = 'aaaaaaaa-0000-0000-0000-000000000003';
  const store = memoryStore([{ app_user_id: USER, status: 'accepted', attempts: 1, last_attempt_at: old }, { app_user_id: other, status: 'failed', attempts: 1, last_error: 'http_503' }]);
  const { calls, fetchFn } = routes(() => 200);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals(summary.reRequested, 2);
  assertEquals(calls.filter((c) => c.startsWith('DELETE')).length, 2);
  assertEquals([store.rows.get(USER)!.status, store.rows.get(USER)!.attempts, store.rows.get(other)!.attempts], ['accepted', 2, 2]);
});

Deno.test('sweep: an unknown lookup result (for example a rejected key) is recorded and never treated as verified', async () => {
  const store = memoryStore([{ app_user_id: USER, status: 'failed', attempts: 1 }]);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn: routes(() => 401).fetchFn });
  assertEquals(summary.failed, 1);
  const row = store.rows.get(USER)!;
  assertEquals([row.status, row.last_error], ['failed', 'http_401']);
});

Deno.test('sweep: after the maximum number of attempts it stops asking and leaves the row visible', async () => {
  const store = memoryStore([{ app_user_id: USER, status: 'failed', attempts: MAX_ATTEMPTS }]);
  const { calls, fetchFn } = routes(() => 200);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals(summary.gaveUp, 1);
  assertEquals(calls, [`GET ${USER}`]);
  assertEquals(store.rows.get(USER)!.last_error, 'gave_up_still_present');
});

Deno.test('sweep: an account lookup that errors skips the row rather than risking a live customer', async () => {
  const store = memoryStore([{ app_user_id: USER, status: 'failed', attempts: 1 }]);
  const { calls, fetchFn } = routes(() => 404);
  const summary = await runSweep(CONFIG, store, () => Promise.reject(new Error('lookup down')), { ...fast, fetchFn });
  assertEquals(summary.failed, 1);
  assertEquals(calls, []);
  assertEquals(store.rows.get(USER)!.status, 'failed');
});

Deno.test('sweep: verified rows are removed only after the retention period', async () => {
  const oldDate = new Date(NOW.getTime() - VERIFIED_RETENTION_MS - 1000).toISOString();
  const freshDate = new Date(NOW.getTime() - 1000).toISOString();
  const store = memoryStore([
    { app_user_id: 'aaaaaaaa-0000-0000-0000-00000000000a', status: 'verified', verified_at: oldDate },
    { app_user_id: 'aaaaaaaa-0000-0000-0000-00000000000b', status: 'verified', verified_at: freshDate },
  ]);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn: routes(() => 404).fetchFn });
  assertEquals(summary.purged, 1);
  assertEquals([...store.rows.keys()], ['aaaaaaaa-0000-0000-0000-00000000000b']);
});

Deno.test('sweep: a recently verified customer that has reappeared is deleted again and goes back to pending', async () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const store = memoryStore([{ app_user_id: USER, status: 'verified', attempts: 1, verified_at: recent }]);
  const { calls, fetchFn } = routes(() => 200);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals(summary.reappeared, 1);
  assertEquals(calls, [`GET ${USER}`, `DELETE ${USER}`]);
  const row = store.rows.get(USER)!;
  assertEquals([row.status, row.attempts, row.verified_at, row.last_error], ['accepted', 2, null, 'reappeared']);
});

Deno.test('sweep: a recently verified customer that is still gone is left alone', async () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const store = memoryStore([{ app_user_id: USER, status: 'verified', attempts: 1, verified_at: recent }]);
  const { calls, fetchFn } = routes(() => 404);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals([summary.reappeared, summary.verified], [0, 0]);
  assertEquals(calls, [`GET ${USER}`]);
  assertEquals(store.rows.get(USER)!.status, 'verified');
});

Deno.test('sweep: verified rows older than the recheck window are not looked up again', async () => {
  const old = new Date(NOW.getTime() - RECHECK_WINDOW_MS - 1000).toISOString();
  const store = memoryStore([{ app_user_id: USER, status: 'verified', attempts: 1, verified_at: old }]);
  const { calls, fetchFn } = routes(() => 200);
  await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn });
  assertEquals(calls, []);
});

Deno.test('sweep: an inconclusive lookup of a verified row changes nothing', async () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  const store = memoryStore([{ app_user_id: USER, status: 'verified', attempts: 1, verified_at: recent }]);
  await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn: routes(() => 401).fetchFn });
  assertEquals(store.rows.get(USER)!.status, 'verified');
});

Deno.test('sweep: reports requests a person has to look at (attempts used up, or older than a day), and only those', async () => {
  const day = new Date(NOW.getTime() - ATTENTION_AGE_MS - 1000).toISOString();
  const fresh = NOW.toISOString();
  const store = memoryStore([
    { app_user_id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'failed', attempts: MAX_ATTEMPTS, first_requested_at: fresh },
    { app_user_id: 'aaaaaaaa-0000-0000-0000-000000000002', status: 'failed', attempts: 0, first_requested_at: day, last_error: 'http_401' },
    { app_user_id: 'aaaaaaaa-0000-0000-0000-000000000003', status: 'accepted', attempts: 1, first_requested_at: fresh, last_attempt_at: fresh },
  ]);
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn: routes(() => 401).fetchFn });
  assertEquals(summary.needsAttention, 2);
});

Deno.test('nothing in the stored rows or the summary contains the key', async () => {
  const store = memoryStore([{ app_user_id: USER }]);
  await handleRevenueCatDeletion(USER, CONFIG, store, { ...fast, fetchFn: routes(() => 401).fetchFn });
  const summary = await runSweep(CONFIG, store, async () => false, { ...fast, fetchFn: routes(() => 401).fetchFn });
  assert(!JSON.stringify([...store.rows.values(), summary]).includes('SECRET_VALUE'));
});
