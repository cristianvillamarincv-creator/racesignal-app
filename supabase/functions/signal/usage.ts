// Signal's ask-reservation and request-dedup bookkeeping — factored out of index.ts so this
// logic (which branches on RPC results, but does no HTTP/model-call work of its own) is directly
// unit-testable, matching how systemPrompt.ts's buildSystemPrompt is already split out for the
// same reason. `client` is passed in explicitly (rather than each function creating its own
// service-role client) so tests can supply a fake with a scripted `.rpc()`.

// Minimal shape of the one Supabase client method this file actually calls — deliberately loose
// (`any` return) rather than trying to structurally match supabase-js's real `.rpc()` return type
// (a thenable PostgrestFilterBuilder, not a literal Promise), which would make a real
// SupabaseClient and a plain test double equally awkward to satisfy for no real benefit — every
// call site below already destructures/casts `data`/`error` explicitly, exactly as the original
// inline code in index.ts did.
export interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
}

/**
 * The monthly reset boundary, exact and deterministic: the first day of the CURRENT UTC calendar
 * month (e.g. "2026-09-01"), used as signal_rate_limit's window_date for PREMIUM only (free is a
 * lifetime counter as of migrations/0010_signal_free_lifetime_allowance.sql and ignores this
 * value). There is no cron/reset job for premium either — a request made in a new month simply
 * writes a new row (window_date changed, and it's part of the table's primary key), starting fresh
 * at count 1. The boundary is midnight UTC on the 1st.
 */
