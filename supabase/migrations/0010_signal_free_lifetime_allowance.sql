-- Build 11 monetization correction — the shipped "3 Signal asks per month" for free athletes was
-- wrong. The intended allowance has always been 3 Signal asks TOTAL, for the lifetime of the free
-- account; only Premium's 40 asks is a genuine per-UTC-calendar-month allowance. Before this
-- migration, free usage was tracked in signal_rate_limit's free_request_count, keyed by
-- (athlete_id, window_date) — a request in a new month silently started a brand-new row at 0,
-- which is exactly the monthly-reset behavior that must NOT happen for free.
--
-- Free usage moves to its own dedicated table with a single row per athlete (no window_date at
-- all — there is nothing to bucket by) so its lifecycle can never be conflated with premium's
-- genuinely monthly bucket living in signal_rate_limit. Premium's schema/behavior in
-- signal_rate_limit is completely unchanged by this migration.

create table signal_free_usage (
  athlete_id     uuid primary key references athlete_profiles(id) on delete cascade,
  lifetime_count int not null default 0,
  updated_at     timestamptz not null default now()
);

alter table signal_free_usage enable row level security;
-- Same shape as signal_rate_limit: RLS enabled, no policies — service-role only, zero client access.

-- Conservative, one-time backfill: aggregate every historical monthly free_request_count row per
-- athlete into a single lifetime count, capped at 3 (the free cap) — an athlete who happened to
-- have used, say, 2 free asks in one month and 1 in a later month (the exact monthly-reset bug
-- this migration fixes) must not be handed a fresh 3 by this migration; their already-spent asks
-- carry forward, capped at the same 3 a real lifetime-tracked athlete could ever reach. Athletes
-- with zero historical free usage get no row at all (reserve_signal_ask's own INSERT ... ON
-- CONFLICT below creates one lazily on their next ask, starting at 0 as normal).
--
-- ON CONFLICT DO NOTHING: Supabase's own migration runner tracks applied migrations and will not
-- normally re-run this file, but this is defense-in-depth against a manual/accidental re-apply —
-- without it, a repeat run would either error (duplicate primary key, if free_request_count still
-- existed) or, worse, silently overwrite an athlete's already-decremented lifetime_count back up
-- to their OLD historical total, undoing every ask they've spent since this migration first ran.
-- DO NOTHING makes a repeat run an inert no-op for any athlete already backfilled.
insert into signal_free_usage (athlete_id, lifetime_count)
select athlete_id, least(sum(free_request_count), 3)
from signal_rate_limit
group by athlete_id
having sum(free_request_count) > 0
on conflict (athlete_id) do nothing;

-- free_request_count is no longer written or read by anything (see reserve_signal_ask/
-- release_signal_ask below) — dropped rather than left stale so it can never be mistaken for a
-- still-live source of truth. premium_request_count and window_date are untouched.
alter table signal_rate_limit drop column free_request_count;

-- Reserves one ask for p_tier ('free' or 'premium'), atomically, if the athlete is still under
-- p_cap for that bucket. 'premium' behaves exactly as before (signal_rate_limit, monthly, keyed by
-- p_window_date). 'free' now targets signal_free_usage instead — a single per-athlete row with no
-- window_date, so p_window_date is accepted (kept for a single, uniform call site in the Edge
-- Function) but simply unused on this branch. Same INSERT ... ON CONFLICT DO UPDATE ... WHERE
-- pattern either way, so concurrent requests from the same athlete still serialize on the row and
-- cannot both squeeze past the cap.
create or replace function reserve_signal_ask(p_athlete_id uuid, p_window_date date, p_tier text, p_cap int)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_new_count int;
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

  return v_new_count;
end;
$$;

-- Gives back a slot reserved by reserve_signal_ask for the SAME p_tier, when the model call itself
-- then fails. 'free' now floors signal_free_usage.lifetime_count at zero instead of touching
-- signal_rate_limit — a released free ask must go back into the same lifetime balance it came
-- from, not a monthly bucket that may not even be the current one by the time this runs.
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

revoke all on function reserve_signal_ask(uuid, date, text, int) from public, anon, authenticated;
revoke all on function release_signal_ask(uuid, date, text) from public, anon, authenticated;
