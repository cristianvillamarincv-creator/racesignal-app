-- Step 8.4 — replaces the temporary per-day Signal rate limit (0005) with the real V1 allowance:
-- 3 free asks / 40 premium asks per calendar month. Reuses signal_rate_limit's existing
-- (athlete_id, window_date) primary key unchanged — the Edge Function now writes window_date as
-- the first day of the CURRENT UTC CALENDAR MONTH (e.g. "2026-09-01") instead of the literal day.
-- Reset is deliberately implicit: no cron/reset job exists or is needed, because a request made in
-- a new month writes a brand-new row (the primary key includes window_date) starting at count 1 —
-- there is nothing to "reset" server-side. The boundary is exactly midnight UTC on the 1st.
--
-- Both functions are a single atomic INSERT ... ON CONFLICT DO UPDATE, so two concurrent requests
-- from the same athlete serialize on that row's write lock and cannot both squeeze past the cap —
-- the classic read-then-write race a plain "select count, then upsert" (the old
-- checkAndIncrementRateLimit) has. Called only by the Edge Function's service-role client, exactly
-- like every other use of this table (RLS enabled, no policies — migrations/0005).

-- Reserves one ask for (athlete_id, window_date) if the athlete is still under p_cap, atomically.
-- Returns the new request_count on success, or null if the cap was already reached (nothing was
-- written) — the Edge Function treats null as "rate_limited". Call this only once per request,
-- immediately before calling the model.
create or replace function reserve_signal_ask(p_athlete_id uuid, p_window_date date, p_cap int)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_new_count int;
begin
  insert into signal_rate_limit (athlete_id, window_date, request_count)
  values (p_athlete_id, p_window_date, 1)
  on conflict (athlete_id, window_date)
  do update set request_count = signal_rate_limit.request_count + 1
  where signal_rate_limit.request_count < p_cap
  returning request_count into v_new_count;

  return v_new_count;
end;
$$;

-- Gives back a slot reserved by reserve_signal_ask when the model call itself then fails (network
-- error, timeout, Anthropic error) — only a genuinely successful reply should consume an ask.
-- Floors at zero so a request racing a monthly rollover can never underflow into the new month's
-- row.
create or replace function release_signal_ask(p_athlete_id uuid, p_window_date date)
returns void
language plpgsql
set search_path = public
as $$
begin
  update signal_rate_limit
  set request_count = greatest(request_count - 1, 0)
  where athlete_id = p_athlete_id and window_date = p_window_date;
end;
$$;

revoke all on function reserve_signal_ask(uuid, date, int) from public, anon, authenticated;
revoke all on function release_signal_ask(uuid, date) from public, anon, authenticated;

-- Anthropic cost instrumentation (Step 8.4) — one row per SUCCESSFUL Signal reply, enough to later
-- compute average/high-percentile cost per ask and per-premium-athlete monthly usage. Never
-- exposed to the mobile client; written only by the Edge Function's service-role client. No raw
-- prompt/response text or image bytes are stored here — token counts and flags only.
create table signal_usage_log (
  id             uuid primary key default gen_random_uuid(),
  athlete_id     uuid not null references athlete_profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  input_tokens   int not null,
  output_tokens  int not null,
  had_image      boolean not null,
  was_premium    boolean not null
);

create index signal_usage_log_athlete_id_idx on signal_usage_log (athlete_id);
create index signal_usage_log_created_at_idx on signal_usage_log (created_at);

alter table signal_usage_log enable row level security;
-- Same shape as signal_rate_limit: RLS enabled, no policies — service-role only, zero client access.
