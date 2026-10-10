-- Account deletion also asks RevenueCat (our subscription provider) to delete the account's customer record. That request is
-- asynchronous and can fail, and the RaceSignal account is already gone by then, so the outcome has to be recorded somewhere that
-- outlives the account: one row per deleted account, keyed by the old account id.
--
-- Deliberately NO foreign key to auth.users or athlete_profiles: the row must survive the deletion it describes. It holds nothing
-- but the old account id (a random UUID that RevenueCat also holds), a status and counters; never an email, a name or any
-- RevenueCat response body. `last_error` is a short code (for example 'http_401' or 'timeout'), not free text.
--
-- status:
--   queued    the deletion is under way (written before the account is deleted, so a crash cannot lose the request)
--   accepted  RevenueCat accepted the (asynchronous) request; NOT yet confirmed gone, so this still counts as pending
--   failed    the last request did not get accepted (or no RevenueCat key is configured); the retry sweep will try again
--   verified  RevenueCat answered "not found" for the id, i.e. the customer is confirmed gone
--
-- Rows are removed by the sweep (functions/revenuecat-cleanup) 30 days after verification, so this does not become a list of
-- deleted accounts. Service-role only: RLS on, no policies, no grants to anon/authenticated.
create table revenuecat_deletion_requests (
  app_user_id         uuid primary key,
  status              text not null check (status in ('queued', 'accepted', 'failed', 'verified')),
  attempts            int not null default 0,
  first_requested_at  timestamptz not null default now(),
  last_attempt_at     timestamptz,
  verified_at         timestamptz,
  last_error          text
);

alter table revenuecat_deletion_requests enable row level security;
revoke all on table revenuecat_deletion_requests from public, anon, authenticated;

-- The sweep only ever looks at rows that are not yet verified.
create index revenuecat_deletion_requests_open_idx on revenuecat_deletion_requests (last_attempt_at nulls first)
  where status <> 'verified';
