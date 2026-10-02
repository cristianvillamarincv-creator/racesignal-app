# RaceSignal development environment

Set up 2026-10-02 on `release-1.1`. Production (Build 18) was not modified; see "Production-unchanged check" below. No dev build has been created and nothing was submitted to Apple.

## What exists

| | Production | Development |
|---|---|---|
| App display name | RaceSignal | RaceSignal Dev |
| iOS bundle ID | `com.cristianvillamarin.racesignal` | `com.cristianvillamarin.racesignal.dev` |
| URL scheme (magic links) | `racesignal://` | `racesignal-dev://` |
| Supabase | the original project | `racesignal-dev` (free plan, ref in `mobile/config/environments.json`) |
| RevenueCat | production project, iOS app (`appl_` key) | separate dev project, **Test Store** (`test_` key) |
| Anthropic key | production key | separate dev key with its own spend limit (**owner sets it**, see below) |
| Data | real athletes | synthetic only (`dev.athlete@example.com` + 8 synthetic races) |
| EAS environment | `production` (and `preview`) | `development` |

The dev backend has migrations 0001-0011 and the three Edge Functions (`race-discovery`, `signal`, `delete-account`) deployed **from this repo's current code**, plus Supabase Auth redirect URLs for `racesignal-dev://**` and `exp://**` (Expo Go). Production's redirect allowlist was not touched and must not receive `exp://` URLs.

## How the environment is chosen (no silent fallback)

`mobile/app.config.js` (layered over `app.json`, which stays the production source of truth) reads `APP_VARIANT=development|production`. **Unset means production.** The same checks (`mobile/config/environmentGuards.js`) run at two stages:

| Condition | 1. Config evaluation (`app.config.js`: `expo start`, `expo config`, `expo export`, cloud EAS build) | 2. App startup (`src/lib/environment.ts`, imported by the Supabase client and RevenueCat wrapper) |
|---|---|---|
| development, backend/anon key/RevenueCat key **missing** | **refused**, except a *local `eas` CLI* evaluation (`EXPO_NO_DOTENV` set and not `EAS_BUILD`: no env files, no EAS variables, so absence proves nothing) which only warns | **always refused** (throws before any client exists) |
| development, Supabase URL not `<dev ref>.supabase.co` (incl. lookalike hosts) | refused (every context) | refused |
| development, anon key JWT belongs to another project | refused | refused |
| development, RevenueCat key not `test_...` | refused | refused |
| production, dev Supabase URL / dev anon key / `test_` RevenueCat key | refused | refused |
| production, settings missing | tolerated (unchanged from Build 18: warn, unreachable placeholder) | tolerated |
| unknown `APP_VARIANT` | refused | n/a (anything not `development` is production) |

So the earlier "missing backend only warns" gap is closed where it matters: the only tolerated case is the local `eas` CLI's own config read; the cloud build re-evaluates the config with the EAS environment's variables (strict), and a development **bundle** that somehow has missing or production settings throws at launch. Checked on 2026-10-02 by exporting real bundles: the development bundle contains the dev ref and the `test_` key and no production ref; the production bundle contains the production ref and no `test_` key; the dev ref string also appears in the production bundle only as the guard's comparison constant (from `config/environments.json`).

Tests: `__tests__/environmentGuards.test.ts` (matrix), `__tests__/environmentStartup.test.ts` (import-time refusal), `__tests__/appConfig.test.ts` (config evaluation).

Env files (all gitignored except `.env.example`, `chmod 600`): `mobile/.env.development` (dev URL, dev anon key, `test_` RevenueCat key, `EXPO_PUBLIC_ENABLE_DEV_PREVIEW`) is loaded by `expo start`; `mobile/.env.production` is loaded when `NODE_ENV=production`. `mobile/.env` holds comments only. Cloud builds read EAS variables, not these files. `eas.json`: `development` and `development-device` set `"environment": "development"` and `"env": {"APP_VARIANT": "development"}`; `production` sets `"environment": "production"` and `APP_VARIANT=production`; `preview` is unchanged (not used for dev). All npm launch scripts (`start`, `ios`, `android`, `start:go`, `start:dev`) set `APP_VARIANT=development` explicitly.

The magic-link redirect is derived from the running build's scheme (`getAuthRedirectUri` in `src/lib/auth.tsx`, covered by `__tests__/authRedirectScheme.test.ts`), so with both apps installed each gets its own link back.

## Commands

All from `mobile/`. **Expo Go** (JS-only; password sign-in; no purchases, no magic-link return):
```bash
npm run start:go        # APP_VARIANT=development expo start --go
```
**Development build** (after the one-time build exists; Metro only):
```bash
npm run start:dev       # APP_VARIANT=development expo start --dev-client
```
**Creating the dev build (NOT done yet; owner decision):**
```bash
npx eas-cli device:list                                   # iPhone registered?
npx eas-cli build --platform ios --profile development-device
```
The first build for the new bundle ID needs interactive Apple credential/provisioning setup (new App ID + ad-hoc profile) and the device registered. The app installs next to the production/TestFlight app instead of replacing it.

