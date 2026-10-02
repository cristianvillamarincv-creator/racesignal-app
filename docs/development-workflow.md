# RaceSignal development workflow

How we develop, test, and release. Facts here were verified against the repo, the Expo/EAS CLI, the Supabase CLI, and the RevenueCat API on 2026-10-02. Anything marked **UNCONFIRMED** needs the owner to check a dashboard or a device; nothing in this file should be read as a verified claim about those items.

## 1. Branches and the preserved release

| Ref | Purpose |
|---|---|
| tag `v1.0.0-build18` → `8e3f0ec` | The submitted release (version 1.0.0, build 18). **Never move or delete this tag.** |
| `milestone-b1-real-athlete-beta` | Historical working branch through Build 18. Preserved on origin; no further work here. |
| `release-1.1` | Integration branch for the next version, created from `8e3f0ec`. |
| `feature/<name>` | One branch per feature, cut from `release-1.1`, merged back when it passes its checkpoint. |
| `fix/1.0.x` | If Apple asks for a version 1.0 correction: branch **from the tag**, apply only the fix, build from it. Next-version features must not enter this branch. |

`origin/main` is still the July spec commit and is not part of this workflow. Do not merge into it until the owner decides how `main` should be used.

## 2. Who does what

- **Owner + ChatGPT (product/design/release lead):** scope, design, acceptance, App Store decisions.
- **Claude Code (implementation):** code, tests, root-cause tracing, commits, builds, submissions, **only when explicitly instructed**.
- **Owner:** all physical-iPhone QA, reporting PASS/FAIL against a named build or dev-session checkpoint.
- Standing rules: commit/build/deploy/submit only on explicit instruction; **no App Store review submission unless explicitly told**; no credentials in the repo, logs, or chat; never rerun the completed race-data repair (`supabase/functions/race-discovery/repair_*.ts`); don't spend the reviewer account's Signal asks.

## 3. Testing strategy: Expo first, TestFlight last

```
change → automated checks → Expo Go (JS-only) ─┐
                         → dev build (native)  ─┴→ checkpoint QA → … more checkpoints …
                                                   → consolidated release candidate
                                                   → automated checks + dev QA pass
                                                   → ONE TestFlight build → final QA → App Store
```

Do **not** create a TestFlight build per change. Group changes into checkpoints (a coherent feature or fix set), test each checkpoint in Expo, and only cut TestFlight for a release candidate.

### 3.1 Automated checks (run before any QA)

```bash
cd mobile
npx tsc --noEmit
npx eslint src __tests__ --max-warnings=0
npx jest                       # 27 suites / 216 tests at 8e3f0ec
npx expo-doctor                # 18/18 at 8e3f0ec
cd ../supabase/functions/signal && deno test --allow-read --no-check          # 32 tests
cd ../race-discovery && deno test --allow-read --no-check                      # 11 tests
```

Jest conventions (RTL 14 is async): `await render(...)`; wrap every `fireEvent` and `unmount` in `await act(async () => …)`; keep real `import`s above `jest.mock` calls (babel-jest hoists mocks; satisfies `import/first`); mock the Supabase client, AsyncStorage, and `expo-linking`. A full-router test via `expo-router/testing-library`'s `renderRouter()` is **not usable** on the current versions (`expo-router@6.0.24` does not await RTL 14's async `render()`); test routing logic in isolation instead (see `mobile/__tests__/tabsDefaultRouteEffect.test.tsx`).

### 3.2 Path A: Expo Go (JS-only features)

Because `expo-dev-client` is installed, `expo start` defaults to the development-build mode. Force Expo Go with `--go`:

```bash
cd mobile
npx expo start --go            # press `s` in the terminal to toggle between Expo Go and dev client
```

Scan the QR code with the iPhone camera (or Expo Go). `mobile/.env` is read by Metro.

- **Project SDK is 54** (`mobile/AGENTS.md` pins it for Expo Go compatibility). **UNCONFIRMED:** whether the Expo Go currently on the App Store still opens SDK 54 projects. If it does not, Path A is unavailable and Path B is the only on-device option.
- **Can test meaningfully in Expo Go:** layout and styling, navigation, Stats/Races/Race Prep UI, filters, manual race entry, race search/import against the backend, Signal chat and screenshot picking (the image picker is bundled in Expo Go), password sign-in, and anything that only calls the Supabase Edge Functions.
- **Cannot test in Expo Go:**
  - **Purchases / paywall.** `react-native-purchases` has no native module in Expo Go; it falls back to a preview mode with no real StoreKit. The hosted paywall (`react-native-purchases-ui`) behavior in Expo Go is **UNCONFIRMED** and `src/` has no Expo Go guard. Treat purchases as untestable here.
  - **Magic-link and OAuth callbacks.** The app redirects to `racesignal://auth-callback`, a custom scheme Expo Go does not own (Expo Go uses `exp://`). Use password sign-in in Expo Go. Do **not** add `exp://` URLs to the production Supabase redirect allowlist for this.
  - Native appearance items that depend on the real binary (app icon, splash behavior, permission strings, production signing).

