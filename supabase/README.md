# RaceSignal: Supabase backend

Postgres schema (with row-level security), four Edge Functions, and Auth for the RaceSignal app. Verified against the live project on 2026-10-02: all 11 migrations are applied, and the deployed functions are byte-identical to commit `8e3f0ec` (Build 18).

**There are two Supabase projects.** Production (linked in `supabase/.temp/project-ref`, so a bare `supabase … deploy/push/secrets set` from here hits production) and `racesignal-dev` (free plan, synthetic data; ref in `../mobile/config/environments.json`). Local app development uses dev. Always pass `--project-ref <dev ref>` for dev work, and read `../docs/development-environment.md` and `../docs/development-workflow.md` §4–5 first, because production deploys affect every installed build immediately. Dev helpers: `dev/seed-dev.mjs` (guarded synthetic seed) and `dev/set-dev-secret.sh` (silent-prompt secret setter, dev only).

## What's here

### Edge Functions (`functions/`)

| Function | Auth | Purpose |
|---|---|---|
| `race-discovery` | `verify_jwt = false` (deliberate; `detail` validates the JWT itself) | Sportstats search / athlete history / single-result detail. Never writes athlete data; the client persists selected races under RLS. Per-IP daily request cap and a `provider_config` kill switch. Parses unofficial public Sportstats endpoints, including an embedded Next.js payload in an HTML page, so a page-shape change can break it. |
| `revenuecat-cleanup` | `verify_jwt = false`; service key required inside | Verifies and retries RevenueCat customer deletions (development only so far; scheduled there every 30 minutes with `dev/schedule-revenuecat-cleanup.py`; production has no schedule yet). |
| `signal` | `verify_jwt = true` | Signal chat. Calls the Anthropic Messages API (model `claude-sonnet-5` by default), enforces allowances, checks Premium via the RevenueCat REST API, dedups retries by `requestId`. Prompt: `functions/signal/systemPrompt.ts`. |
| `delete-account` | `verify_jwt = true` | Calls `auth.admin.deleteUser`; foreign-key cascades delete all athlete data. Then asks RevenueCat to delete the customer (needs `REVENUECAT_SECRET_API_KEY` + `REVENUECAT_PROJECT_ID`; recorded in `revenuecat_deletion_requests`, never blocks deletion; development only until released, see `../docs/revenuecat-deletion-plan.md`). Optionally revokes Sign in with Apple tokens first when the app sends a fresh `appleAuthorizationCode` and the `APPLE_*` secrets exist (best-effort, never blocks deletion; see `../docs/social-sign-in.md`). |

Tests: `cd functions/signal && deno test --allow-read --no-check` (32), `cd functions/race-discovery && deno test --allow-read --no-check` (11), `cd functions/delete-account && deno test --allow-read --no-check` (8, Apple token revocation). `functions/race-discovery/repair_*.ts` are one-time maintenance scripts that have already been run; they are not deployed. **Do not rerun them.**

### Migrations (`migrations/`)

| # | Adds |
|---|---|
| 0001 | `athlete_profiles`, `races` (owner-only RLS, unique `(athlete_id, provider, provider_result_id)`), `provider_config`, `discovery_rate_limit` |
| 0002 | `races.provider_athlete_name` |
| 0003 | `athlete_profiles.onboarding_completed_at` |
| 0004 | `races.checklist_completed` |
| 0005 | `signal_rate_limit` (initial per-day limit; later reshaped) |
| 0006 | `signal_conversations`, `signal_messages` (owner-only RLS) |
| 0007 | Monthly allowance RPCs, `signal_usage_log` |
| 0008 | Separate free/premium tier counters |
| 0009 | `athlete_profiles.initial_paywall_seen_at` (existing accounts backfilled as seen) |
| 0010 | `signal_free_usage`: free allowance is **3 asks lifetime**; dropped `free_request_count` |
| 0011 | `signal_request_dedup` + claim/complete/fail RPCs; reservation tracking in `reserve_signal_ask` |
| 0012 | `revenuecat_deletion_requests` (service-only record of RevenueCat deletion requests; development only so far) |

