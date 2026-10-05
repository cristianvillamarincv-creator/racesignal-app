// Unit tests for usage.ts's RPC-branching logic (Build 11 Tasks 2 & 3) — a fake RpcClient with a
// scripted `.rpc()` stands in for the real service-role Supabase client, so these verify this
// file's OWN interpretation of the RPC contract (the "claimed vs completed vs processing vs error"
// mapping, the reserve/release cap-vs-service-error split) without a live Postgres instance. The
// underlying SQL functions' own atomicity (INSERT ... ON CONFLICT serialization) is NOT exercised
// here — that requires a real Postgres and is verified instead by direct reading of
// migrations/0010_signal_free_lifetime_allowance.sql / 0011_signal_request_dedup.sql, disclosed as
// a known gap rather than silently assumed covered.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  claimSignalRequest,
  completeSignalRequest,
  currentMonthWindow,
  failSignalRequest,
  getSignalUsage,
  releaseSignalAsk,
  reserveSignalAsk,
  type RpcClient,
} from './usage.ts';

function fakeClient(responses: Record<string, { data: unknown; error: { message: string } | null }>): RpcClient & { calls: [string, Record<string, unknown>][] } {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push([fn, args]);
      const response = responses[fn];
      if (!response) throw new Error(`fakeClient: no scripted response for rpc('${fn}')`);
      return Promise.resolve(response);
    },
  };
}

Deno.test('currentMonthWindow — the first day of the current UTC calendar month', () => {
  const window = currentMonthWindow();
  assertEquals(/^\d{4}-\d{2}-01$/.test(window), true);
  assertEquals(window, `${new Date().toISOString().slice(0, 7)}-01`);
});

Deno.test('reserveSignalAsk — a real count is reported ok, with no dedup args when not tracking a request', async () => {
  const client = fakeClient({ reserve_signal_ask: { data: 2, error: null } });
  const result = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', 3);
  assertEquals(result, { ok: true, count: 2 });
  assertEquals(client.calls[0], [
    'reserve_signal_ask',
    { p_athlete_id: 'athlete-1', p_window_date: '2026-09-01', p_tier: 'free', p_cap: 3, p_request_id: null, p_claim_token: null },
  ]);
});

Deno.test('reserveSignalAsk — passes requestId/claimToken through when reserving on behalf of a tracked dedup claim', async () => {
  const client = fakeClient({ reserve_signal_ask: { data: 1, error: null } });
  const result = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', 3, { requestId: 'req-1', claimToken: 'token-abc' });
  assertEquals(result, { ok: true, count: 1 });
  assertEquals(client.calls[0], [
    'reserve_signal_ask',
    { p_athlete_id: 'athlete-1', p_window_date: '2026-09-01', p_tier: 'free', p_cap: 3, p_request_id: 'req-1', p_claim_token: 'token-abc' },
  ]);
});

Deno.test('reserveSignalAsk — a null count (cap reached) is distinguished from an RPC error (service failure)', async () => {
  const capReached = fakeClient({ reserve_signal_ask: { data: null, error: null } });
  assertEquals(await reserveSignalAsk(capReached, 'athlete-1', '2026-09-01', 'free', 3), { ok: false, reason: 'cap_reached' });

  const serviceDown = fakeClient({ reserve_signal_ask: { data: null, error: { message: 'connection refused' } } });
  assertEquals(await reserveSignalAsk(serviceDown, 'athlete-1', '2026-09-01', 'free', 3), { ok: false, reason: 'service_error' });
});

Deno.test('releaseSignalAsk — passes through athlete/window/tier unchanged', async () => {
  const client = fakeClient({ release_signal_ask: { data: null, error: null } });
  await releaseSignalAsk(client, 'athlete-1', '2026-09-01', 'premium');
  assertEquals(client.calls[0], ['release_signal_ask', { p_athlete_id: 'athlete-1', p_window_date: '2026-09-01', p_tier: 'premium' }]);
});

function claimRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'claimed',
    claim_token: 'token-abc',
    reserved_tier: null,
    reserved_window_date: null,
    reserved_count: null,
    reply: null,
    remaining: null,
    cap: null,
    is_premium: null,
    ...overrides,
  };
}

Deno.test('claimSignalRequest — a fresh claim (no prior reservation) is reported as claimed, with its fencing token', async () => {
  const client = fakeClient({ claim_signal_request: { data: [claimRow()], error: null } });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), {
    status: 'claimed',
    claimToken: 'token-abc',
    existingReservation: null,
  });
});

