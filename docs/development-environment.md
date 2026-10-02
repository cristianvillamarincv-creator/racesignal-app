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

`mobile/app.config.js` (layered over `app.json`, which stays the production source of truth) reads `APP_VARIANT=development|production`. **Unset means production.** The config then refuses to evaluate when the credentials in the environment do not match the variant:

- `development` + a Supabase URL that is not the dev project, or a RevenueCat key that is not `test_...` -> error.
- `production` + the dev Supabase URL, or a `test_` RevenueCat key -> error.
- `development` with no URL only warns (the app then has no backend; `eas build` evaluates config with `.env` loading disabled, so this must not be fatal).

Env files (all gitignored except `.env.example`, `chmod 600`): `mobile/.env.development` (dev URL, dev anon key, `test_` RevenueCat key, `EXPO_PUBLIC_ENABLE_DEV_PREVIEW`) is loaded by `expo start`; `mobile/.env.production` is loaded when `NODE_ENV=production`. `mobile/.env` holds comments only. Cloud builds read EAS variables, not these files: `eas.json` sets `environment` + `APP_VARIANT` per profile (`development` / `development-device` -> development; `production` -> production; `preview` unchanged).

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

## Dev account and synthetic data

`supabase/dev/seed-dev.mjs` creates/refreshes the dev athlete and synthetic races (`--reset` to rebuild). It refuses to run against any host other than the dev project. Needs `DEV_SUPABASE_URL` and `DEV_SERVICE_ROLE_KEY` in the environment (get the service key with `supabase projects api-keys --project-ref <dev ref>`). The dev password lives in `~/.racesignal-dev/dev-account-password` (not in the repo; regenerate by re-running the seed after deleting the file). No production users, races, conversations, or reviewer credentials were copied.

## Dev secrets

Set on the dev project only. `REVENUECAT_PUBLIC_API_KEY` (Test Store key) is already set. **`ANTHROPIC_API_KEY` is not set**, so Signal replies with `model_error` in dev until the owner sets it:

1. Anthropic Console -> create a separate Workspace (e.g. "RaceSignal Dev") with a low monthly spend limit, and create an API key inside it.
2. In a terminal, from the repo root: `supabase/dev/set-dev-secret.sh ANTHROPIC_API_KEY`. It prompts silently (no echo, nothing in shell history or chat) and can only target the dev project.

## Purchases: Test Store vs real sandbox

The dev RevenueCat project uses the **Test Store**: purchases are simulated by RevenueCat's servers. No StoreKit, no App Store Connect product, no sandbox Apple ID. This validates: offering/paywall rendering, the purchase -> entitlement `premium` flow, the Supabase-user-ID -> RevenueCat app-user-ID mapping, and server-side Premium enforcement (the `signal` function resolves the entitlement via RevenueCat REST with the dev `test_` key). It does **not** validate: real StoreKit behavior, App Store Connect product configuration, restore under a real Apple ID, receipt behavior under TestFlight/App Store distribution. Those remain a production-bundle sandbox/TestFlight check.

Dev project contents: entitlement `premium`; Test Store products monthly ($9.99) and annual ($79.99); offering `default` with `$rc_monthly`/`$rc_annual`. The dev hosted paywall is an **unpublished draft**: before purchases can be tested on device, open it in the RevenueCat dev project, set the Terms and Privacy footer URLs to the ones in `mobile/src/lib/legalLinks.ts`, and publish it (dev project only).

## Verified on 2026-10-02

- Automated: `tsc` clean, eslint 0 warnings, jest 28 suites / 219 tests (incl. redirect-scheme test), `expo-doctor` 18/18.
- Config matrix: production config is identical to Build 18 apart from explicit `appVariant`; dev config yields RaceSignal Dev / `racesignal-dev` / `.dev`; guards refuse mismatched backends.
- Dev backend smoke tests: password sign-in; `signal` 401 unauthenticated, `bad_request` on empty message, a valid request reaches the model call (so the RevenueCat entitlement lookup and ask reservation succeeded; it stops at the missing Anthropic key); `delete-account` deleted a throwaway user and cascaded their profile row.
- Production-unchanged check (against snapshots taken before any dev work): functions `signal` v16 / `race-discovery` v8 / `delete-account` v2 with identical bundle hashes; migrations 0001-0011; all 10 secret name+digest pairs identical; EAS production/preview variables identical; `supabase/.temp/project-ref` in the repo still points at production.

## Not verified / limitations

- Nothing was run on a device. Magic-link return to `racesignal-dev://`, the dev paywall, and a Test Store purchase are untested until a dev build exists.
- Supabase's default SMTP is heavily rate-limited and on a free project only sends to team members; use password sign-in for the dev account, or configure SMTP.
- Free-tier Supabase projects pause after a week of inactivity; unpause from the dashboard.
- Costs: Supabase free plan, RevenueCat dev project and Test Store free, EAS usage counts against the existing Starter plan. Anthropic spend in dev is capped by the dev workspace limit once set.