Every table that holds athlete data references `athlete_profiles` (and through it `auth.users`) with `on delete cascade`. There is no DELETE policy on `races`; removal is a soft delete (`import_status = 'removed'`).

### Allowances (server-enforced)

Free: **3 Signal asks total, ever** (not per month). Premium: **40 per UTC calendar month**. Premium is resolved server-side each fresh request (RevenueCat entitlement `premium`); a RevenueCat failure returns `service_unavailable` and consumes no ask. The default caps live in `functions/signal/index.ts`; the env var `SIGNAL_FREE_MONTHLY_CAP` is misnamed (its value is the lifetime free cap).

### Secrets (names only)

Set on the project (verified present 2026-10-02): `ANTHROPIC_API_KEY`, `REVENUECAT_PUBLIC_API_KEY`, `SPORTSTATS_DAILY_REQUEST_CAP`, plus Supabase-managed `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, and key/JWKS entries. **Not set** (code defaults apply): `SIGNAL_MODEL`, `SIGNAL_FREE_MONTHLY_CAP`, `SIGNAL_PREMIUM_MONTHLY_CAP`. Never put the service-role key or DB password in the mobile app.

## Setup and deploy (CLI)

**Development (`racesignal-dev`):** never use bare `supabase link/db push/functions deploy/secrets set` from this folder; its link is production. Use the dev-only wrapper (explicit dev `--project-ref`, throwaway workspace):

```bash
supabase/dev/dev-supabase.sh status | push [--dry-run] | deploy [fn ...] | secrets
supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY      # silent prompt
supabase/dev/verify-signal.sh                          # Signal + quota accounting check
```

**Production** changes only when the owner says so, and always with the ref spelled out (read it from `.temp/project-ref`; do not rely on the implicit link without checking it):

```bash
cat supabase/.temp/project-ref                                   # confirm this is production
supabase functions deploy signal --project-ref <production ref>
supabase db push --linked                                        # applies supabase/migrations to production
supabase migration list --linked                                 # local vs remote
supabase functions list --project-ref <production ref>           # deployed versions
```

Secret values are never committed.

Copy `mobile/.env.example` to `mobile/.env.development` (dev) / `.env.production` for the app (URL + anon key only).

## Kill switch and request cap

Disable Sportstats discovery without an app update:
```sql
update provider_config set enabled = false where provider = 'sportstats';
```
The app then falls back to manual race entry. The per-IP/UTC-day cap is `SPORTSTATS_DAILY_REQUEST_CAP` (code default 30; earlier notes recorded 300, but the **current secret value is unconfirmed**). The window resets at UTC midnight.

## Auth

Verified (2026-10-02, public settings endpoint): email provider only, sign-ups open, email confirmation required. The app uses magic links (PKCE, redirect `racesignal://auth-callback` in production, `racesignal-dev://auth-callback` in the dev app) plus an email/password sign-in-only path used by an App Review account. Google is implemented in code but hidden and not enabled; there is no Sign in with Apple.

**Unconfirmed (dashboard):** custom SMTP. Supabase's shared default mailer has a very low project-wide rate limit (`over_email_send_rate_limit` was observed earlier); a real SMTP provider with a verified domain should be configured before real customers rely on magic links. Also unconfirmed: the exact redirect-URL allowlist contents.

## Compatibility rules for backend changes

Deploys take effect for all installed builds at once. Keep changes additive; do not drop/rename columns, tables, policies, or RPC signatures used by Build 18 (`reserve_signal_ask(p_athlete_id uuid, p_window_date date, p_tier text, p_cap int, p_request_id text default null, p_claim_token uuid default null)`, `release_signal_ask(uuid, date, text)`, `claim_signal_request`, `complete_signal_request`, `fail_signal_request`); keep each function's request/response envelope and existing `reason` values; ship backward-compatible backend changes before the app that uses them. Details: `../docs/development-workflow.md` §5.
