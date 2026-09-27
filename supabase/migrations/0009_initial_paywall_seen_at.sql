-- Step 8 pre-Build-9 — the one-time post-onboarding Premium paywall's "have we shown this athlete
-- the initial paywall yet" signal. Nullable and deliberately NOT defaulted for new rows: a
-- genuinely new account must start null so the client attempts the one-time paywall exactly once;
-- only existing accounts (as of this migration) are explicitly backfilled below so Build 9 doesn't
-- suddenly show them an onboarding paywall they never had.
alter table athlete_profiles add column initial_paywall_seen_at timestamptz;

update athlete_profiles set initial_paywall_seen_at = now() where initial_paywall_seen_at is null;

-- The existing "own profile update" RLS policy (migrations/0001_init.sql) already covers this new
-- column — no new policy needed, same as checklist_completed in migrations/0004.
