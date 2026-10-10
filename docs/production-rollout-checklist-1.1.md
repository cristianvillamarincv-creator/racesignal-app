# Production rollout checklist for 1.1 (consolidated, 2026-10-10)

**Nothing in the unchecked rows has been done.** No migration is applied, no secret is set, nothing is deployed or scheduled on production, the website is unpublished, and no build exists. Each row needs your explicit go, one at a time; I run only that row, read back, and stop at the first surprise. Detail and rollback text live in `docs/production-change-plan-1.1.md` (sections 0 to 6 and 4A), `docs/revenuecat-deletion-plan.md`, `docs/production-setup-1.1.md` and `docs/release-1.1-checklist.md`.

Legend: **YOU** = private console or credential step. **ME** = I run it on your go. **CHANGE** = alters production. **READ** = read-only, alters nothing. Production ref `ibdqeagutcjmbbjnquzv`; RevenueCat production project `proj48e9ded9` (RaceSignal), never the development one.

## A. Already done (recorded; nothing left to do)
| # | Item | Type | Result |
|---|---|---|---|
| A1 | CLI token rotated and verified | YOU, READ | 2026-10-08 |
| A2 | Apple: Sign in with Apple on the production App ID, key created | YOU | 2026-10-08/09 (owner-reported) |
| A3 | Apple secrets (`APPLE_*`) on production | CHANGE | 2026-10-09, read back; other secrets unchanged |
| A4 | Google: both redirect URIs accepted | YOU, READ | 2026-10-09 |
| A5 | Development: RevenueCat cleanup built, scheduled and device-verified | dev only | commits `2ea8cc8`, `88796ba` |
| A6 | Production helpers written and tested (no production change) | READ | `set-revenuecat-secrets.py`, `schedule-revenuecat-cleanup.py` (31 tests, mutation-checked) |

## B. Before the first production change
| # | Item | Who / type | Done when |
|---|---|---|---|
| B1 | You review both helpers and the plan, and say go | YOU | explicit go |
| B2 | Create the **restricted production** RevenueCat key (steps below; never the development key) | YOU | key exists, not in chat |
| B3 | **Passed (owner-reported 2026-10-10).** Dry-run the key: `python3 supabase/prod/set-revenuecat-secrets.py set` (hidden prompt, **no `--apply`**) | YOU, READ | prints "accepted by the PRODUCTION project, rejected by the development project", no warning |
| B4 | Re-capture the production baseline (migrations, functions, hashes, secret names, auth settings) and confirm it equals `docs/production-change-plan-1.1.md` | ME, READ | **Done 2026-10-10**, matches (see "Recorded results" below) |
| B5 | Deploy source = the verified commit on `release-1.1` pushed to GitHub, clean working tree (worktree) | ME | commit id recorded |

## C. Backend (production)
**Order of execution (revised 2026-10-10): C2, C3, C4, C5, C6, then section D (website and Google publishing), then C1 (auth settings, which turns on production Google sign-in), then C7 and C8.** The deletion pieces (C2 to C6) go first because they gate the privacy text, the website and the Google publish. **C1 comes after D** because production Google sign-in must not be enabled before the website is live and the Google consent screen is published (left in Testing it only admits listed test users, and publishing needs the live homepage and privacy policy). C1 only has to be done before the app build.

**Build 18 behavior (corrected): C4 changes Build 18 too.** Build 18 does call `delete-account`** (Settings → Delete account sends an empty body), so deploying the new function changes what Build 18 does when a user deletes an account: from that moment the server also asks RevenueCat to delete the customer, records the request in `revenuecat_deletion_requests`, and the schedule verifies it. The account deletion itself still succeeds in every case, Build 18 ignores the extra response fields, and Build 18 never sends an Apple authorization code, so it gets no Apple revocation. This is the intended behavior (the privacy text describes it) but it is **a behavior change for Build 18 users effective at the deploy**, and it needs your explicit decision before C4/step 4, like `signal`. C3 (secrets) and C5 (schedule) alone change nothing Build 18 does; C8 (`signal`) also changes what Build 18 users see.