**Confirm which backend a config points at (no secrets printed):**
```bash
APP_VARIANT=development npx expo config --type public | grep -E "name:|scheme:|bundleIdentifier:|appVariant:"
npx eas-cli config --platform ios --profile development-device     # expect RaceSignal Dev / .dev
npx eas-cli env:list development                                    # names only unless --include-sensitive
```
In a running dev build the home-screen name is "RaceSignal Dev"; the variant is also exposed as `Constants.expoConfig.extra.appVariant`.

## Backend commands (dev only, explicit target)

The repo's `supabase/.temp` link points at **production**, so bare `supabase db push`, `supabase functions deploy`, or `supabase secrets set` from `supabase/` would change production. Use these instead; none of them reads or changes that link:

```bash
supabase/dev/dev-supabase.sh status              # remote migrations + function versions/hashes on dev
supabase/dev/dev-supabase.sh push --dry-run      # then without --dry-run to apply supabase/migrations to dev
supabase/dev/dev-supabase.sh deploy [signal ...] # deploy functions (default all three) to dev
supabase/dev/dev-supabase.sh secrets             # dev secret names + digests
supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY # silent prompt, dev only
supabase/dev/verify-signal.sh                    # Signal + quota accounting check on dev
```

`dev-supabase.sh` copies config/migrations/functions into a throwaway workspace, links *that* to the dev ref from `mobile/config/environments.json`, aborts if the linked ref is not the dev ref or equals production's, and passes `--project-ref` explicitly to every command. `set-dev-secret.sh` always passes the dev ref and only accepts three secret names. `seed-dev.mjs` refuses any host other than the dev project. Dev function bundles were verified identical (same SHA-256) to production's at Build 18.

## First development build (owner-run; not created yet)

Prerequisites, in order:
1. `ANTHROPIC_API_KEY` set on dev and `supabase/dev/verify-signal.sh` passing (above). The dev paywall is already published.
2. **Register the iPhone for internal distribution** (needs your Apple ID; interactive, so it cannot be scripted): `cd mobile && npx eas-cli device:list` (see if it is there). If not: `npx eas-cli device:create`, choose "Website" (a URL/QR), open that link **on the iPhone in Safari**, install the downloaded profile (Settings -> Profile Downloaded -> Install). Apple needs the device UDID in the provisioning profile; the profile is created for the new bundle ID in the build step below.
3. **Developer Mode on the iPhone** (iOS 16+): Settings -> Privacy & Security -> Developer Mode -> on, restart. The switch only appears after a development/ad-hoc app has been installed once, so you may need to install the build first, then enable it, restart, and open the app.
4. During the build, the CLI asks you to log in to your Apple Developer account and approve **creating the App ID `com.cristianvillamarin.racesignal.dev`** plus an ad-hoc provisioning profile and distribution certificate (reuse the existing distribution certificate if offered). This does not touch the production App ID or any App Store Connect app record, and no App Store Connect record is needed for the dev bundle ID.

The command (from `mobile/`):
```bash
npx eas-cli build --platform ios --profile development-device
```
It evaluates the config with the EAS `development` environment (strict guards) and `APP_VARIANT=development`. The dev bundle ID has its **own** remote build-number counter (verified: `eas build:version:get` reports none yet for `development-device`, while production stays at 18, so the next production build is still 19). When it finishes, open the build page on the iPhone to install **RaceSignal Dev** (it installs next to RaceSignal/TestFlight), then on the Mac:
```bash
cd mobile && npm run start:dev      # open RaceSignal Dev and connect to Metro
```
Sign in with `dev.athlete@example.com` (password in `~/.racesignal-dev/dev-account-password`; reveal it only in your own terminal, e.g. `pbcopy < ~/.racesignal-dev/dev-account-password`).

## Dev account and synthetic data

`supabase/dev/seed-dev.mjs` creates/refreshes the dev athlete and synthetic races (`--reset` to rebuild). It refuses to run against any host other than the dev project. Needs `DEV_SUPABASE_URL` and `DEV_SERVICE_ROLE_KEY` in the environment (get the service key with `supabase projects api-keys --project-ref <dev ref>`). The dev password lives in `~/.racesignal-dev/dev-account-password` (not in the repo; regenerate by re-running the seed after deleting the file). No production users, races, conversations, or reviewer credentials were copied.

## Dev secrets

`REVENUECAT_PUBLIC_API_KEY` (Test Store key) is set on dev. **`ANTHROPIC_API_KEY` is not set**, so Signal returns `model_error` in dev until the owner sets it (a failed model call consumes no quota; verified).