### 3.3 Path B: Expo development build on the iPhone (native features)

Use this for purchases, magic-link/deep-link callbacks, permission prompts, splash/icon, and anything touching native modules.

**State found 2026-10-02:**
- The project is managed (no `ios/` folder); native config comes from `app.json` + plugins.
- Six `development-device` builds exist on EAS; the newest is from **2026-09-24** (commit `d88e9ff`).
- **That dev client is stale.** Native dependencies `react-native-purchases` and `react-native-purchases-ui` were added after it (2026-09-27), and `app.json` dropped `ios.icon` since. The current native fingerprint (`f7090e71…`) differs from those builds' fingerprints. **A new development build is required** before Path B works with the current code.
- **UNCONFIRMED:** whether the owner's iPhone is registered for ad-hoc/internal distribution (`eas device:list` failed non-interactively), whether iOS Developer Mode is on, and whether an old dev client is still installed.

**Caution: same bundle ID.** The development build uses the production bundle ID (`com.cristianvillamarin.racesignal`), so installing it **replaces** any TestFlight/App Store copy on that phone (and that copy's local session/data). Both also register the `racesignal://` scheme. If the owner wants both installed, a separate dev bundle ID/app variant is needed; that is an app-config change and **has not been made** (decision, §6).

**Steps (owner runs these; creating the build is not part of this task):**
```bash
cd mobile
npx eas-cli device:list                      # confirm the iPhone is registered; if not:
npx eas-cli device:create                    # follow the prompts to register it
npx eas-cli build --platform ios --profile development-device
# open the build URL/QR on the iPhone to install; enable Settings → Privacy & Security → Developer Mode if prompted
npx expo start --dev-client                  # Metro; open the installed RaceSignal dev client and connect
```
Rebuild the dev client **only when the native fingerprint changes** (new/removed native dependency, `app.json` native config, plugin change). Pure JS/TS changes reload through Metro. Check with `npx eas-cli fingerprint:generate --platform ios` and compare against the installed dev build's fingerprint (`npx eas-cli build:view <id>`).

**To test purchases in a dev build:** add `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=<RevenueCat iOS public SDK key>` to `mobile/.env.local` (gitignored; the key is not currently in `mobile/.env`, so RevenueCat is not configured in local dev). Use an Apple **sandbox** tester signed in under Settings → App Store → Sandbox Account. **UNCONFIRMED:** App Store Connect product status/pricing for `racesignal_premium_monthly` and `racesignal_premium_annual`, and whether they are fetchable in sandbox yet.

**What Path B can and cannot prove**
| Area | Dev build | Notes |
|---|---|---|
| Magic-link / deep-link return to the app | Yes | Same `racesignal://auth-callback`; needs Supabase email delivery (default shared mailer is rate-limited; custom SMTP **UNCONFIRMED**). |
| Password sign-in | Yes | Reviewer-style account. |
| Purchase sheet, restore, entitlement refresh | Yes (sandbox) | Real StoreKit sandbox + RevenueCat; server-side premium lookup uses the same RC project. Not a live-money test. |
| Image-picker permission prompt | Yes | Real permission copy from `app.json`. |
| Native icon/splash, production signing, receipt behavior under App Store distribution, TestFlight install/update path | **No** | Final check belongs to the TestFlight release candidate. |

### 3.4 TestFlight (release candidates only)

```bash
cd mobile
npx eas-cli build --platform ios --profile production --non-interactive --no-wait
npx eas-cli build:view <buildId>             # poll until finished
npx eas-cli submit --platform ios --profile production --id <buildId> --non-interactive
npx eas-cli submit:view <submissionId>       # if submit outlives the shell timeout; do not resubmit on a transient CLI error
```
Run only after automated checks and dev-build QA pass, and only when the owner says to. Build numbers are remote-managed (`appVersionSource: remote`); the next production build is **19**. Bump `expo.version` for the next App Store version when the owner decides the version number. EAS plan: Starter. Expo OTA updates are **not** configured (no `expo-updates`), so every shipped JS change needs a new build.

## 4. Protecting the production backend

**Verified 2026-10-02:**
- The Supabase CLI login sees **one** project, the production one. There is no staging/dev project.
- `mobile/.env` points at that project, so **local development (Expo Go or dev build) reads and writes production data today.**
- Docker is not installed, so a local Supabase stack (`supabase start`) is not currently possible. `supabase/config.toml` is minimal (function JWT settings only; no `[auth]`/`[api]`/`[db]`).
- EAS `development`/`preview` environments hold RevenueCat/Apple variables but **no** Supabase variables; the production environment holds the production Supabase URL/anon key.
- Deployed functions (`signal` v16, `race-discovery` v8, `delete-account` v2) are byte-identical to `8e3f0ec`; migrations 0001–0011 are applied.
- Premium status is resolved against the single RevenueCat project, so a sandbox purchase makes that Supabase user premium in the production `signal_rate_limit` accounting.

**Interim rules until an isolated environment exists:**
1. Use a dedicated test athlete account for QA; never use the reviewer account for load or Signal testing.
2. No schema, RLS, RPC, or function changes are tested against production.
3. Backend changes are developed and verified in an isolated environment first (below), then deployed once, deliberately.

**Recommended minimum setup (not created; needs the owner's decision):** a second hosted Supabase project, `racesignal-dev` (free tier is enough).
1. `supabase link` to the dev project, `supabase db push` (migrations 0001–0011), `supabase functions deploy race-discovery signal delete-account`.
2. Dev-project secrets: its own low-spend-limit Anthropic key (`ANTHROPIC_API_KEY`), `REVENUECAT_PUBLIC_API_KEY` (the same public key makes sandbox purchases count as premium; omit it to force `service_unavailable`), optional `SPORTSTATS_DAILY_REQUEST_CAP`.
3. Auth: enable the email provider and add `racesignal://auth-callback` to the redirect allowlist; create one password test athlete.
4. Point the app at it by putting the dev project's `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `mobile/.env.local` (gitignored, overrides `.env`). Remove that file to return to production deliberately.
5. Run the Build 18 compatibility checks (§5) against the dev project before touching production.

Alternative: a local Supabase stack (install Docker/OrbStack, add `[auth]` redirect config, `supabase functions serve` with a local env file). Better for migration iteration, harder for on-device testing (the phone must reach the laptop) and for RevenueCat/Anthropic integration.

## 5. Compatibility with Build 18 (and any older live build)

Backend deploys reach **every installed build immediately**. Until the owner confirms no Build ≤ 18 installs remain relevant, assume they exist.
- Migrations: additive only (new tables/columns/nullable fields). Do not drop or rename columns, tables, policies, or RPC signatures that Build 18 uses: `reserve_signal_ask` (current 6-argument form from migration 0011, with optional `p_request_id`/`p_claim_token`) and `release_signal_ask`, `claim_signal_request`, `complete_signal_request`, `fail_signal_request`, `athlete_profiles`, `races`, `signal_conversations`, `signal_messages`. Destructive changes need an expand → migrate → contract sequence, with the contract step only after old builds are gone.
- `signal` function: keep the request shape (`context`, `history`, `message`, optional `requestId`, optional `image`) and the response shape (`{available: true, data: {reply, remaining, cap, isPremium}}` / `{available: false, reason, detail?}`) and the existing `reason` values. New fields/reasons must be ignorable by Build 18.
- `race-discovery` and `delete-account`: keep action names, payload shapes, and response envelopes.
- Free/Premium rules (3 lifetime free, 40 per UTC month) are enforced server-side; changing them changes Build 18's behavior immediately.
- Order of operations for a change that needs both: ship the backward-compatible backend first, then the app that uses it; remove the old path last.

## 6. Open decisions / UNCONFIRMED items

Owner-confirmed state is required for each of these; none has been verified:
- Build 18 Apple processing / TestFlight availability and any App Review status.
- Device QA of Build 18 (cold launch lands on Stats; deep links; post-login path).
- Whether the iPhone is registered with EAS and in Developer Mode; whether an old dev client is installed.
- Whether the App Store Expo Go still opens SDK 54.
- Whether to create `racesignal-dev` (Supabase) and a separate dev bundle ID/app variant.
- Anthropic Zero Data Retention status and the resulting privacy-policy/App Store privacy-label wording (the published policy has not been changed).
- Custom SMTP in Supabase Auth; App Store Connect product prices/trials; RevenueCat restore behavior.
- Free-allowance reset after account deletion + re-signup; RevenueCat customer deletion on account deletion.