| # | Change | Who / type | Verify afterwards (READ) | Rollback |
|---|---|---|---|---|
| C1 | **DONE 2026-10-10 (owner ran the helper; verified read-only, see "C1 result" below).** **Supabase auth settings, only after D4** (website live, consent screen published): Apple and Google on, manual linking on, skip-nonce off (needs the Google client secret at a silent prompt) | YOU/ME, CHANGE | only those keys differ from the baseline | PATCH back to baseline values (plan section 3) |
| C2 | **DONE 2026-10-10.** **Migration 0012** (`supabase db push --linked --dry-run` must list only 0012, then apply) | ME, CHANGE | `migration list` shows 0012; table exists, RLS on, **no grants to anon/authenticated**; other tables unchanged | unschedule first, then drop the table and `migration repair --status reverted 0012` |
| C3 | **DONE 2026-10-10 (owner set them with the helper).** **RevenueCat secrets**: `set-revenuecat-secrets.py set --apply` (phrase `SET PRODUCTION REVENUECAT SECRETS`) | YOU at the prompt, CHANGE | both names exist, digests as expected, every other digest unchanged | `remove --apply`, then revoke the key in the dashboard |
| C4 | **DONE 2026-10-10 (owner approved, including the Build 18 behavior change).** **Deploy `delete-account` and `revenuecat-cleanup`** (name only those two, from the worktree; `revenuecat-cleanup` must come up with `verify_jwt = false`) | ME, CHANGE | `functions list`: new `delete-account`, new `revenuecat-cleanup`; **`signal` and `race-discovery` hashes still equal the baseline**; cleanup answers 401 to the anon key and to no key | redeploy `delete-account` from tag `v1.0.0-build18` (download and diff), `functions delete revenuecat-cleanup` |
| C5 | **DONE 2026-10-10.** **Cleanup schedule**: `schedule-revenuecat-cleanup.py apply` (dry run shows preconditions met), then `apply --apply` (phrase `SCHEDULE PRODUCTION REVENUECAT CLEANUP`) | ME, CHANGE | job active, `*/30 * * * *`, no key in the job text; after the first scheduled time `verify` exits 0 (run succeeded, HTTP 200) | `remove --apply` |
| C6 | **DONE 2026-10-10.** **Throwaway production account smoke test** (a clearly named throwaway email; never a real or reviewer account): delete it, watch the request go `accepted` then `verified` on a scheduled run | ME, CHANGE (briefly adds then removes one account and one RevenueCat customer) | account gone; RevenueCat customer and alias 404 and still 404 after the next run; auth settings, secrets, RevenueCat settings equal the baseline | delete the throwaway; nothing else to undo |
| C7 | **Existing production customers, dry run only** (needs your approval to read production account ids; a reviewed production variant of the dry-run script first). **No deletion of existing customers in this checklist.** | ME, READ | a report: matched / anonymous / orphans, with purchase checks | none (read-only) |
| C8 | **`signal` deploy** only after your explicit decision that Build 18 users get the new answers immediately; follow the checklist's compatibility check, post-deploy Build 18 test and rollback | ME, CHANGE | hash of the deployed source = the verified commit; Build 18 test passes | redeploy from the Build 18 worktree, download and diff |