export function currentMonthWindow(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

/**
 * Reliability investigation (B.1 Task 1d) — `reserve_signal_ask` returning null is genuinely
 * ambiguous at the SQL level: the `WHERE ... < p_cap` clause not matching (the athlete is really at
 * cap) and the RPC call itself failing (a real entitlement/rate-limit-SERVICE failure — db/network
 * issue reaching Supabase, not anything about the athlete's own usage) both come back as `data ===
 * null`. Before this type existed, both were reported to the athlete as `unavailable('rate_limited')`
 * — a real service failure would incorrectly read as "you've used up your asks," which is both
 * misleading and indistinguishable in logs from the ordinary, expected cap case. Distinguishing the
 * two here (rather than deferring to the mobile client) means the ONE place that knows which
 * happened is the one place that decides what to tell the athlete.
 */
export type ReserveResult = { ok: true; count: number } | { ok: false; reason: 'cap_reached' | 'service_error' };

/**
 * Atomically reserves one ask in the bucket for `tier` ('free' or 'premium') if the athlete is
 * still under `cap` for THAT bucket specifically. `free` and `premium` are genuinely different
 * bucket TYPES as of migrations/0010_signal_free_lifetime_allowance.sql — `free` is a single
 * lifetime counter in signal_free_usage (one row per athlete, `windowDate` unused/ignored), while
 * `premium` remains the real per-UTC-calendar-month counter in signal_rate_limit. Upgrading to
 * premium always starts its monthly counter at 0 ("40 minus whatever free already used" never
 * happens, because they're different counters entirely) — and if premium later expires, the
 * athlete's free lifetime balance is exactly as they left it, since nothing about a premium
 * reservation ever touches signal_free_usage. Concurrent requests from the same athlete still
 * serialize on the row via INSERT ... ON CONFLICT DO UPDATE ... WHERE, so two simultaneous requests
 * at cap-1 can't both squeeze through, for either bucket type.
 */
/**
 * `requestId`/`claimToken`, when both supplied, ALSO atomically records this reservation onto the
 * matching signal_request_dedup row, in the same server round-trip — this is the Build 11
 * follow-up correction that closes the last real gap in the dedup design: without recording the
 * reservation somewhere a stale-reclaim can find it, a worker that reserved successfully and then
 * died before caching an answer would leave the reclaiming worker no way to know an ask was already
 * spent, so it would reserve (and consume) a second one for the same logical question. Omit both
 * for a caller with no dedup tracking at all (an older client that never sent a requestId — see
 * index.ts's Build 10 compatibility handling) to get exactly the pre-Build-11 behavior, unchanged.
 */
export async function reserveSignalAsk(
  client: RpcClient,
  athleteId: string,
  windowDate: string,
  tier: 'free' | 'premium',
  cap: number,
  dedup?: { requestId: string; claimToken: string },
): Promise<ReserveResult> {
  const { data, error } = await client.rpc('reserve_signal_ask', {
    p_athlete_id: athleteId,
    p_window_date: windowDate,
    p_tier: tier,
    p_cap: cap,
    p_request_id: dedup?.requestId ?? null,
    p_claim_token: dedup?.claimToken ?? null,
  });
  if (error) {
    console.warn('[signal] reserve_signal_ask RPC failed (entitlement/rate-limit service error, NOT a real cap) —', error.message);
    return { ok: false, reason: 'service_error' };
  }
  if (data === null) return { ok: false, reason: 'cap_reached' };
  return { ok: true, count: data as number };
}

/** Gives back a slot reserved by reserveSignalAsk (same tier) when the model call itself then
 *  fails — only a genuinely successful reply should consume an ask. Best-effort: a failure here
 *  just means the athlete's count is one higher than it should be, never a crash of the response
 *  we already owe them. */
export async function releaseSignalAsk(client: RpcClient, athleteId: string, windowDate: string, tier: 'free' | 'premium'): Promise<void> {
  const { error } = await client.rpc('release_signal_ask', { p_athlete_id: athleteId, p_window_date: windowDate, p_tier: tier });
  if (error) console.warn('[signal] release_signal_ask failed —', error.message);
}

/**
 * Build 11 reliability correction (Task 2) — see migrations/0011_signal_request_dedup.sql for the
 * full reasoning: a client-perceived timeout does not prove the server never completed (and
 * consumed a real ask for) this exact question, so a Retry must be able to tell "already answered,
 * hand back the cached reply" apart from "genuinely new, do the real work" apart from "someone
 * else's attempt at this same id is still running right now." `claimToken` on the 'claimed' variant
 * is a fencing token: it MUST be passed back to completeSignalRequest/failSignalRequest for this
 * exact attempt, so a worker that gets superseded by a later stale-reclaim can never overwrite the
 * new claimant's state (see the migration's own comment on claim_signal_request).
 */
/** `existingReservation`, when present on the 'claimed' variant, means an ask was ALREADY reserved
 *  for this exact logical question by a now-abandoned prior attempt (this is a stale-reclaim) — the
 *  caller MUST skip reserveSignalAsk entirely and reuse this exact tier/window/count for any
 *  eventual completion or release, so accounting never shifts to a freshly-resolved tier and never
 *  double-reserves. Absent means no reservation exists yet — a genuinely fresh attempt. */
export type ClaimResult =
  | {
      status: 'claimed';
      claimToken: string;
      existingReservation: { tier: 'free' | 'premium'; windowDate: string; count: number } | null;
    }
  | { status: 'completed'; reply: string; remaining: number; cap: number; isPremium: boolean }
  | { status: 'processing' }
  | { status: 'error' };

export async function claimSignalRequest(client: RpcClient, athleteId: string, requestId: string): Promise<ClaimResult> {
  const { data, error } = await client.rpc('claim_signal_request', {
    p_athlete_id: athleteId,
    p_request_id: requestId,
  });
  if (error) {
    console.warn('[signal] claim_signal_request RPC failed —', error.message);
    return { status: 'error' };
  }
  const row = (
    data as {
      status: string;
      claim_token: string | null;
      reserved_tier: string | null;
      reserved_window_date: string | null;
      reserved_count: number | null;
      reply: string | null;
      remaining: number | null;
      cap: number | null;
      is_premium: boolean | null;
    }[]
  )[0];
  if (!row) {
    console.warn('[signal] claim_signal_request RPC returned no row — treating as a service error.');
    return { status: 'error' };
  }
  if (row.status === 'claimed') {
    if (!row.claim_token) {
      console.warn('[signal] claim_signal_request reported claimed with no claim_token — treating as a service error.');
      return { status: 'error' };
    }
    const existingReservation =
      row.reserved_tier && row.reserved_window_date && row.reserved_count !== null
        ? { tier: row.reserved_tier as 'free' | 'premium', windowDate: row.reserved_window_date, count: row.reserved_count }
        : null;
    return { status: 'claimed', claimToken: row.claim_token, existingReservation };
  }
  if (row.status === 'processing') return { status: 'processing' };
  return { status: 'completed', reply: row.reply ?? '', remaining: row.remaining ?? 0, cap: row.cap ?? 0, isPremium: !!row.is_premium };
}

/** Returns whether this exact `claimToken` was still the row's current one at write time — false
 *  means this worker was already superseded by a stale-reclaim (see claim_signal_request), and no
 *  write happened; the caller (index.ts) logs this as a notable-but-not-athlete-facing event. */
export async function completeSignalRequest(
  client: RpcClient,
  athleteId: string,
  requestId: string,
  claimToken: string,
  reply: string,
  remaining: number,
  cap: number,
  isPremium: boolean,
): Promise<boolean> {
  const { data, error } = await client.rpc('complete_signal_request', {
    p_athlete_id: athleteId,
    p_request_id: requestId,
    p_claim_token: claimToken,
    p_reply: reply,
    p_remaining: remaining,
    p_cap: cap,
    p_is_premium: isPremium,
  });
  if (error) {
    console.warn('[signal] complete_signal_request failed —', error.message);
    return false;
  }
  return !!data;
}

/** Removes the claimed row (only if `claimToken` still matches — see completeSignalRequest's same
 *  fencing note) so a retry with the SAME request id is treated as a brand-new attempt — called
 *  alongside releaseSignalAsk whenever the model call itself fails. */
export async function failSignalRequest(client: RpcClient, athleteId: string, requestId: string, claimToken: string): Promise<boolean> {
  const { data, error } = await client.rpc('fail_signal_request', {
    p_athlete_id: athleteId,
    p_request_id: requestId,
    p_claim_token: claimToken,
  });
  if (error) {
    console.warn('[signal] fail_signal_request failed —', error.message);
    return false;
  }
  return !!data;
}


// ---------------------------------------------------------------------------------------------------------
// Read-only usage (the `usage` action). Uses the SAME tier, caps, window and counters the ask reservation uses
// (free: signal_free_usage.lifetime_count, a lifetime counter; premium: signal_rate_limit.premium_request_count for the
// current UTC month) but only ever SELECTs them. It never calls reserve/release/claim, never writes, and the model is
// never involved, so reading the allowance can never consume or change it.
// ---------------------------------------------------------------------------------------------------------

/** Minimal shape of the one Supabase client method the read path uses: `from(table)` followed by a select chain. */
export interface TableClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export type EntitlementStatus = 'premium' | 'free' | 'error';

/** The instant the monthly Premium counter next starts over: midnight UTC at the start of the next UTC calendar month. The quota
 *  follows UTC calendar months (see currentMonthWindow), never the subscription's billing date. */
export function nextMonthWindowStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export type UsageSnapshot =
  | {
      ok: true;
      remaining: number;
      cap: number;
      isPremium: boolean;
      /** Premium only: when the monthly counter next resets (an ISO instant). Null for free, whose 3 asks are a lifetime total
       *  that never resets. */
      resetsAt: string | null;
    }
  | { ok: false; reason: 'service_unavailable' };

/** The number of asks already used in the bucket for `tier`, or `ok: false` if it could not be read (never guessed as 0). */
async function readUsedCount(
  client: TableClient,
  athleteId: string,
  tier: 'free' | 'premium',
  windowDate: string,
): Promise<{ ok: true; count: number } | { ok: false }> {
  const base =
    tier === 'free'
      ? client.from('signal_free_usage').select('lifetime_count').eq('athlete_id', athleteId)
      : client.from('signal_rate_limit').select('premium_request_count').eq('athlete_id', athleteId).eq('window_date', windowDate);
  const { data, error } = await base.maybeSingle();
  if (error) {
    console.warn('[signal] usage read failed (not an empty allowance) \u2014', error.message);
    return { ok: false };
  }
  const raw = tier === 'free' ? data?.lifetime_count : data?.premium_request_count;
  // No row yet is a genuine zero: nothing has been used. Anything else that is not a number is unreadable, not zero.
  if (data === null || data === undefined) return { ok: true, count: 0 };
  return typeof raw === 'number' && Number.isFinite(raw) ? { ok: true, count: raw } : { ok: false };
}

/**
 * Remaining asks for an already-authenticated athlete, given the entitlement the caller resolved (the same RevenueCat lookup
 * the reservation path uses). An entitlement lookup or counter read that failed is a failure, never a guessed count.
 * `remaining` is computed exactly as a reply computes it: cap minus used, floored at 0.
 */
export async function getSignalUsage(
  client: TableClient,
  athleteId: string,
  entitlement: EntitlementStatus,
  caps: { free: number; premium: number },
  windowDate: string = currentMonthWindow(),
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  if (entitlement === 'error') return { ok: false, reason: 'service_unavailable' };
  const isPremium = entitlement === 'premium';
  const tier = isPremium ? 'premium' : 'free';
  const cap = isPremium ? caps.premium : caps.free;
  const used = await readUsedCount(client, athleteId, tier, windowDate);
  if (!used.ok) return { ok: false, reason: 'service_unavailable' };
  return { ok: true, remaining: Math.max(cap - used.count, 0), cap, isPremium, resetsAt: isPremium ? nextMonthWindowStart(now) : null };
}