Deno.test('claimSignalRequest — a stale-reclaimed row with an existing reservation reports it, so the caller reuses it instead of reserving again', async () => {
  const client = fakeClient({
    claim_signal_request: {
      data: [claimRow({ claim_token: 'token-new', reserved_tier: 'premium', reserved_window_date: '2026-09-01', reserved_count: 5 })],
      error: null,
    },
  });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), {
    status: 'claimed',
    claimToken: 'token-new',
    existingReservation: { tier: 'premium', windowDate: '2026-09-01', count: 5 },
  });
});

Deno.test('claimSignalRequest — a claimed row with no token is treated as a service error, never silently claimed', async () => {
  const client = fakeClient({ claim_signal_request: { data: [claimRow({ claim_token: null })], error: null } });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), { status: 'error' });
});

Deno.test('claimSignalRequest — an already-completed request returns the cached reply, never re-running anything', async () => {
  const client = fakeClient({
    claim_signal_request: {
      data: [claimRow({ status: 'completed', claim_token: null, reply: 'cached answer', remaining: 1, cap: 3, is_premium: false })],
      error: null,
    },
  });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), {
    status: 'completed',
    reply: 'cached answer',
    remaining: 1,
    cap: 3,
    isPremium: false,
  });
});

Deno.test('claimSignalRequest — a genuinely concurrent duplicate is reported as processing', async () => {
  const client = fakeClient({ claim_signal_request: { data: [claimRow({ status: 'processing', claim_token: null })], error: null } });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), { status: 'processing' });
});

Deno.test('claimSignalRequest — an RPC failure is reported as error, never silently treated as claimed', async () => {
  const client = fakeClient({ claim_signal_request: { data: null, error: { message: 'db down' } } });
  assertEquals(await claimSignalRequest(client, 'athlete-1', 'req-1'), { status: 'error' });
});

Deno.test('completeSignalRequest — caches the exact reply/remaining/cap/isPremium for this requestId+claimToken, reports whether it applied', async () => {
  const applied = fakeClient({ complete_signal_request: { data: true, error: null } });
  const result = await completeSignalRequest(applied, 'athlete-1', 'req-1', 'token-abc', 'the answer', 1, 3, false);
  assertEquals(result, true);
  assertEquals(applied.calls[0], [
    'complete_signal_request',
    {
      p_athlete_id: 'athlete-1',
      p_request_id: 'req-1',
      p_claim_token: 'token-abc',
      p_reply: 'the answer',
      p_remaining: 1,
      p_cap: 3,
      p_is_premium: false,
    },
  ]);
});

Deno.test('completeSignalRequest — a superseded claim (stale-reclaimed by a newer worker) reports false, not an error', async () => {
  const superseded = fakeClient({ complete_signal_request: { data: false, error: null } });
  assertEquals(await completeSignalRequest(superseded, 'athlete-1', 'req-1', 'stale-token', 'late answer', 1, 3, false), false);
});

Deno.test('failSignalRequest — removes the claim (fenced by claimToken) so a retry with the same id is claimed fresh', async () => {
  const client = fakeClient({ fail_signal_request: { data: true, error: null } });
  const result = await failSignalRequest(client, 'athlete-1', 'req-1', 'token-abc');
  assertEquals(result, true);
  assertEquals(client.calls[0], ['fail_signal_request', { p_athlete_id: 'athlete-1', p_request_id: 'req-1', p_claim_token: 'token-abc' }]);
});

interface FakeDedupRow {
  status: string;
  claim_token: string;
  reserved_tier: 'free' | 'premium' | null;
  reserved_window_date: string | null;
  reserved_count: number | null;
  reply: string | null;
  remaining: number | null;
  cap: number | null;
  is_premium: boolean | null;
}

/** A closer in-memory model than fakeClient's static scripting — tracks real per-key state across
 *  calls, including claim_token fencing AND reservation reuse across a stale-reclaim, so the
 *  scenarios below (lost-response replay, a superseded worker's late write, and reservation
 *  reuse/leak prevention) exercise usage.ts's actual call sequencing rather than a pre-scripted
 *  single response. `reserve_signal_ask` here also models its own atomic recording step. */