## D. Website and Google publishing (after C2 to C6 are verified, and **before C1**)
| # | Item | Who / type | Done when |
|---|---|---|---|
| D1 | **DONE 2026-10-10 (in the source; package prepared, not uploaded).** Remove the privacy `pending` marker (the deletion paragraph then describes exactly what C2 to C6 verified: 30-minute check, 10 attempts, 7-day recheck, request record deleted 30 days after confirmation, unresolved handled by hand) | ME | the highlighted block is gone only after C6's evidence is recorded |
| D2 | **DONE 2026-10-10** (October 9, 2026; change it if you publish later). Set the Privacy and Terms "Last updated" date to the publish date | ME | date set |
| D3 | **DONE 2026-10-10 (owner-reported; verified live from here).** `site-tools/prepare-site.py <empty folder> --confirm-published-changes`, then Cloudflare Pages upload and `racesignal.app` (+ `www`) custom domain | YOU/ME, CHANGE (public) | pages load over HTTPS; the homepage shows "Coming soon on the App Store" until the listing is public (the official badge swap is in `docs/site-review.md`; the package tool refuses an App Store link without `--app-store-live`) |
| D4 | **DONE for the purpose of C1 (2026-10-10).** Search Console domain verification done (`racesignal@gmail.com` is a verified owner, owner-reported); Google Auth platform Branding submitted and **under review** (owner-reported; its outcome is tracked, it does not gate C1); **Audience is confirmed In production (owner-confirmed 2026-10-10)** | YOU | recorded |

## E. App build (separate approval)
| # | Item | Who / type | Done when |
|---|---|---|---|
| E1 | `mobile/config/environments.json`: production `appleSignIn` and `googleSignIn` true, `pushEntitlement` false, production Google web client id; `npm run release:config` shows the Apple entitlement true, push plugin false, both flags on | ME | output recorded |
| E2 | Version 1.1.0; EAS production build (Apple prompts) | YOU/ME, CHANGE | build id recorded |
| E3 | App Store Connect: privacy label and policy URL (must match the published policy), RevenueCat sandbox tester, TestFlight | YOU | submitted |

## F. TestFlight-only checks (cannot be done earlier)
Real Apple token revocation on account deletion; StoreKit sandbox purchase, Restore Purchases and the deletion test against the **production** RevenueCat project; local notification delivery on the production binary; magic-link deliverability from the Gmail SMTP; Sign in with Apple and Google on the production backend, including Welcome-back and connect conflicts; Hide My Email.

## Standing gates and stop rules
- The **privacy marker stays pending and the website stays unpublished** until C6 is verified on production (D1 gates D3).
- **Production Google sign-in (C1) is not enabled until D3 and D4 are complete** (D4 = Audience confirmed **In production**, now confirmed by the owner; the branding review result is tracked but does not gate C1). C1 still needs its own explicit go.
- **C4 changes Build 18's account-deletion behavior**; it needs its own explicit go, and C4 and C5 are done close together.
- Stop at the first unexpected read-back, roll that row back, and report before anything else.
- Setting secrets bumps every function's version number: identify functions by hash and source, not version.
- No existing RevenueCat customer is deleted anywhere in this checklist; a deletion pass would be its own approved change.
- Weekly owner check once the schedule exists: `select app_user_id, status, attempts, last_error, first_requested_at from revenuecat_deletion_requests where status <> 'verified' order by first_requested_at;` plus the `revenuecat-cleanup` logs (there is no automatic alert).

## B2 in detail: create the restricted production key (you, private)
1. Open the RevenueCat dashboard and switch to the **production** project named **RaceSignal** (not **RaceSignal Dev**). Its address contains `48e9ded9`; the development project's contains `b98e9609`.
2. Project settings → **API keys** → **+ New secret API key**.
3. Name it `racesignal-prod-delete-account`. Choose **API version v2**.
4. Set every permission to **No access** except **Customer information → Customers = Read & write** (`customer_information:customers:read_write`). Do not add purchases, subscriptions, offerings or any project-configuration permission.
5. Generate, copy it once, and paste it only at the hidden prompt of the helper (B3 first, C3 later). Not into chat, a note or a file; clear the clipboard afterwards.
6. This must be a **new** key. The development key belongs to the development project and is refused by the helper (and rejected by RevenueCat for production in any case).
7. If the key is ever exposed, revoke it in the same screen and create another.

