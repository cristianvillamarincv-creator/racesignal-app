-- Build 11 reliability correction — a client-perceived timeout/network failure does NOT mean the
-- server never completed the answer: the model call can succeed and consume a real ask, then the
-- response is simply lost on the way back (dropped connection, the client already gave up after
-- its own SIGNAL_CALL_TIMEOUT_MS). Before this migration, an athlete-initiated Retry after that had
-- no way to tell "this exact question already has a real answer waiting" apart from "this is a
-- genuinely new question" — it would silently re-run the model and consume a SECOND ask for one
-- logical question. `reserve_signal_ask`/`release_signal_ask` alone cannot fix this: releasing on
-- a FAILED model call was already correct; this is the case where the model call SUCCEEDED and the
-- ask was correctly (not mistakenly) consumed, but the client never found out.
--
-- One row per (athlete_id, request_id) — the client generates and reuses one stable id per LOGICAL
-- question, across every attempt at it including a Retry (see mobile lib/signal.ts's
-- generateSignalRequestId / signal.tsx's retryLastMessage). The primary key includes athlete_id,
-- so two different athletes' clients reusing the same id string can never collide or leak a cached
-- answer across accounts.
--
-- `claim_token` is a fencing token, not just a status flag — see claim_signal_request's own comment
-- for the exact race it closes: without it, an abandoned worker that eventually wakes up and
-- finishes AFTER a stale-reclaim has already handed the same request id to a second worker could
-- overwrite the second worker's in-progress or completed state with its own (stale) result.
-- complete_signal_request/fail_signal_request only take effect when the caller's token still
-- matches the row's CURRENT token — a mismatch means this worker's claim was superseded, and the
-- call is a safe no-op.
--
-- `reserved_tier`/`reserved_window_date`/`reserved_count` (Build 11 follow-up correction) track
-- WHETHER an ask has already been reserved for this exact logical question, and against which
-- tier/month — see reserve_signal_ask's own comment for why this closes the last real gap: without
-- it, a stale-reclaim of a worker that reserved successfully but then died before caching an answer
-- would reserve a SECOND ask for the same question, since the new worker would have no way to know
-- one was already spent. These three columns are the one piece of state a stale-reclaim explicitly
-- PRESERVES (never reset) — everything else about the prior attempt (its reply/remaining/cap/
-- is_premium, which describe a MODEL RESPONSE, not the reservation itself) is safe to discard.
create table signal_request_dedup (
  athlete_id           uuid not null references athlete_profiles(id) on delete cascade,
  request_id           text not null,
  status               text not null check (status in ('processing', 'completed')),
  claim_token          uuid not null default gen_random_uuid(),
  reserved_tier        text check (reserved_tier in ('free', 'premium')),
  reserved_window_date date,
  reserved_count       int,
  reply                text,
  remaining            int,
  cap                  int,
  is_premium           boolean,
  created_at           timestamptz not null default now(),
  primary key (athlete_id, request_id)
);

alter table signal_request_dedup enable row level security;
-- Same shape as signal_rate_limit/signal_free_usage: RLS enabled, no policies — service-role only.
-- No grants to anon/authenticated either (see the function-level revokes below) — this table and
-- every function on it are reachable only through the Edge Function's own service-role client.

-- No scheduled cleanup job exists for this table yet — a deliberate, disclosed limitation, not an
-- oversight. Volume is low (at most one row per athlete per Signal question ever asked — the same
-- order of magnitude as signal_usage_log, which has run unpruned since Step 8.4) and each row is a
-- handful of small columns. If storage ever becomes a real concern, a future migration can add a
-- cron job (e.g. pg_cron) pruning completed rows older than a few days — safe to add later without
-- touching the claim/complete/fail functions below, since none of them depend on old rows existing.

-- Atomically claims (athlete_id, request_id) for a fresh attempt, or reports back an existing
-- attempt's state. Returns exactly one row:
--  - status='claimed': either no prior row existed, or the only prior row was abandoned (see
--    p_stale_after_seconds) — either way, a fresh `claim_token` is now on the row and returned
--    here. The Edge Function now owns this request id. If `reserved_tier` comes back non-null, an
--    ask was ALREADY reserved for this exact question by a now-abandoned prior attempt — the Edge
--    Function must REUSE that reservation (skip reserve_signal_ask entirely) rather than reserving
--    a second one, and must account any eventual completion/release against `reserved_tier`/
--    `reserved_window_date`/`reserved_count`, never a freshly-resolved tier, so a mid-flight
--    entitlement change can't shift which bucket this question is charged against. Either way, the
--    Edge Function must call complete_signal_request/fail_signal_request WITH THIS EXACT TOKEN when
--    done.
--  - status='completed': an earlier attempt with this EXACT (athlete_id, request_id) already
--    finished successfully. reply/remaining/cap/is_premium are the cached result — the Edge
--    Function must return this directly: no reserve, no model call, no second ask consumed.
--  - status='processing': a genuinely concurrent attempt with this exact id is still in flight
--    (its row is younger than p_stale_after_seconds) — the Edge Function should tell the client to
--    wait briefly rather than run a second concurrent model call for the same question.
--
-- Both the fresh-insert path (INSERT ... ON CONFLICT DO NOTHING) and the stale-reclaim path
-- (UPDATE ... WHERE ... AND created_at < now() - stale_interval) are single atomic statements
-- whose own WHERE/ON CONFLICT clause IS the concurrency guard — never a separate SELECT-then-
-- decide-then-UPDATE, which would be a classic check-then-act race. This is what makes a
-- stale-reclaim itself safe under concurrency: if two workers both decide the SAME row looks
-- stale and both run this reclaim UPDATE, Postgres serializes them on the row lock — the first to
-- commit refreshes `created_at` to `now()`, so once the second is unblocked, ITS OWN copy of the
-- WHERE clause is re-evaluated against that now-fresh row and no longer matches (created_at is no
-- longer old enough) — its UPDATE affects zero rows, `claim_token` comes back null, and it falls
-- through to report 'processing' instead of also believing it claimed the row. Exactly one caller
-- can ever win a genuine stale-reclaim race, the same guarantee reserve_signal_ask's own
-- conditional UPDATE already relies on for its cap check.
create or replace function claim_signal_request(p_athlete_id uuid, p_request_id text, p_stale_after_seconds int default 100)
returns table(
  status text,
  claim_token uuid,
  reserved_tier text,
  reserved_window_date date,
  reserved_count int,
  reply text,
  remaining int,
  cap int,
  is_premium boolean
)
language plpgsql
set search_path = public
as $$
declare
  v_token uuid;
  v_existing signal_request_dedup;
begin
  insert into signal_request_dedup (athlete_id, request_id, status)
  values (p_athlete_id, p_request_id, 'processing')
  on conflict (athlete_id, request_id) do nothing
  returning signal_request_dedup.claim_token into v_token;

  if v_token is not null then
    -- A genuinely fresh row — nothing was ever reserved for this request id yet.
    return query select 'claimed'::text, v_token, null::text, null::date, null::int, null::text, null::int, null::int, null::boolean;
    return;
  end if;

  -- `signal_request_dedup.status`/`.cap` etc. are qualified below (not just `status`/`cap`)
  -- because this function's own OUT parameters (returns table(status text, ..., cap int, ...))
  -- share those names — left unqualified, PL/pgSQL cannot tell whether a bare reference means the
  -- OUT parameter or the table column ("column reference is ambiguous"), confirmed by actually
  -- running this migration against a real Postgres instance (never surfaced by mocked-client unit
  -- tests). reserved_tier/reserved_window_date/reserved_count are DELIBERATELY ABSENT from this
  -- SET clause — a stale-reclaim must preserve whatever reservation the abandoned attempt already
  -- made, never reset it back to "not yet reserved."
  update signal_request_dedup
  set status = 'processing',
      created_at = now(),
      claim_token = gen_random_uuid(),
      reply = null,
      remaining = null,
      cap = null,
      is_premium = null
  where signal_request_dedup.athlete_id = p_athlete_id
    and signal_request_dedup.request_id = p_request_id
    and signal_request_dedup.status = 'processing'
    and signal_request_dedup.created_at < now() - make_interval(secs => p_stale_after_seconds)
  returning signal_request_dedup.claim_token into v_token;

  if v_token is not null then
    select * into v_existing from signal_request_dedup
    where athlete_id = p_athlete_id and request_id = p_request_id;
    return query select 'claimed'::text, v_token, v_existing.reserved_tier, v_existing.reserved_window_date, v_existing.reserved_count,
      null::text, null::int, null::int, null::boolean;
    return;
  end if;

  -- Neither the insert nor the reclaim happened — this row is genuinely still live (a real
  -- concurrent duplicate) or already completed. Report its actual current state.
  select * into v_existing from signal_request_dedup
  where athlete_id = p_athlete_id and request_id = p_request_id;

  if v_existing.status = 'completed' then
    return query select 'completed'::text, null::uuid, null::text, null::date, null::int,
      v_existing.reply, v_existing.remaining, v_existing.cap, v_existing.is_premium;
    return;
  end if;

  return query select 'processing'::text, null::uuid, null::text, null::date, null::int, null::text, null::int, null::int, null::boolean;
end;
$$;

-- Marks a claimed request as successfully completed and caches its result — called only after a
-- genuinely successful model reply, right alongside the response the Edge Function returns for
-- THIS attempt. `p_claim_token` MUST be exactly the token claim_signal_request returned for this
-- attempt: if the row's claim_token has since changed (this worker was superseded by a
-- stale-reclaim — see claim_signal_request), this call intentionally updates nothing, returning
-- false, so it can never clobber a newer worker's in-progress or already-completed state with a
-- late, stale result. The caller (index.ts) should log a warning when this returns false — it
-- means real work (and a real ask) was spent on an attempt whose result nobody will ever see,
-- which is unusual enough to be worth knowing about, but not an error to surface to the athlete.
create or replace function complete_signal_request(
  p_athlete_id uuid,
  p_request_id text,
  p_claim_token uuid,
  p_reply text,
  p_remaining int,
  p_cap int,
  p_is_premium boolean
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated int;
begin
  update signal_request_dedup
  set status = 'completed', reply = p_reply, remaining = p_remaining, cap = p_cap, is_premium = p_is_premium
  where athlete_id = p_athlete_id and request_id = p_request_id and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Called when the model call itself fails after a reservation was already made for this attempt —
-- the caller (index.ts) must check this function's return value BEFORE deciding whether to release
-- that reservation: true means this worker still owned the claim right up until this delete (safe
-- to release — see reserve_signal_ask's comment on why the reservation and the dedup row are kept
-- in sync), false means a stale-reclaim already superseded this worker, and the reservation now
-- belongs to (or was already consumed by) whichever worker currently/subsequently owns the claim —
-- releasing it here would incorrectly free an ask that worker is still relying on. Also called
-- (with the same token-fencing) when NO reservation was ever made for this attempt at all (e.g. the
-- entitlement check itself failed) — deleting the row is always correct there regardless of the
-- return value, since there is nothing to release either way.
create or replace function fail_signal_request(p_athlete_id uuid, p_request_id text, p_claim_token uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from signal_request_dedup
  where athlete_id = p_athlete_id and request_id = p_request_id and claim_token = p_claim_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- Build 11 follow-up correction — reserve_signal_ask now OPTIONALLY records the reservation it just
-- made directly onto the matching signal_request_dedup row, in the SAME function call (so there is
-- no separate network round-trip, and therefore no window, between "the ask was reserved" and "the
-- dedup row knows about it" where a process death could leave an orphaned, undiscoverable
-- reservation). p_request_id/p_claim_token are optional and default to null — a caller with no
-- dedup tracking at all (an older client that never sent a requestId at all — see index.ts's Build
-- 10 compatibility handling) omits them and gets EXACTLY the pre-Build-11 behavior, unchanged.
--
-- When they ARE supplied, this only records against the row if `p_claim_token` still matches (the
-- same fencing as complete/fail_signal_request) AND no reservation is already recorded for this row
-- (reserved_tier is null — normally true, since this only ever runs once per logical question; see
-- claim_signal_request's REUSE path for why a stale-reclaiming worker must never call this again).
-- If recording fails (the caller was superseded between claiming and reserving — a vanishingly
-- small window, but not impossible), the just-made reservation is immediately given back in the
-- SAME call: nothing could ever discover it via the dedup row otherwise, since a different worker
-- now owns that row's claim_token.
drop function if exists reserve_signal_ask(uuid, date, text, int);
create or replace function reserve_signal_ask(
  p_athlete_id uuid,
  p_window_date date,
  p_tier text,
  p_cap int,
  p_request_id text default null,
  p_claim_token uuid default null
)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_new_count int;
  v_recorded int;
begin
  if p_tier = 'premium' then
    insert into signal_rate_limit (athlete_id, window_date, premium_request_count)
    values (p_athlete_id, p_window_date, 1)
    on conflict (athlete_id, window_date)
    do update set premium_request_count = signal_rate_limit.premium_request_count + 1
    where signal_rate_limit.premium_request_count < p_cap
    returning premium_request_count into v_new_count;
  else
    insert into signal_free_usage (athlete_id, lifetime_count)
    values (p_athlete_id, 1)
    on conflict (athlete_id)
    do update set lifetime_count = signal_free_usage.lifetime_count + 1, updated_at = now()
    where signal_free_usage.lifetime_count < p_cap
    returning lifetime_count into v_new_count;
  end if;

  if v_new_count is null then
    return null;
  end if;

  if p_request_id is not null and p_claim_token is not null then
    update signal_request_dedup
    set reserved_tier = p_tier, reserved_window_date = p_window_date, reserved_count = v_new_count
    where athlete_id = p_athlete_id
      and request_id = p_request_id
      and claim_token = p_claim_token
      and reserved_tier is null;
    get diagnostics v_recorded = row_count;

    if v_recorded = 0 then
      -- Superseded between claiming and reserving (or a reservation was somehow already recorded —
      -- should not happen in normal flow either way). Give back what was just reserved immediately:
      -- no dedup row will ever point to it, so nothing could release it later.
      if p_tier = 'premium' then
        update signal_rate_limit set premium_request_count = greatest(premium_request_count - 1, 0)
        where athlete_id = p_athlete_id and window_date = p_window_date;
      else
        update signal_free_usage set lifetime_count = greatest(lifetime_count - 1, 0), updated_at = now()
        where athlete_id = p_athlete_id;
      end if;
      return null;
    end if;
  end if;

  return v_new_count;
end;
$$;

-- Gives back a slot reserved by reserveSignalAsk (same tier) when the model call itself then
-- fails — only a genuinely successful reply should consume an ask. Best-effort: a failure here
-- just means the athlete's count is one higher than it should be, never a crash of the response
-- we already owe them. Unchanged by the Build 11 follow-up correction — the CALLER (index.ts) now
-- decides whether to invoke this at all, gated on fail_signal_request's own return value; this
-- function itself does not need to know about claim_token.
create or replace function release_signal_ask(p_athlete_id uuid, p_window_date date, p_tier text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_tier = 'premium' then
    update signal_rate_limit
    set premium_request_count = greatest(premium_request_count - 1, 0)
    where athlete_id = p_athlete_id and window_date = p_window_date;
  else
    update signal_free_usage
    set lifetime_count = greatest(lifetime_count - 1, 0), updated_at = now()
    where athlete_id = p_athlete_id;
  end if;
end;
$$;

revoke all on function claim_signal_request(uuid, text, int) from public, anon, authenticated;
revoke all on function complete_signal_request(uuid, text, uuid, text, int, int, boolean) from public, anon, authenticated;
revoke all on function fail_signal_request(uuid, text, uuid) from public, anon, authenticated;
revoke all on function reserve_signal_ask(uuid, date, text, int, text, uuid) from public, anon, authenticated;
revoke all on function release_signal_ask(uuid, date, text) from public, anon, authenticated;