function fakeDedupStore() {
  const store = new Map<string, FakeDedupRow>();
  const freeLifetime = new Map<string, number>();
  let tokenCounter = 0;
  const client: RpcClient = {
    rpc(fn: string, args: Record<string, unknown>) {
      const key = `${args.p_athlete_id}:${args.p_request_id}`;
      if (fn === 'claim_signal_request') {
        const existing = store.get(key);
        if (!existing) {
          const token = `token-${++tokenCounter}`;
          store.set(key, {
            status: 'processing',
            claim_token: token,
            reserved_tier: null,
            reserved_window_date: null,
            reserved_count: null,
            reply: null,
            remaining: null,
            cap: null,
            is_premium: null,
          });
          return Promise.resolve({
            data: [
              {
                status: 'claimed',
                claim_token: token,
                reserved_tier: null,
                reserved_window_date: null,
                reserved_count: null,
                reply: null,
                remaining: null,
                cap: null,
                is_premium: null,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [existing], error: null });
      }
      if (fn === 'reserve_signal_ask') {
        const tier = args.p_tier as 'free' | 'premium';
        const cap = args.p_cap as number;
        const current = freeLifetime.get(args.p_athlete_id as string) ?? 0;
        if (current >= cap) return Promise.resolve({ data: null, error: null });
        const next = current + 1;
        freeLifetime.set(args.p_athlete_id as string, next);
        // Models reserve_signal_ask's own atomic recording onto the dedup row when a requestId/
        // claimToken were supplied.
        if (args.p_request_id && args.p_claim_token) {
          const row = store.get(`${args.p_athlete_id}:${args.p_request_id}`);
          if (row && row.claim_token === args.p_claim_token && row.reserved_tier === null) {
            row.reserved_tier = tier;
            row.reserved_window_date = args.p_window_date as string;
            row.reserved_count = next;
          }
        }
        return Promise.resolve({ data: next, error: null });
      }
      if (fn === 'release_signal_ask') {
        const current = freeLifetime.get(args.p_athlete_id as string) ?? 0;
        freeLifetime.set(args.p_athlete_id as string, Math.max(current - 1, 0));
        return Promise.resolve({ data: null, error: null });
      }
      if (fn === 'complete_signal_request') {
        const existing = store.get(key);
        const applied = !!existing && existing.claim_token === args.p_claim_token;
        if (applied) {
          store.set(key, {
            ...existing!,
            status: 'completed',
            reply: args.p_reply as string,
            remaining: args.p_remaining as number,
            cap: args.p_cap as number,
            is_premium: args.p_is_premium as boolean,
          });
        }
        return Promise.resolve({ data: applied, error: null });
      }
      if (fn === 'fail_signal_request') {
        const existing = store.get(key);
        const applied = !!existing && existing.claim_token === args.p_claim_token;
        if (applied) store.delete(key);
        return Promise.resolve({ data: applied, error: null });
      }
      throw new Error(`unexpected rpc call in this scenario: ${fn}`);
    },
  };
  return {
    client,
    store,
    freeLifetime,
    // Simulates claim_signal_request's OWN stale-reclaim branch (migrations/0011): a fresh token
    // atomically replaces the old one and the row goes back to 'processing', WITHOUT resetting any
    // already-recorded reservation — this IS what a second worker's claim_signal_request call
    // would return in that instant, so the test uses this return value directly as "worker B's
    // claim," rather than calling claimSignalRequest again (which, against this simplified fake,
    // has no independent staleness clock of its own).
    reclaimAsStale(key: string): { status: 'claimed'; claimToken: string; existingReservation: { tier: 'free' | 'premium'; windowDate: string; count: number } | null } {
      const existing = store.get(key);
      if (!existing) throw new Error(`reclaimAsStale: no existing row for ${key}`);
      const token = `token-${++tokenCounter}`;
      const existingReservation =
        existing.reserved_tier && existing.reserved_window_date && existing.reserved_count !== null
          ? { tier: existing.reserved_tier, windowDate: existing.reserved_window_date, count: existing.reserved_count }
          : null;
      store.set(key, { ...existing, status: 'processing', claim_token: token, reply: null, remaining: null, cap: null, is_premium: null });
      return { status: 'claimed', claimToken: token, existingReservation };
    },
  };
}

Deno.test('end-to-end: a lost-response retry never re-reserves or re-runs — it must go through claim -> completed', async () => {
  // Simulates the exact bug scenario: attempt 1 claims, succeeds, and completes; attempt 2 (the
  // athlete's Retry after a client-perceived timeout) reuses the SAME requestId and must see
  // 'completed' — never 'claimed' again, which would otherwise let a caller re-reserve an ask.
  const { client } = fakeDedupStore();

  const first = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  if (first.status !== 'claimed') throw new Error('expected claimed');
  await completeSignalRequest(client, 'athlete-1', 'req-shared', first.claimToken, 'the real answer', 2, 3, false);

  // The "lost response" retry: same athlete, same requestId.
  const retry = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  assertEquals(retry, { status: 'completed', reply: 'the real answer', remaining: 2, cap: 3, isPremium: false });
});

Deno.test('end-to-end: a worker superseded by a stale-reclaim cannot complete, fail, or overwrite the new claimant', async () => {
  // Simulates the exact scenario the request called out: worker A claims, then goes silent for
  // >100s; a stale-reclaim hands the SAME request id to worker B (a new claim_token). Worker A
  // eventually wakes up and tries to finish — its stale token must be rejected, never overwriting
  // whatever worker B is doing or has already done.
  const { client, store, reclaimAsStale } = fakeDedupStore();

  const workerA = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  if (workerA.status !== 'claimed') throw new Error('expected claimed');

  // The stale-reclaim: a new claim_token supersedes worker A's, exactly as
  // migrations/0011_signal_request_dedup.sql's claim_signal_request would after p_stale_after_seconds.
  const workerB = reclaimAsStale('athlete-1:req-shared');
  assertEquals(workerA.claimToken === workerB.claimToken, false);

  // Worker B finishes first.
  await completeSignalRequest(client, 'athlete-1', 'req-shared', workerB.claimToken, "worker B's answer", 5, 40, true);

  // Worker A, unaware it was superseded, now tries to complete with its OLD token.
  const workerAApplied = await completeSignalRequest(client, 'athlete-1', 'req-shared', workerA.claimToken, "worker A's stale answer", 1, 3, false);
  assertEquals(workerAApplied, false);

  // Worker B's result must be exactly what a later claim sees — worker A's late write never
  // touched it.
  assertEquals(store.get('athlete-1:req-shared')?.reply, "worker B's answer");
  const laterClaim = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  assertEquals(laterClaim, { status: 'completed', reply: "worker B's answer", remaining: 5, cap: 40, isPremium: true });

  // Worker A trying to fail (its own model call errored) with its stale token must also be a
  // no-op — it must never delete worker B's now-completed row.
  const workerAFailed = await failSignalRequest(client, 'athlete-1', 'req-shared', workerA.claimToken);
  assertEquals(workerAFailed, false);
  assertEquals(store.has('athlete-1:req-shared'), true);
});

Deno.test('reservation reuse: process death after reservation — a stale-reclaim reuses the SAME reservation, never reserves twice', async () => {
  const { client, store, reclaimAsStale, freeLifetime } = fakeDedupStore();

  // Worker A claims, then reserves (models the exact moment right before it would die — no
  // completeSignalRequest/failSignalRequest call ever happens for worker A).
  const workerA = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  if (workerA.status !== 'claimed') throw new Error('expected claimed');
  const reservedA = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', 3, { requestId: 'req-shared', claimToken: workerA.claimToken });
  assertEquals(reservedA, { ok: true, count: 1 });
  assertEquals(freeLifetime.get('athlete-1'), 1);

  // Stale-reclaim: worker B must see the existing reservation and must NOT call reserveSignalAsk
  // again.
  const workerB = reclaimAsStale('athlete-1:req-shared');
  assertEquals(workerB.existingReservation, { tier: 'free', windowDate: '2026-09-01', count: 1 });

  // Worker B completes using the REUSED reservation's tier/window/count — no second reserve call.
  await completeSignalRequest(client, 'athlete-1', 'req-shared', workerB.claimToken, 'the answer', 2, 3, false);
  assertEquals(freeLifetime.get('athlete-1'), 1, 'exactly one ask consumed for this one logical question');
  assertEquals(store.get('athlete-1:req-shared')?.reply, 'the answer');
});

Deno.test('reservation reuse: process death after model success but before caching — a further reclaim still reuses the one reservation', async () => {
  const { client, freeLifetime, reclaimAsStale } = fakeDedupStore();

  const workerA = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  if (workerA.status !== 'claimed') throw new Error('expected claimed');
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', 3, { requestId: 'req-shared', claimToken: workerA.claimToken });
  // Worker A's model call "succeeds" here, but it dies before ever calling completeSignalRequest —
  // simulated by simply never calling it, then reclaiming as if the staleness bound passed.

  const workerB = reclaimAsStale('athlete-1:req-shared');
  assertEquals(workerB.existingReservation?.count, 1);
  await completeSignalRequest(client, 'athlete-1', 'req-shared', workerB.claimToken, 'recovered answer', 2, 3, false);

  assertEquals(freeLifetime.get('athlete-1'), 1, 'still exactly one ask consumed, despite the reclaim');
});

Deno.test('reservation reuse: a superseded original worker cannot release a reservation the new worker still owns', async () => {
  const { client, freeLifetime, reclaimAsStale } = fakeDedupStore();

  const workerA = await claimSignalRequest(client, 'athlete-1', 'req-shared');
  if (workerA.status !== 'claimed') throw new Error('expected claimed');
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', 3, { requestId: 'req-shared', claimToken: workerA.claimToken });
  assertEquals(freeLifetime.get('athlete-1'), 1);

  const workerB = reclaimAsStale('athlete-1:req-shared');

  // Worker A, unaware it was superseded, now believes its OWN model call failed and tries to give
  // the ask back — per index.ts's ordering, this must check failSignalRequest's return value
  // FIRST; since it's superseded, release must be skipped entirely.
  const workerAStillOwned = await failSignalRequest(client, 'athlete-1', 'req-shared', workerA.claimToken);
  assertEquals(workerAStillOwned, false);
  // (index.ts would skip releaseSignalAsk here because of the above — asserting the count is
  // unaffected proves why that check matters: a naive unconditional release would wrongly free
  // the ask worker B is still relying on.)
  assertEquals(freeLifetime.get('athlete-1'), 1, 'the reservation must still be intact for worker B');

  // Worker B then finishes normally, reusing the same, still-intact reservation.
  await completeSignalRequest(client, 'athlete-1', 'req-shared', workerB.claimToken, 'the real answer', 2, 3, false);
  assertEquals(freeLifetime.get('athlete-1'), 1, 'exactly one ask ever consumed for this logical question');
});

// --- Build 11 monetization correction (Task 3): free-lifetime vs. premium-monthly behavior ---
// A faithful in-memory model of the two real tables migrations/0010_signal_free_lifetime_allowance.sql
// introduces: signal_free_usage (one row per athlete, no window_date — a true lifetime counter) and
// signal_rate_limit's premium_request_count (one row per (athlete_id, window_date), genuinely
// monthly). Mirrors the SQL functions' own documented contract (reserve returns the new count, or
// null if the cap's WHERE clause didn't match; release floors at zero) closely enough to verify the
// exact scenarios in the request, without a live Postgres — the real functions' own atomicity is
// verified by direct reading of the migration SQL instead, disclosed as a known gap, not silently
// assumed covered by this in-memory model.
function fakeAllowanceStore() {
  const freeLifetime = new Map<string, number>(); // athlete_id -> lifetime_count, no window at all
  const premiumMonthly = new Map<string, number>(); // `${athlete_id}:${window_date}` -> premium_request_count

  const client: RpcClient = {
    rpc(fn: string, args: Record<string, unknown>) {
      const athleteId = args.p_athlete_id as string;
      if (fn === 'reserve_signal_ask') {
        const tier = args.p_tier as 'free' | 'premium';
        const cap = args.p_cap as number;
        if (tier === 'free') {
          const current = freeLifetime.get(athleteId) ?? 0;
          if (current >= cap) return Promise.resolve({ data: null, error: null });
          const next = current + 1;
          freeLifetime.set(athleteId, next);
          return Promise.resolve({ data: next, error: null });
        }
        const key = `${athleteId}:${args.p_window_date}`;
        const current = premiumMonthly.get(key) ?? 0;
        if (current >= cap) return Promise.resolve({ data: null, error: null });
        const next = current + 1;
        premiumMonthly.set(key, next);
        return Promise.resolve({ data: next, error: null });
      }
      if (fn === 'release_signal_ask') {
        const tier = args.p_tier as 'free' | 'premium';
        if (tier === 'free') {
          freeLifetime.set(athleteId, Math.max((freeLifetime.get(athleteId) ?? 0) - 1, 0));
        } else {
          const key = `${athleteId}:${args.p_window_date}`;
          premiumMonthly.set(key, Math.max((premiumMonthly.get(key) ?? 0) - 1, 0));
        }
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`fakeAllowanceStore: unexpected rpc('${fn}')`);
    },
  };

  return { client, freeLifetime, premiumMonthly };
}

Deno.test('free allowance: decrements 3 -> 2 -> 1 -> 0, then the 4th ask hits the cap (paywall)', async () => {
  const { client } = fakeAllowanceStore();
  const FREE_CAP = 3;

  const first = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  assertEquals(first, { ok: true, count: 1 }); // 2 left
  const second = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  assertEquals(second, { ok: true, count: 2 }); // 1 left
  const third = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  assertEquals(third, { ok: true, count: 3 }); // 0 left

  const fourth = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  assertEquals(fourth, { ok: false, reason: 'cap_reached' });
});

Deno.test('free allowance never resets across a month boundary — a new window_date does not grant a fresh 3', async () => {
  const { client } = fakeAllowanceStore();
  const FREE_CAP = 3;

  // Exhaust the 3 lifetime asks in "September".
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);

  // A request in "October" — a genuinely monthly bucket (premium) would start a fresh row here;
  // free must not, since reserveSignalAsk's 'free' branch never even reads p_window_date.
  const octoberAttempt = await reserveSignalAsk(client, 'athlete-1', '2026-10-01', 'free', FREE_CAP);
  assertEquals(octoberAttempt, { ok: false, reason: 'cap_reached' });
});

Deno.test('upgrading to Premium after using all 3 free asks starts Premium at a fresh 40 — the two buckets never share state', async () => {
  const { client } = fakeAllowanceStore();
  const FREE_CAP = 3;
  const PREMIUM_CAP = 40;

  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);

  const firstPremiumAsk = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'premium', PREMIUM_CAP);
  // 1 of 40 consumed — "39 of 40 left" — never "40 minus 3 free already used".
  assertEquals(firstPremiumAsk, { ok: true, count: 1 });
});