## Recorded results (read-only; nothing here changed production data or settings)
**B4, production baseline, 2026-10-10 (SELECTs, listings and the dry run only).** Equal to the plan's baseline: migrations 0001 to 0011; functions `signal` v17 (`cea75ad1…`), `race-discovery` v9 (`16a52866…`), `delete-account` v3 (`da04a55a…`), all unchanged by hash; secrets: the 14 names (ten earlier plus `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY`; **no** `REVENUECAT_SECRET_API_KEY` or `REVENUECAT_PROJECT_ID`); extensions `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` (`pg_cron` and `pg_net` not installed); Vault empty; ten public tables, all with row-level security on; `revenuecat_deletion_requests` and its index do not exist (no name clash); the 15 non-secret auth keys checked equal the saved 2026-10-08 baseline (185 saved keys, no difference). The snapshot is saved locally (not in the repo) for the later comparison. RevenueCat production still has 27 customers (7 account-id, 20 anonymous), none deleted; one account-id customer shows a new last-seen time (2026-10-09 23:43 UTC) from ordinary use, not from us.

**C2 dry run, 2026-10-10.** `supabase db push --linked --dry-run` (repo link = production, confirmed) listed **only** `0012_revenuecat_deletion_requests.sql`; nothing was applied. The same migration applied cleanly on development (Postgres 17.11); production runs 17.6 and has no conflicting object. **Side effect to know:** the CLI's connection step ("Initialising login role") created or refreshed a temporary production database login role, `cli_login_postgres` (not a superuser, member of `postgres`, valid for about five minutes: it was valid until 01:50 UTC and cannot log in after that). It is the CLI's standard mechanism and the real push will do the same; it leaves no data change, but it is a role entry on production and was not mentioned before the dry run.

**C2, migration 0012, APPLIED 2026-10-10 01:48 UTC (the first production change in this checklist).** Target confirmed as production (`supabase/.temp/project-ref` = `ibdqeagutcjmbbjnquzv`); a fresh dry run listed only `0012_revenuecat_deletion_requests.sql`; `supabase db push --linked --yes` applied it. **Verified read-only afterwards:**
- *Migration history:* 0001 to 0012, only 0012 added.
- *New table `public.revenuecat_deletion_requests`, production vs development:* columns (7), constraints (primary key on `app_user_id`; `status` check for queued/accepted/failed/verified), indexes (the primary key and the partial `revenuecat_deletion_requests_open_idx` on `last_attempt_at nulls first where status <> 'verified'`), row-level security on, no policies, and table grants are **identical** between the two projects.
- *Access restrictions:* no grants to `anon`, `authenticated` or `PUBLIC`; `service_role` has the usual full privileges. A direct read with the public anon key is refused (HTTP 401, Postgres error `42501`, permission denied). The table has 0 rows.
- *Existing tables and data unchanged:* compared with a snapshot taken immediately before the push, the 10 existing tables, 81 columns, 26 constraints, 16 indexes, row-level-security flags, 11 policies, 210 table grants and 5 public functions are identical, and every row count is identical (athlete_profiles 3, discovery_rate_limit 19, provider_config 1, races 78, signal_conversations 19, signal_free_usage 3, signal_messages 42, signal_rate_limit 2, signal_request_dedup 13, signal_usage_log 22).
- *Everything else unchanged vs the 2026-10-10 baseline:* function versions and hashes (`signal` v17, `race-discovery` v9, `delete-account` v3), all secret names and digests (still no RevenueCat secrets), the auth settings checked, the extensions (`pg_cron`/`pg_net` still not installed), Vault still empty.
- *Side effect:* the CLI again refreshed its temporary `cli_login_postgres` database login role (valid about five minutes), as it did for the dry run.
**Stopped here:** no secret set, no function deployed, nothing scheduled, nothing published or built.

