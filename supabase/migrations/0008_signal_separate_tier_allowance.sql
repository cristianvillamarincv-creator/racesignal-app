-- Step 8 pre-TestFlight fix — free and premium Signal usage must be separate logical buckets per
-- athlete per month, so upgrading mid-month grants a genuinely fresh 40 premium asks rather than
-- "40 minus whatever free asks were already used." Replaces 0007's single shared request_count
-- with two independent counters on the same (athlete_id, window_date) row.
--
-- Previously consumed free asks are NEVER reset by an upgrade (free_request_count is only ever
-- touched by free-tier reservations), and if premium later expires mid-month, free_request_count
-- is exactly as the athlete left it — no free allowance is granted back by an expiring
-- subscription, matching the product requirement.

drop function if exists reserve_signal_ask(uuid, date, int);
drop function if exists release_signal_ask(uuid, date);

alter table signal_rate_limit
  add column free_request_count int not null default 0,
  add column premium_request_count int not null default 0;

alter table signal_rate_limit drop column request_count;

-- Atomically reserves one ask in the bucket for p_tier ('free' or 'premium') if the athlete is
-- still under p_cap for THAT bucket specifically — the other tier's counter on the same row is
-- untouched either way. Same INSERT ... ON CONFLICT DO UPDATE ... WHERE pattern as 0007, so
-- concurrent requests from the same athlete still serialize on the row and cannot both squeeze
-- past the cap. Returns the new count for that tier's bucket, or null if its cap was already
-- reached.
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
    insert into signal_rate_limit (athlete_id, window_date, free_request_count)
    values (p_athlete_id, p_window_date, 1)
    on conflict (athlete_id, window_date)
    do update set free_request_count = signal_rate_limit.free_request_count + 1
    where signal_rate_limit.free_request_count < p_cap
    returning free_request_count into v_new_count;
  end if;

  return v_new_count;
end;
$$;

-- Gives back a slot reserved by reserve_signal_ask for the SAME p_tier, when the model call itself
-- then fails. Floors at zero.
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
    update signal_rate_limit
    set free_request_count = greatest(free_request_count - 1, 0)
    where athlete_id = p_athlete_id and window_date = p_window_date;
  end if;
end;
$$;

revoke all on function reserve_signal_ask(uuid, date, text, int) from public, anon, authenticated;
revoke all on function release_signal_ask(uuid, date, text) from public, anon, authenticated;