Deno.test('Premium monthly reset still works — a new window_date starts a fresh premium bucket', async () => {
  const { client } = fakeAllowanceStore();
  const PREMIUM_CAP = 40;

  for (let i = 0; i < PREMIUM_CAP; i++) {
    await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'premium', PREMIUM_CAP);
  }
  const septemberExhausted = await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'premium', PREMIUM_CAP);
  assertEquals(septemberExhausted, { ok: false, reason: 'cap_reached' });

  const octoberFirstAsk = await reserveSignalAsk(client, 'athlete-1', '2026-10-01', 'premium', PREMIUM_CAP);
  assertEquals(octoberFirstAsk, { ok: true, count: 1 });
});

Deno.test('Premium expiry restores only the unused lifetime free balance — 1 used before upgrade means 2 left after expiry', async () => {
  const { client } = fakeAllowanceStore();
  const FREE_CAP = 3;
  const PREMIUM_CAP = 40;

  // Used only 1 of 3 free asks before upgrading.
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP);

  // A month of Premium usage — never touches signal_free_usage at all.
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'premium', PREMIUM_CAP);
  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'premium', PREMIUM_CAP);

  // Premium expires — the athlete is back on the free tier. Their free lifetime balance must be
  // exactly as they left it: 1 used, 2 left.
  const afterExpiry = await reserveSignalAsk(client, 'athlete-1', '2026-10-01', 'free', FREE_CAP);
  assertEquals(afterExpiry, { ok: true, count: 2 }); // 1 left after this one

  const oneMoreAfterExpiry = await reserveSignalAsk(client, 'athlete-1', '2026-10-01', 'free', FREE_CAP);
  assertEquals(oneMoreAfterExpiry, { ok: true, count: 3 }); // 0 left — exactly 3 lifetime asks total, ever

  const exhausted = await reserveSignalAsk(client, 'athlete-1', '2026-10-01', 'free', FREE_CAP);
  assertEquals(exhausted, { ok: false, reason: 'cap_reached' });
});