**C3, C4, C5, C6 on production, 2026-10-10 (owner-approved; stopped before `signal`, auth settings, publishing and building).**
- **C3 secrets (set by the owner; verified read-only, 01:51:42 UTC):** `REVENUECAT_SECRET_API_KEY` and `REVENUECAT_PROJECT_ID` exist; the project id's digest equals the SHA-256 of `proj48e9ded9`; the key's digest differs from the development key's and from every other production secret; **all 14 baseline secrets still present with identical digests**. Setting them bumped every function's version (`race-discovery` v10, `signal` v18, `delete-account` v4) with **identical code hashes**.
- **C4 deploys (from the pushed commit `a4e073b`, in a clean worktree, named functions only, explicit production ref):** `delete-account` now v5 (hash `8b03eb29…`, new code) and `revenuecat-cleanup` v1 (`817a0b61…`, `verify_jwt = false`, new). **`signal` (`cea75ad1…`) and `race-discovery` (`16a52866…`) hashes are identical to the baseline.** This is live for Build 18 users too: their Settings → Delete account now also triggers the RevenueCat customer deletion and the request record.
- **Access restrictions (production, read-only requests):** `revenuecat-cleanup` answers **401** to the anon key (as `apikey` and as Bearer), to a garbage key, to no key and to a **signed-in athlete's token** (tested with the throwaway account), and 405 to GET; `delete-account` answers 401 without a user session.
- **C5 schedule (applied with `supabase/prod/schedule-revenuecat-cleanup.py apply --apply` at 01:53 UTC):** `pg_cron` and `pg_net` installed, the service key stored in Vault, job `revenuecat-cleanup` active at `*/30 * * * *`, **job text holds no key**. **First scheduled run 02:00:00 UTC: succeeded, HTTP 200** (`checked 1, verified 1, failed 0, needsAttention 0`); `verify` printed VERIFIED.
- **C6 throwaway deletion (a clearly named throwaway account, `rc-throwaway-prod-…@example.com`, never a real or reviewer account):** a throwaway auth user was created, given a RevenueCat customer with a linked anonymous alias (`$RCAnonymousID:4f4b43e3…`, confirmed as the customer's original id), then deleted through the real `delete-account` function. Result: `deleted: true`, `revenueCat: "requested"`, request row `accepted` (pending); the customer and its alias returned **404** within a minute and again after the schedule ran; the **scheduled 02:00 run marked the request `verified`** (attempts 1, no error). The auth user count (3) and `athlete_profiles` count (3) are back to what they were. **Only one hiccup, fully cleaned up:** my first attempt created the throwaway auth user and then failed before creating the RevenueCat customer (it could not find the public SDK key locally); I deleted exactly that throwaway user (matched by its throwaway email pattern) before the real run, and no RevenueCat customer had been created.
- **Existing data untouched:** the same 27 RevenueCat customers are present with identical records (none deleted, none created for the throwaway left behind); the 10 existing database tables, columns, constraints, indexes, policies, grants and functions are identical to the post-0012 snapshot, and every row count is identical except the new table gaining the throwaway's request row; secrets, auth settings and extensions (other than the two new ones) are unchanged. The owner's real account was not touched.
- **Not done (stopped here as instructed):** `signal` deploy, auth settings, website and Google publishing, privacy marker removal, any build, any deletion of existing customers. The privacy marker is still pending until you decide; the production behavior now matches the policy text (30-minute schedule, up to 10 attempts, 7-day recheck, 30-day record retention), with one open item: the "reappearance" recheck and the 10-attempt limit were verified on development, not provoked on production.

**D3, website live, and D4 progress, 2026-10-10 (no production backend or auth change).** Owner-reported: the site is live at `racesignal.app`; `racesignal@gmail.com` is a verified domain owner; Google branding is under review. Verified from here (read-only): the four pages answer 200 over HTTPS, `http` redirects to `https`, assets match the package; **differences to fix or accept:** Cloudflare Email Address Obfuscation hides the contact address from non-JavaScript readers (turn it off), `www` does not resolve yet, unknown paths answer 200 (no `404.html`). **Audience (Testing or In production) could not be confirmed from here**; C1 (enabling production Google sign-in) stays blocked until the owner confirms In production. Nothing on production auth, Signal, app links or builds changed.

**Audience confirmed In production (owner-confirmed 2026-10-10).** Google Auth platform → Audience says **In production**; branding is under review. Recorded; nothing on production auth, Signal, app links or builds changed.

## C1 in detail: production Apple, Google and manual-linking auth changes (applied 2026-10-10; result below)
Helper: `supabase/prod/configure-auth.py` (`status`, `apply`, `apply --apply`, `rollback`, `rollback --apply`). 20 tests with a fake API (mutation-checked); run read-only against production on 2026-10-10: `status` shows the baseline, `apply` (dry run) meets every precondition, `rollback` (dry run) shows the exact restore. Nothing was changed.

**The exact change (one PATCH of `/v1/projects/ibdqeagutcjmbbjnquzv/config/auth`; no other key):**
| Setting | Now (production) | After |
|---|---|---|
| `external_apple_enabled` | `false` | `true` |
| `external_apple_client_id` | `null` | `com.cristianvillamarin.racesignal` (native Sign in with Apple; no Apple secret needed) |
| `external_google_enabled` | `false` | `true` |
| `external_google_client_id` | `null` | `124971644702-0urm9vu8emtmjf8ucqni73em6ms656np.apps.googleusercontent.com` (the one Web client, also used by development; browser OAuth flow) |
| `external_google_secret` | unset | the Web client secret, typed by you at a **hidden prompt** (never in chat, an argument, an environment variable or a file) |
| `external_google_skip_nonce_check` | unset (default false) | `false` (**never turned on**) |
| `security_manual_linking_enabled` | `false` | `true` (needed for Settings → Sign-in methods → connect) |
Not touched: site URL (`racesignal://auth-callback`), redirect allow list (no `exp://` or dev scheme), SMTP and sender, rate limits, autoconfirm, sign-up, the additional-client-id and email-optional keys, and every other auth key (185 keys saved in the baseline).

**What the script refuses unless true:** production target (ref hard-coded; development refused); every target key still at its baseline value and no Google secret stored; the four `APPLE_*` function secrets exist; `https://racesignal.app/` and `/privacy/` answer 200. It prints, for you to confirm, what it cannot see (Audience In production, Search Console verified). Applying needs the phrase `CHANGE PRODUCTION AUTH SETTINGS`; the dry run never asks for the secret.

**Effect on Build 18 users: none.** Build 18 has no Apple or Google button, never calls `linkIdentity` and signs in by email link or password, which is unchanged. The new settings only matter to the 1.1 build.

**Verification (read-only, after applying):** the script re-reads the whole config: every target key holds its new value, the Google secret is stored, and **every other key equals what it was before** (any difference stops it and names the rollback). Then I re-run `status`, confirm the function hashes and secrets are unchanged, and re-check the redirect allow list and SMTP keys against the baseline. A real Google/Apple sign-in cannot be tested until the production build exists; the Google redirect URI for production (`https://ibdqeagutcjmbbjnquzv.supabase.co/auth/v1/callback`) was already confirmed accepted (2026-10-09).

**Rollback:** `python3 supabase/prod/configure-auth.py rollback --apply` (phrase `ROLL BACK PRODUCTION AUTH SETTINGS`): Apple and Google disabled, both client ids `null`, manual linking `false`, skip-nonce `false` (equivalent to the unset baseline), Google secret cleared; read-back checks the same way. `apply --apply` first saves the pre-change values to `~/.racesignal-prod/auth-before-<time>.json` (mode 600, no secret) and rollback uses it. **Two caveats:** (1) I cannot confirm that the API clears a stored Google secret (the provider is disabled either way, so a leftover secret is unused); if it stays, the script says so and you clear it in the dashboard (Authentication → Providers → Google). (2) Identities already linked while the providers were on stay in the database; those users can still sign in with email but not with the removed provider until it is re-enabled, so roll back before the 1.1 app reaches users.

**Live-site follow-up, 2026-10-10.** Owner turned Cloudflare Email Address Obfuscation off. Verified from here without JavaScript: the homepage, Privacy, Terms and Support pages expose `racesignal@gmail.com` as a plain `mailto:` link and visible text (no "[email protected]" placeholder, no Cloudflare decode script), and the four live pages are byte-identical to `site-dist/`. Still open and optional: `www.racesignal.app` does not resolve (no DNS record), and unknown paths answer 200 because there is no `404.html`. Audience is In production and branding is under review (owner-confirmed; recorded above).

## C1 result: production Apple, Google and manual-linking auth, APPLIED 2026-10-10 (~03:07 UTC)
The owner approved exactly the prepared settings and ran `python3 supabase/prod/configure-auth.py apply --apply` locally (typed the phrase `CHANGE PRODUCTION AUTH SETTINGS`, then the Google Web client secret at the hidden prompt; the secret never appeared in chat). The helper's own read-back passed. It saved the rollback values to `~/.racesignal-prod/auth-before-20261010T030659Z.json` (mode 600; contains only the six baseline values, **no secret**).

**Independently verified afterwards (read-only):**
- **Target settings:** `external_apple_enabled` true; `external_apple_client_id` `com.cristianvillamarin.racesignal`; `external_google_enabled` true; `external_google_client_id` `124971644702-0urm9vu8emtmjf8ucqni73em6ms656np.apps.googleusercontent.com`; `external_google_skip_nonce_check` **false**; `security_manual_linking_enabled` true; a Google client secret is stored (value never read or printed).
- **Nothing else changed:** of the 185 keys saved on 2026-10-08, exactly the six non-secret target keys above differ (plus the stored Google secret); **no other difference**, including site URL (`racesignal://auth-callback`), the redirect allow list (no `exp://`), SMTP, sender, rate limits, autoconfirm and sign-up. The few keys that file did not hold (for example `jwt_exp` 3600, password minimum length 6, refresh-token rotation on, the disabled hooks) equal development's values, and the helper's same-call before/after comparison covered every key it could read. A new non-secret post-change snapshot (195 keys) is saved locally for later comparisons.
- **What the auth server advertises:** `apple`, `google` and `email` are enabled; sign-up is unchanged (open) and autoconfirm is off.
- **Google wiring (a redirect check, no sign-in):** the production authorize URL sends the browser to `accounts.google.com` with the Web client ID above, redirect URI `https://ibdqeagutcjmbbjnquzv.supabase.co/auth/v1/callback`, scopes `email profile`, and Google answers with its normal sign-in page (no `redirect_uri_mismatch`, no access-blocked page).
- **Unchanged elsewhere:** `signal` and `race-discovery` code hashes equal the baseline, `delete-account` and `revenuecat-cleanup` are as deployed, every baseline secret has an identical digest, the database schema, grants and every row count are identical to before, and the RevenueCat cleanup schedule still verifies (latest run succeeded, HTTP 200).
- **Build 18:** unaffected; it has no Apple or Google button and never links identities.

**Not tested (cannot be until the production build exists):** a real Apple or Google sign-in, connecting a second method, and Welcome-back on production. Those are TestFlight checks (section F).

**Stopped here as instructed:** `signal` not deployed, app configuration and version not changed (`mobile/config/environments.json` still has the production flags off and no production Google client ID), nothing built or submitted.

**Remaining before a build can ship:** C7 (existing production customers, dry run only, if wanted), C8 (`signal`, your explicit decision about Build 18 users), then section E (app configuration, version 1.1.0, production build, App Store Connect), then section F (TestFlight checks). Rollback for this step: `python3 supabase/prod/configure-auth.py rollback --apply` (phrase `ROLL BACK PRODUCTION AUTH SETTINGS`); caveats as in "C1 in detail".
