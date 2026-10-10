# Production change plan for 1.1 (for approval)

Prepared 2026-10-08; RevenueCat deletion section added 2026-10-10. **Only the steps marked done under Progress have been executed; everything else in this plan is unexecuted.** Every step below needs your explicit go, one at a time. Build 18 and its production services are unchanged today. Related: `docs/production-setup-1.1.md` (who does what) and `docs/release-1.1-checklist.md` (compatibility, rollback detail, verification).

Production project ref: `ibdqeagutcjmbbjnquzv` (always passed explicitly; this repo's Supabase link points at it, so a bare command would also target production).

## Baseline captured read-only (the state every rollback returns to)
| Item | State on 2026-10-08 |
|---|---|
| Functions | `signal` v16, `race-discovery` v8, `delete-account` v2 (version numbers became v17, v9, v3 after the 2026-10-09 secrets change with no code change; compare by hash and source). Downloaded sources are **byte-identical to tag `v1.0.0-build18`** (`signal`: index, usage, systemPrompt; `delete-account`: index; `race-discovery`: all three files). The tag is on GitHub. |
| `signal` bundle hash | `cea75ad1d54539788adccafc4aafab8bda956652b1acf13dd55bab8e30acec92` (v16) |
| Migrations | 0001 to 0011 on production. Development also has **0012** (`revenuecat_deletion_requests`), which is **part of 1.1** (see section 4A). |
| Auth: providers | Apple disabled (no client ID), Google disabled (no client ID), manual linking **off** |
| Auth: URLs | site URL `racesignal://auth-callback`; allow list `racesignal://auth-callback,racesignal://**` (no `exp://`, no dev scheme) |
| Auth: email | custom SMTP `smtp.gmail.com:587`, sender `racesignal@gmail.com`, rate limit 30 per hour, autoconfirm off, sign-up enabled |
| Secrets (names) | `ANTHROPIC_API_KEY`, `REVENUECAT_PUBLIC_API_KEY`, `SPORTSTATS_DAILY_REQUEST_CAP`, plus Supabase-managed. **No `APPLE_*`.** |
| RevenueCat production | entitlement `premium` with the monthly and annual products; `default` offering current with a published paywall (revision 4); App Store keys configured |
| EAS production env | production Supabase URL and anon key, a production RevenueCat key (`appl_`), ASC submit keys |
| App config | Apple, Google and push flags all **false**; version 1.0.0; iOS build 18 (next is 19) |

The auth baseline (non-secret fields only) is saved locally for the rollback comparison; secrets are never saved.

## Order, and why
0. Rotate the CLI token (a credential, not a production change; everything after depends on it).
1. Apple Developer and Google Cloud consoles (identity setup; no production data involved).
2. Function secrets (`APPLE_*`).
3. Supabase Auth settings (enable providers and manual linking).
4. Deploy `delete-account` **together with the RevenueCat deletion pieces in section 4A** (migration 0012, restricted RevenueCat key and project ID, the `revenuecat-cleanup` function, the cleanup schedule).
5. Deploy `signal`, last among the backend steps because it changes Build 18 users' answers immediately.
6. App configuration, version bump and build (separate approval; not part of this plan's backend steps).

Steps 1 to 4 add capability that Build 18 never uses, so they cannot change Build 18 behavior. Step 5 can.

## Progress
- **Step 0, CLI token rotation: done 2026-10-08.** The old token was revoked by the owner; the replacement login (plain `sbp_`, 44 characters, created 2026-10-08 16:25:07 UTC) was verified read-only against both projects, and production was confirmed unchanged (functions v16, v8, v2; auth settings equal to the saved baseline; no `APPLE_*` secrets). The old token's revocation itself could not be tested from this machine (its value is gone); the owner removed it in the dashboard.
- **Step 1, Apple capability: done 2026-10-08 (owner-reported).** The production App ID `com.cristianvillamarin.racesignal` has **Sign in with Apple** enabled as a primary App ID and **Push Notifications unchecked**. Not independently verifiable from here (no Apple API access); it will show up in the build's synced-capabilities step.
- **Apple key created (owner, 2026-10-09)** and **Step 2, Apple secrets: applied 2026-10-09** by the owner with `supabase/prod/set-apple-secrets.py set --apply`. Verified read-only afterward: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` and `APPLE_PRIVATE_KEY` exist (one timestamp, 2026-10-09 21:26:04 UTC); all ten previous secrets are still present with digests identical to the baseline; production auth settings still equal the saved baseline. **Side effect to know:** setting secrets made Supabase bump every function's version (now `signal` v17, `race-discovery` v9, `delete-account` v3). The code did not change: each function's bundle hash is identical to the baseline and the downloaded sources are still byte-identical to tag `v1.0.0-build18`. From now on identify a function by its hash and source, not its version number (any later secrets change will bump versions again).
- **Google redirect URI, result 2026-10-09 (read-only probe of Google's authorization endpoint, no sign-in):** the owner saved the production redirect URI and Google **accepts** `https://ibdqeagutcjmbbjnquzv.supabase.co/auth/v1/callback` (it reaches the Google sign-in page; stable on a repeat 20 seconds later), and a bogus URI is still rejected (`redirect_uri_mismatch`). **But Google now rejects the development redirect URI** `https://sjmixferxnkwbzkcofnp.supabase.co/auth/v1/callback` (`redirect_uri_mismatch`): the production URI appears to have replaced it instead of being added beside it. Google sign-in in the development app is therefore broken until the dev URI is added back. **Resolved 2026-10-09:** the owner saved both URIs as separate entries, and the probe (two runs 20 seconds apart, with a control) shows Google now **accepts both** the development and the production URI and still rejects a bogus one. Google sign-in in the dev app works again at the Google end (not re-tested on the device). This step is complete. (Method: request `accounts.google.com/o/oauth2/v2/auth?client_id=<Web client>&redirect_uri=<URI>&response_type=code&scope=openid email` and read where Google lands: the sign-in page means accepted, the error page `redirect_uri_mismatch` means not registered.)
- **2026-10-10, RevenueCat deletion:** section 4A was added to this plan. No production change was made: the only production access was the read-only baseline recorded there.
- Next (older note, partly superseded): re-add the dev redirect URI; then publish the consent screen and decide on brand verification; then the Supabase auth settings. No auth setting, function deployment or build has happened.

## 0. Rotate the Supabase CLI token (you)
- **Identify first:** the token in use is the CLI login token in the Keychain: prefix `sbp_30f5`, 44 characters, created **2026-08-27 17:00:15 UTC** (a dashboard entry whose name contains about `1787850015`). Details in `docs/development-environment.md`.
- **Change:** Supabase dashboard → Account → Access Tokens → revoke **only that entry**; leave any other token you recognize as in use. Then `supabase logout` and `supabase login`.
- **Verify (me, read-only):** `supabase projects list` and a read of both projects work with the new login.
- **Rollback:** none needed; a token can always be recreated by logging in again.

## 1. Consoles (you; private)
**Apple Developer:** App ID `com.cristianvillamarin.racesignal` → enable **Sign in with Apple** (not Push); create a Sign in with Apple **key** whose primary App ID is that App ID; keep the `.p8`, Key ID and Team ID private. *Rollback:* revoke the key; the capability can stay (unused) or be removed once no build uses it.
**Google Cloud (project RaceSignal):** on the existing Web client add `https://ibdqeagutcjmbbjnquzv.supabase.co/auth/v1/callback` as a second redirect URI; set the consent screen's audience to **In production** (basic scopes only); decide on brand verification (needs a domain you own). *Rollback:* remove the added redirect URI and set the audience back to Testing.

## 2. Function secrets (you at a silent prompt, or me with your prompt)
- **Change:** set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (`com.cristianvillamarin.racesignal`) and `APPLE_PRIVATE_KEY` on production. **The helper is prepared for your review: `supabase/prod/set-apple-secrets.py`** (dry-run by default; `set --apply` needs the typed phrase `SET PRODUCTION APPLE SECRETS`; `remove --apply` is the rollback). It reads the `.p8` from a path you type, validates it locally (EC P-256 PKCS#8, Key ID matches the file name), sends from memory to the Management API with your CLI login, refuses if any `APPLE_*` secret already exists, reads the names back and checks every other secret's digest is unchanged, and never prints a secret, Key ID or Team ID. Ten unit tests (`python3 -m unittest supabase/prod/test_set_apple_secrets.py`) cover it. Nothing has been run with `--apply`.
- **Verify:** `supabase secrets list --project-ref <production ref>` shows the four new names; the existing three are unchanged (compare digests with the baseline).
- **Rollback:** `supabase secrets unset APPLE_TEAM_ID APPLE_KEY_ID APPLE_CLIENT_ID APPLE_PRIVATE_KEY --project-ref <production ref>`. Nothing reads them until the new `delete-account` is deployed.

## 3. Supabase Auth settings (production)
- **Exact change** (Management API `PATCH /v1/projects/<ref>/config/auth`, or the dashboard's Authentication → Providers):
  - `external_apple_enabled: true`, `external_apple_client_id: "com.cristianvillamarin.racesignal"`
  - `external_google_enabled: true`, `external_google_client_id: "<the Web client ID>"`, `external_google_secret: "<entered silently, never in chat>"`, `external_google_skip_nonce_check: false`
  - `security_manual_linking_enabled: true`
  - **Skip nonce check stays off** for both providers. No change to the site URL, allow list, SMTP or email settings.
- **Verify (me, read-only):** read back the same keys against the saved baseline; only these keys differ.
- **Rollback:** PATCH `external_apple_enabled: false`, `external_apple_client_id: null`, `external_google_enabled: false`, `external_google_client_id: null`, `security_manual_linking_enabled: false` (the baseline values). **Caveat:** identities already linked while this was on remain in the database; with the providers off those users can still sign in by email (every account keeps an email identity or its original method) but cannot use the removed provider until it is re-enabled. Roll back before the 1.1 app reaches users to avoid that.

## 4. Deploy `delete-account`
- **Change:** `supabase functions deploy delete-account --project-ref <production ref>` from `supabase/`, naming only that function.
- **Build 18 compatibility (diffed):** Build 18 sends an empty body; the new function treats the optional Apple authorization code as absent and reports `appleRevocation: "not_attempted"` in an extra response field Build 18 ignores. No behavior change for Build 18.
- **Verify:** `supabase functions list` shows a new version and the other two unchanged; a deletion smoke test with a **throwaway** production account.
- **Rollback:** `git worktree add ../rs-rollback v1.0.0-build18`, then `supabase functions deploy delete-account --project-ref <production ref>` from that worktree; download and diff against the tag to prove it (the same procedure as `signal`). Secrets from step 2 stay harmlessly unused.

## 4A. RevenueCat customer deletion (extends step 4; built and verified on development only, 2026-10-10)

Background and evidence: `docs/revenuecat-deletion-plan.md` (sections 8 to 10). In short: after the account is deleted, `delete-account` asks RevenueCat to delete the customer (and its linked anonymous alias), records every request in `revenuecat_deletion_requests`, and a schedule verifies and retries until RevenueCat answers "not found". The account deletion itself never depends on any of it. **The Privacy page's deletion sentence stays highlighted as pending, and the website stays unpublished, until everything in 4A.1 to 4A.5 is done and 4A.7 verifies it on production.** Nothing in 4A has been done on production.

### Read-only: production baseline captured 2026-10-10 (SELECTs and listings only; nothing was changed)
- Migrations applied: 0001 to 0011 (no 0012).
- `public.revenuecat_deletion_requests`: does not exist.
- Extensions installed: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. **`pg_cron` and `pg_net` are available but not installed.** Vault holds no secrets.
- Functions: `signal` v17 (hash `cea75ad1…`, unchanged), `race-discovery` v9 (hash `16a52866…`), `delete-account` v3 (hash `da04a55a…`, the Build 18 source). No `revenuecat-cleanup` function.
- Secrets: no `REVENUECAT_SECRET_API_KEY` or `REVENUECAT_PROJECT_ID` (names confirmed absent in the 2026-10-09 listing; recheck before 4A.3).
- RevenueCat production project `proj48e9ded9` (RaceSignal): 27 customers (7 keyed by an account id, 20 anonymous). They are **not yet matched** to production accounts; that match needs a read of production account ids and is its own approval (4A.6). No customer has been deleted.

### CHANGES (each needs your separate explicit go; I run one, read back, and stop at the first surprise)
**4A.1 Restricted RevenueCat production key. YOU, private.** In the RevenueCat dashboard open the **production** project (**RaceSignal**, not RaceSignal Dev) → Project settings → API keys → New secret API key, name `racesignal-prod-delete-account`, **API v2**, every permission **No access** except **Customer information → Customers = Read & write** (`customer_information:customers:read_write`). Copy it once; never into chat. *Rollback:* revoke the key in the dashboard. The project ID is `proj48e9ded9` (not a secret).

**4A.2 Migration 0012 (additive: one new table, no change to existing tables).** First `supabase db push --linked --dry-run` must list **only** `0012_revenuecat_deletion_requests.sql` (the repo link is production; the ref is confirmed before and after). Then apply. Build 18 never touches the table. *Rollback:* unschedule the job (4A.5) first, then `drop table revenuecat_deletion_requests` and `supabase migration repair --status reverted 0012 --linked`. Dropping it discards the request records, so do it only before real deletions have happened or after they are verified.

**4A.3 Two function secrets: `REVENUECAT_SECRET_API_KEY` (you, at a silent prompt) and `REVENUECAT_PROJECT_ID` (`proj48e9ded9`).** **Helper: `supabase/prod/set-revenuecat-secrets.py` (`check`, `set`, `set --apply`, `remove`, `remove --apply`; written 2026-10-10, tested with a fake API, never run with `--apply`).** Dry run by default; `--apply` needs the typed phrase `SET PRODUCTION REVENUECAT SECRETS`; the key is typed at a hidden prompt and never printed; it refuses the development key (SHA-256 compared with the digests of the existing secrets), any non-`sk_` value, and any key RevenueCat does not accept for the production project or *does* accept for the development project; it warns if the key can also read purchases or project configuration; it refuses if either secret already exists; read-back checks both new digests and that every other secret is unchanged. The dry run is safe to run early: it only makes read-only GETs to RevenueCat and Supabase. *Rollback:* `supabase secrets unset REVENUECAT_SECRET_API_KEY REVENUECAT_PROJECT_ID --project-ref <production ref>` and revoke the key. Setting secrets bumps every function's version again (compare by hash and source).

**4A.4 Deploy two functions, naming only them: `delete-account` (new code, with `_shared/`) and `revenuecat-cleanup` (new, `verify_jwt = false`, requires the service key inside).** Deployed from the verified commit. Build 18 compatibility: Build 18 sends an empty body; the new response only adds `revenueCat` and `appleRevocation` fields it ignores; deletion still succeeds if the table, key or RevenueCat is unavailable. *Rollback:* redeploy `delete-account` from tag `v1.0.0-build18` (worktree method, download and diff to prove it), and `supabase functions delete revenuecat-cleanup --project-ref <production ref>`.

**4A.5 Cleanup schedule: enable `pg_cron` and `pg_net` (both currently not installed) and create the job every 30 minutes.** The service key goes into Vault (never into the job text or a migration), as on development. **Helper: `supabase/prod/schedule-revenuecat-cleanup.py` (`status`, `verify`, `apply`, `apply --apply`, `remove`, `remove --apply`; written 2026-10-10, tested, never run with `--apply`).** Its dry run and `status`/`verify` send only SELECTs; `--apply` needs the phrase `SCHEDULE PRODUCTION REVENUECAT CLEANUP`, refuses unless migration 0012, both secrets and the function are in place and no job/Vault secret exists, keeps the key only in Vault, and reads the job back (active, schedule, no key in its text). `verify` exits non-zero until the first scheduled run has succeeded with HTTP 200. The dev script still refuses production on purpose. *Rollback:* `remove` (unschedules and deletes the Vault secret); the extensions can stay installed.

**4A.6 Existing production customers: dry run only.** A read of production account ids (needs its own approval; `supabase/dev/revenuecat-backfill-dryrun.py` is development-only today and would need a reviewed production variant), then the same classification as development (matched, anonymous, orphan, with purchase checks). **No existing customer is deleted in this plan.** A deletion pass, if wanted, is a separate later change with its own approval and an excluded-if-purchases rule.

**4A.7 Throwaway production account smoke test.** Creating and deleting a throwaway account on production is itself a change (it briefly adds an auth user, a profile and a RevenueCat customer, then removes them), so it needs a separate go. It uses a clearly named throwaway email, never a real or reviewer account.

### READ-ONLY verification (after each change above; nothing here changes production)
- After 4A.2: `supabase migration list` shows 0012; the table exists, has RLS on, no policies, and **no grants to `anon` or `authenticated`**; the other tables are unchanged.
- After 4A.3: secret **names** exist; every other secret's digest equals the baseline; function bundle hashes unchanged (only version numbers move).
- After 4A.4: `supabase functions list` shows `revenuecat-cleanup` and a new `delete-account`; `signal` and `race-discovery` hashes still equal the baseline; `revenuecat-cleanup` answers 401 to the anon key, to a signed-in athlete's token and to no key.
- After 4A.5: the job exists, active, schedule `*/30 * * * *`, **job text contains no key**; the first scheduled run shows `succeeded` in `cron.job_run_details` and HTTP 200 with the summary in `net._http_response`.
- After 4A.7: the throwaway account's request went `accepted` then `verified` on the scheduled run; the RevenueCat customer and its anonymous alias return 404 and stay 404 after the next run; production auth settings, secrets and RevenueCat project settings still equal the baseline.
- Ongoing owner check (weekly, and before and after each release): `select app_user_id, status, attempts, last_error, first_requested_at from revenuecat_deletion_requests where status <> 'verified' order by first_requested_at;` and the `revenuecat-cleanup` logs. There is no automatic alert; an old row means resolve it by hand in RevenueCat.

### Privacy and website gating
The Privacy page text (cadence 30 minutes, 10 attempts, 7-day recheck, request record deleted 30 days after confirmation, unresolved records kept and handled by hand) describes exactly what development does and what 4A.5 must reproduce on production. The `pending` marker comes off only after the read-only verification above shows the same behavior on production. The website is not published in this plan.

## 5. Deploy `signal`
Follows the compatibility check, post-deploy Build 18 test and rollback procedure in `docs/release-1.1-checklist.md` exactly (redeploy from the Build 18 worktree, download and diff, no data cleanup). **Decision for you before this step:** Build 18 users get the new answers immediately.

## 6. App configuration, version, build (separate approval)
`production.features.appleSignIn` and `googleSignIn` set to `true`, `pushEntitlement` left `false`, `production.google.webClientId` set; `npm run release:config` must show the Apple entitlement `true`, `pushEntitlementPlugin` `false` and both auth flags on; version 1.1.0; EAS production build (Apple login prompts during the build). *Rollback:* flip the flags back to `false` and rebuild (the checklist's Rollback section); nothing here changes the backend.

## Approval gates
You approve each of steps 0 to 5 separately; I run only what you approve, read back afterward, and stop at the first surprise. Anything that fails verification is rolled back before the next step.

## Tracked, not part of these changes
The RevenueCat customer record left behind by account deletion is now handled by section 4A (built and verified on development only; the production steps are unexecuted, and RevenueCat's own internal retention after a deletion is undocumented, so the policy points to RevenueCat's privacy policy); the App Store privacy label and policy text; the Build 18 behavior-change decision for step 5.