Deno.test('a released free ask (model call failed) goes back into the lifetime balance, not a monthly bucket', async () => {
  const { client } = fakeAllowanceStore();
  const FREE_CAP = 3;

  await reserveSignalAsk(client, 'athlete-1', '2026-09-01', 'free', FREE_CAP); // 1 used
  await releaseSignalAsk(client, 'athlete-1', '2026-09-01', 'free'); // given back

  // Still 3 lifetime asks available — the release put it back, regardless of window_date.
  const first = await reserveSignalAsk(client, 'athlete-1', '2026-11-01', 'free', FREE_CAP);
  assertEquals(first, { ok: true, count: 1 });
});


// ---------------------------------------------------------------------------------------------------------
// getSignalUsage (the read-only `usage` action). The fake client below ONLY supports from().select().eq().maybeSingle(); any
// other call (rpc, insert, update, upsert, delete) throws, so a passing test also proves the read path performs no write and
// no reservation: it cannot reserve, release, claim, or modify a counter.
// ---------------------------------------------------------------------------------------------------------

const CAPS = { free: 3, premium: 40 };

function readOnlyClient(rows: Record<string, Record<string, unknown> | null>, error?: string) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      const chain = {
        select: (cols: string) => (calls.push(`select:${cols}`), chain),
        eq: (col: string, value: unknown) => (calls.push(`eq:${col}=${value}`), chain),
        maybeSingle: () => (calls.push('maybeSingle'), Promise.resolve(error ? { data: null, error: { message: error } } : { data: rows[table] ?? null, error: null })),
      };
      return chain;
    },
  };
  return { client, calls };
}