1. console.anthropic.com -> Settings -> **Workspaces** -> create a workspace named `RaceSignal Dev` (separate from the production workspace).
2. In that workspace open **Limits** and set a monthly spend limit (e.g. US$10) and, if offered, a rate limit. Also check the organization-level spend limit/notifications under Settings -> **Limits** and Billing. (Labels may differ slightly; the point is a hard cap on the *dev workspace*.)
3. Workspace -> **API keys** -> Create key named `racesignal-dev`, selecting the `RaceSignal Dev` workspace. Copy it once; do not paste it anywhere except step 4.
4. In a terminal (repo root): `supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY`, paste the key at the hidden prompt, Enter. Nothing is echoed, stored in a file, or put in shell history.
5. Tell Claude it is set; it will run `supabase/dev/verify-signal.sh`.

`supabase/dev/verify-signal.sh` (dev only, synthetic account) resets the dev account's free counter, sends one real Signal request, repeats the same `requestId`, and checks: the reply succeeded; `signal_free_usage.lifetime_count` moved by exactly 1 (cap 3 lifetime); the duplicate was served from the dedup cache without a second ask; `signal_usage_log` gained exactly one row.

## Rotating the Supabase access token

Why: a prefix of the personal access token the Supabase CLI uses was printed in terminal output during setup, and the full token is also saved inside `.claude/settings.local.json` (Claude Code's local, untracked, globally git-ignored permission rules; never committed). Rotating makes both moot.

1. supabase.com/dashboard/account/tokens -> find the token(s) the CLI created (names like `cli_<user>@<host>_<timestamp>`; if unsure which, delete all CLI tokens). Deleting revokes immediately. This only affects CLI/API access, not the app.
2. `supabase logout`, then `supabase login` (browser flow). The new token goes into the macOS keychain.
3. Delete the saved rules containing `Authorization: Bearer sbp_...` from `.claude/settings.local.json` (search for `sbp_`), or delete that file; Claude Code recreates it.
4. Verify: `supabase projects list` works with the new login; `grep -c sbp_ .claude/settings.local.json` prints 0.
5. If you ever exported `SUPABASE_ACCESS_TOKEN` in a shell profile, update it there (none was found on this machine).

Nothing else depends on the old token: the helper scripts use the CLI login, and no token is stored in the repo, `~/.racesignal-dev`, or the EAS environments.

## Purchases: Test Store vs real sandbox

The dev RevenueCat project uses the **Test Store**: purchases are simulated by RevenueCat's servers. No StoreKit, no App Store Connect product, no sandbox Apple ID. This validates: offering/paywall rendering, the purchase -> entitlement `premium` flow, the Supabase-user-ID -> RevenueCat app-user-ID mapping, and server-side Premium enforcement (the `signal` function resolves the entitlement via RevenueCat REST with the dev `test_` key). It does **not** validate: real StoreKit behavior, App Store Connect product configuration, restore under a real Apple ID, receipt behavior under TestFlight/App Store distribution. Those remain a production-bundle sandbox/TestFlight check.

Dev project contents: entitlement `premium`; Test Store products monthly ($9.99) and annual ($79.99); offering `default` with `$rc_monthly`/`$rc_annual`. The dev hosted paywall (`pwbd4e0f9d18ea4fb2` in project `RaceSignal Dev`) is **published** (2026-10-02) on the `default` offering with `$rc_annual` and `$rc_monthly`; its Terms and Privacy footer links open the same URLs as `mobile/src/lib/legalLinks.ts` in an in-app browser. The production project's paywall (published 2026-09-27, revision 4) and offering were not touched. Verified in the dev project: entitlement `premium` has both products attached; both packages map to the monthly/annual Test Store products.

## Verified on 2026-10-02

- Automated: `tsc` clean, eslint 0 warnings, jest 31 suites / 249 tests (incl. environment guard tests), `expo-doctor` 18/18.
- Config matrix: production config is identical to Build 18 apart from explicit `appVariant`; dev config yields RaceSignal Dev / `racesignal-dev` / `.dev`; guards refuse mismatched backends.
- Dev backend smoke tests: password sign-in; `signal` 401 unauthenticated, `bad_request` on empty message, a valid request reaches the model call (so the RevenueCat entitlement lookup and ask reservation succeeded; it stops at the missing Anthropic key); `delete-account` deleted a throwaway user and cascaded their profile row.
- Production-unchanged check (against snapshots taken before any dev work): functions `signal` v16 / `race-discovery` v8 / `delete-account` v2 with identical bundle hashes; migrations 0001-0011; all 10 secret name+digest pairs identical; EAS production/preview variables identical; `supabase/.temp/project-ref` in the repo still points at production.

## Not verified / limitations

- Nothing was run on a device. Magic-link return to `racesignal-dev://`, rendering of the dev paywall, and a Test Store purchase are untested until a dev build exists. A successful Signal reply on dev is untested until the Anthropic dev key is set.
- Supabase's default SMTP is heavily rate-limited and on a free project only sends to team members; use password sign-in for the dev account, or configure SMTP.
- Free-tier Supabase projects pause after a week of inactivity; unpause from the dashboard.
- Costs: Supabase free plan, RevenueCat dev project and Test Store free, EAS usage counts against the existing Starter plan. Anthropic spend in dev is capped by the dev workspace limit once set.
