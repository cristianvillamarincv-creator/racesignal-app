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
| B3 | Dry-run the key: `python3 supabase/prod/set-revenuecat-secrets.py set` (hidden prompt, **no `--apply`**) | YOU, READ | prints "accepted by the PRODUCTION project, rejected by the development project", no warning |
| B4 | Re-capture the production baseline (migrations, functions, hashes, secret names, auth settings) and confirm it equals `docs/production-change-plan-1.1.md` | ME, READ | matches |
| B5 | Deploy source = the verified commit on `release-1.1` pushed to GitHub, clean working tree (worktree) | ME | commit id recorded |

## C. Backend (production), in this order
| # | Change | Who / type | Verify afterwards (READ) | Rollback |
|---|---|---|---|---|
| C1 | **Supabase auth settings**: Apple and Google on, manual linking on, skip-nonce off (needs the Google client secret at a silent prompt) | YOU/ME, CHANGE | only those keys differ from the baseline | PATCH back to baseline values (plan section 3) |
| C2 | **Migration 0012** (`supabase db push --linked --dry-run` must list only 0012, then apply) | ME, CHANGE | `migration list` shows 0012; table exists, RLS on, **no grants to anon/authenticated**; other tables unchanged | unschedule first, then drop the table and `migration repair --status reverted 0012` |
| C3 | **RevenueCat secrets**: `set-revenuecat-secrets.py set --apply` (phrase `SET PRODUCTION REVENUECAT SECRETS`) | YOU at the prompt, CHANGE | both names exist, digests as expected, every other digest unchanged | `remove --apply`, then revoke the key in the dashboard |
| C4 | **Deploy `delete-account` and `revenuecat-cleanup`** (name only those two, from the worktree; `revenuecat-cleanup` must come up with `verify_jwt = false`) | ME, CHANGE | `functions list`: new `delete-account`, new `revenuecat-cleanup`; **`signal` and `race-discovery` hashes still equal the baseline**; cleanup answers 401 to the anon key and to no key | redeploy `delete-account` from tag `v1.0.0-build18` (download and diff), `functions delete revenuecat-cleanup` |
| C5 | **Cleanup schedule**: `schedule-revenuecat-cleanup.py apply` (dry run shows preconditions met), then `apply --apply` (phrase `SCHEDULE PRODUCTION REVENUECAT CLEANUP`) | ME, CHANGE | job active, `*/30 * * * *`, no key in the job text; after the first scheduled time `verify` exits 0 (run succeeded, HTTP 200) | `remove --apply` |
| C6 | **Throwaway production account smoke test** (a clearly named throwaway email; never a real or reviewer account): delete it, watch the request go `accepted` then `verified` on a scheduled run | ME, CHANGE (briefly adds then removes one account and one RevenueCat customer) | account gone; RevenueCat customer and alias 404 and still 404 after the next run; auth settings, secrets, RevenueCat settings equal the baseline | delete the throwaway; nothing else to undo |
| C7 | **Existing production customers, dry run only** (needs your approval to read production account ids; a reviewed production variant of the dry-run script first). **No deletion of existing customers in this checklist.** | ME, READ | a report: matched / anonymous / orphans, with purchase checks | none (read-only) |
| C8 | **`signal` deploy** only after your explicit decision that Build 18 users get the new answers immediately; follow the checklist's compatibility check, post-deploy Build 18 test and rollback | ME, CHANGE | hash of the deployed source = the verified commit; Build 18 test passes | redeploy from the Build 18 worktree, download and diff |

## D. Website and Google (after C1 to C6 are verified)
| # | Item | Who / type | Done when |
|---|---|---|---|
| D1 | Remove the privacy `pending` marker (the deletion paragraph then describes exactly what C2 to C6 verified: 30-minute check, 10 attempts, 7-day recheck, request record deleted 30 days after confirmation, unresolved handled by hand) | ME | the highlighted block is gone only after C6's evidence is recorded |
| D2 | Set the Privacy and Terms "Last updated" date to the publish date | ME | date set |
| D3 | `site-tools/prepare-site.py <empty folder> --confirm-published-changes`, then Cloudflare Pages upload and `racesignal.app` (+ `www`) custom domain | YOU/ME, CHANGE (public) | pages load over HTTPS; the App Store badge does **not** go live before the app's App Store listing exists (badge decision recorded in `docs/site-review.md`) |
| D4 | Search Console domain verification (TXT) and Google Auth platform Branding (homepage, privacy, terms, authorized domain `racesignal.app`), then Publish app | YOU | consent screen published |

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