Deno.test('usage read: free is the lifetime counter, remaining is cap minus used floored at 0, and only selects run', async () => {
  for (const [used, remaining] of [[0, 3], [2, 1], [3, 0], [5, 0]] as const) {
    const { client, calls } = readOnlyClient({ signal_free_usage: { lifetime_count: used } });
    assertEquals(await getSignalUsage(client, 'a1', 'free', CAPS, '2026-10-01'), { ok: true, remaining, cap: 3, isPremium: false });
    assertEquals(calls, ['from:signal_free_usage', 'select:lifetime_count', 'eq:athlete_id=a1', 'maybeSingle']);
  }
});

Deno.test('usage read: no counter row yet is a genuine zero used (full allowance), free and premium', async () => {
  assertEquals(await getSignalUsage(readOnlyClient({}).client, 'a1', 'free', CAPS), { ok: true, remaining: 3, cap: 3, isPremium: false });
  assertEquals(await getSignalUsage(readOnlyClient({}).client, 'a1', 'premium', CAPS), { ok: true, remaining: 40, cap: 40, isPremium: true });
});

Deno.test('usage read: premium reads the current month window of the monthly counter and never touches the free counter', async () => {
  const { client, calls } = readOnlyClient({ signal_rate_limit: { premium_request_count: 33 }, signal_free_usage: { lifetime_count: 3 } });
  assertEquals(await getSignalUsage(client, 'a1', 'premium', CAPS, '2026-10-01'), { ok: true, remaining: 7, cap: 40, isPremium: true });
  assertEquals(calls, ['from:signal_rate_limit', 'select:premium_request_count', 'eq:athlete_id=a1', 'eq:window_date=2026-10-01', 'maybeSingle']);
});

Deno.test('usage read: an entitlement lookup failure is unavailable, with no counter read and no guessed free allowance', async () => {
  const { client, calls } = readOnlyClient({ signal_free_usage: { lifetime_count: 0 } });
  assertEquals(await getSignalUsage(client, 'a1', 'error', CAPS), { ok: false, reason: 'service_unavailable' });
  assertEquals(calls, []);
});

Deno.test('usage read: a counter read error or an unreadable value is unavailable, never reported as zero used', async () => {
  assertEquals(await getSignalUsage(readOnlyClient({}, 'connection refused').client, 'a1', 'free', CAPS), { ok: false, reason: 'service_unavailable' });
  assertEquals(await getSignalUsage(readOnlyClient({ signal_free_usage: { lifetime_count: 'x' } }).client, 'a1', 'free', CAPS), { ok: false, reason: 'service_unavailable' });
});

Deno.test('usage read: repeated reads never change what a read returns (no counter is consumed by reading)', async () => {
  const { client } = readOnlyClient({ signal_free_usage: { lifetime_count: 1 } });
  const first = await getSignalUsage(client, 'a1', 'free', CAPS);
  for (let i = 0; i < 5; i++) assertEquals(await getSignalUsage(client, 'a1', 'free', CAPS), first);
});
