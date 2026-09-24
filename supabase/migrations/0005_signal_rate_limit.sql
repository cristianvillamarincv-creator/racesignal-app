-- Signal V1 (Step 5) — per-athlete daily request cap for the `signal` Edge Function. Unlike
-- Sportstats' discovery_rate_limit (keyed by IP, a politeness cap on a free scrape), every Signal
-- call has real per-request $ cost against a paid model API with no paywall in front of it yet, so
-- this is keyed by athlete rather than IP and exists specifically to bound worst-case cost from a
-- bug or an enthusiastic tester, independent of any future subscription gating.
create table signal_rate_limit (
  athlete_id     uuid not null references athlete_profiles(id) on delete cascade,
  window_date    date not null,
  request_count  int not null default 0,
  primary key (athlete_id, window_date)
);

-- Same shape as discovery_rate_limit: RLS enabled, no policies — only the Edge Function's
-- service-role client touches this table, the mobile app has zero access to it via PostgREST.
alter table signal_rate_limit enable row level security;
