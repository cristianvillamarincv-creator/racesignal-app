# Production change plan for 1.1 (for approval)

Prepared 2026-10-08. **Nothing in this plan has been executed.** Every step below needs your explicit go, one at a time. Build 18 and its production services are unchanged today. Related: `docs/production-setup-1.1.md` (who does what) and `docs/release-1.1-checklist.md` (compatibility, rollback detail, verification).

Production project ref: `ibdqeagutcjmbbjnquzv` (always passed explicitly; this repo's Supabase link points at it, so a bare command would also target production).

## Baseline captured read-only (the state every rollback returns to)
| Item | State on 2026-10-08 |
|---|---|
| Functions | `signal` v16, `race-discovery` v8, `delete-account` v2. Downloaded sources are **byte-identical to tag `v1.0.0-build18`** (`signal`: index, usage, systemPrompt; `delete-account`: index; `race-discovery`: all three files). The tag is on GitHub. |
| `signal` bundle hash | `cea75ad1d54539788adccafc4aafab8bda956652b1acf13dd55bab8e30acec92` (v16) |
| Migrations | 0001 to 0011, same as development. **No migration is part of 1.1.** |
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
4. Deploy `delete-account`.
5. Deploy `signal`, last among the backend steps because it changes Build 18 users' answers immediately.
6. App configuration, version bump and build (separate approval; not part of this plan's backend steps).

Steps 1 to 4 add capability that Build 18 never uses, so they cannot change Build 18 behavior. Step 5 can.

## Progress
- **Step 0, CLI token rotation: done 2026-10-08.** The old token was revoked by the owner; the replacement login (plain `sbp_`, 44 characters, created 2026-10-08 16:25:07 UTC) was verified read-only against both projects, and production was confirmed unchanged (functions v16, v8, v2; auth settings equal to the saved baseline; no `APPLE_*` secrets). The old token's revocation itself could not be tested from this machine (its value is gone); the owner removed it in the dashboard.
- **Step 1, Apple capability: done 2026-10-08 (owner-reported).** The production App ID `com.cristianvillamarin.racesignal` has **Sign in with Apple** enabled as a primary App ID and **Push Notifications unchecked**. Not independently verifiable from here (no Apple API access); it will show up in the build's synced-capabilities step.
- Next: the production Sign in with Apple key (Apple console), then Google Cloud. No Supabase change, secret or deployment has been made.

## 0. Rotate the Supabase CLI token (you)
- **Identify first:** the token in use is the CLI login token in the Keychain: prefix `sbp_30f5`, 44 characters, created **2026-08-27 17:00:15 UTC** (a dashboard entry whose name contains about `1787850015`). Details in `docs/development-environment.md`.
- **Change:** Supabase dashboard → Account → Access Tokens → revoke **only that entry**; leave any other token you recognize as in use. Then `supabase logout` and `supabase login`.
- **Verify (me, read-only):** `supabase projects list` and a read of both projects work with the new login.
- **Rollback:** none needed; a token can always be recreated by logging in again.

## 1. Consoles (you; private)
**Apple Developer:** App ID `com.cristianvillamarin.racesignal` → enable **Sign in with Apple** (not Push); create a Sign in with Apple **key** whose primary App ID is that App ID; keep the `.p8`, Key ID and Team ID private. *Rollback:* revoke the key; the capability can stay (unused) or be removed once no build uses it.
**Google Cloud (project RaceSignal):** on the existing Web client add `https://ibdqeagutcjmbbjnquzv.supabase.co/auth/v1/callback` as a second redirect URI; set the consent screen's audience to **In production** (basic scopes only); decide on brand verification (needs a domain you own). *Rollback:* remove the added redirect URI and set the audience back to Testing.

## 2. Function secrets (you at a silent prompt, or me with your prompt)
- **Change:** set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (`com.cristianvillamarin.racesignal`) and `APPLE_PRIVATE_KEY` on production. (The helper for this is dev-only today; I would prepare a production variant with the same silent prompt and an explicit project ref for your review before anything runs.)
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

## 5. Deploy `signal`
Follows the compatibility check, post-deploy Build 18 test and rollback procedure in `docs/release-1.1-checklist.md` exactly (redeploy from the Build 18 worktree, download and diff, no data cleanup). **Decision for you before this step:** Build 18 users get the new answers immediately.

## 6. App configuration, version, build (separate approval)
`production.features.appleSignIn` and `googleSignIn` set to `true`, `pushEntitlement` left `false`, `production.google.webClientId` set; `npm run release:config` must show the Apple entitlement `true`, `pushEntitlementPlugin` `false` and both auth flags on; version 1.1.0; EAS production build (Apple login prompts during the build). *Rollback:* flip the flags back to `false` and rebuild (the checklist's Rollback section); nothing here changes the backend.

## Approval gates
You approve each of steps 0 to 5 separately; I run only what you approve, read back afterward, and stop at the first surprise. Anything that fails verification is rolled back before the next step.

## Tracked, not part of these changes
The RevenueCat customer record left behind by account deletion (**unresolved**: confirm what RevenueCat retains, then decide the handling; a privacy-policy statement alone does not close it); the App Store privacy label and policy text; the Build 18 behavior-change decision for step 5.
