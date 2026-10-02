# RaceSignal — Technical & Workflow Handoff (2026-10-02)

> **Snapshot document.** Written 2026-10-02 against commit `8e3f0ec` (Build 18). It is a point-in-time record and is not updated as the code changes. For current guidance see `docs/development-workflow.md`, `mobile/README.md`, and `supabase/README.md`.
>
> **Errata (found 2026-10-02 while preserving the release):** §1 said `origin` had only `main` at the Aug 21 "Downgrade to Expo SDK 54" commit. That commit (`a74334f`) is the **local** `main`, which has never been pushed. Remote `main` is `3021cde` (Jul 23, "Add RaceSignal master build specification"). The branch and tag preservation described in §1 and §6 has since been done: `milestone-b1-real-athlete-beta` and tag `v1.0.0-build18` are on origin; `release-1.1` was created from `8e3f0ec`.

Prepared by Claude Code (implementation) for ChatGPT (product / design / release lead). Read-only inspection: no code changed, nothing deployed, committed, or built. No credentials or env-var values are included (only names).

**Confidence tags**
- **[V]** Verified today from the repo, Supabase CLI, EAS CLI, RevenueCat API, or a test run.
- **[R]** Previously reported in our session history; cannot be re-verified from the repo now.
- **[U]** Cannot be verified from here (needs the user, App Store Connect, or a dashboard).

---

## 1. Release checkpoint

| Item | State |
|---|---|
| Branch / HEAD | `milestone-b1-real-athlete-beta` @ `8e3f0ec` "Build 16: make cold-launch Stats redirect conditional on no explicit destination" **[V]** |
| Uncommitted | Nothing tracked. Untracked only: `.DS_Store`, `.agents/`, `.claude/`, `brand/` (logo exports, intentionally uncommitted), `skills-lock.json` **[V]** |
| App version / build | `1.0.0` (`mobile/app.json`); iOS build number is EAS-remote-managed (`appVersionSource: remote`), currently **18**; next build will be **19** **[V]** |
| Last submission | Build **18** → App Store Connect via EAS Submit, commit `8e3f0ec`, status `finished` 2026-09-28 3:45 PM. "finished" = upload accepted; **Apple processing / TestFlight availability / any review state is [U]** |
| Builds 16, 17 | Never produced (numbers consumed by a failed attempt + a quota-blocked attempt). Build 15 (`f4bfbe24`, commit `8587505`, unconditional Stats redirect) was built but **deliberately never submitted** **[V]** |
| Public App Store review | No evidence of a submission; we were instructed not to submit. Current status **[U]** |
| Submitted vs local vs backend | Build 18 = HEAD = local code. Deployed Edge Functions are **byte-identical** to HEAD (I downloaded all three bundles and diffed). All 11 migrations applied remotely (`supabase migration list`: local == remote). **[V]** |
| Waiting for deploy / build | **Nothing.** No pending migrations, function changes, or code. |
| **Git backup risk** | `origin` had only `main` (`3021cde`, Jul 23 — see Errata above). The working branch has **no upstream and is 27 commits ahead of `origin/main`; nothing since August is on GitHub.** No tags exist. **[V]** Recommend the user approve a push + a tag at `8e3f0ec`. |

Deployed backend detail **[V]**: `signal` v16 (deployed 2026-09-27 22:50), `race-discovery` v8 (2026-09-28 07:47), `delete-account` v2 (2026-09-26 21:42). Supabase secret names present: `ANTHROPIC_API_KEY`, `REVENUECAT_PUBLIC_API_KEY`, `SPORTSTATS_DAILY_REQUEST_CAP` (+ Supabase-managed). **Not set:** `SIGNAL_MODEL`, `SIGNAL_FREE_MONTHLY_CAP`, `SIGNAL_PREMIUM_MONTHLY_CAP` → code defaults apply.

---

## 2. Structure & architecture

**Stack [V]:** Expo SDK `~54.0.37` (pinned to 54 on purpose for Expo Go; see `mobile/AGENTS.md`), React Native `0.81.5`, React `19.1.0`, expo-router `~6.0.24`, `@react-navigation/native ^7.1.8`, `@supabase/supabase-js ^2.112.4` (Edge Functions import 2.45.4 via esm.sh), `react-native-purchases` + `-ui ^10.10.2`, `expo-image-picker ~17`, TypeScript `~5.9`, Jest 29 + `jest-expo ~54` + `@testing-library/react-native ^14.0.1`. `expo-dev-client` installed. No analytics, crash reporting, React Query, or Redux. No `expo-updates`.

**Repo instructions [V]:** `mobile/AGENTS.md` (+ `mobile/CLAUDE.md` = `@AGENTS.md`): "Expo has changed; read SDK 54 docs; don't upgrade past 54 without checking Expo Go support." No root CLAUDE.md.

**Stale docs [V] — do not trust:** `mobile/README.md` (still "Milestone A mock-data shell"), `supabase/README.md` (only mentions migration 0001 + `race-discovery`), `B1_ARCHITECTURE.md` (historical; says Ask tab is nav-only, Google visible, etc.), `docs/legal/app-store-metadata.md` (draft; review notes say "magic link, no password").

**Where things live (`mobile/src/`):**
- Routes (expo-router): `app/_layout.tsx` (providers + `RootNavigator`: onboarding vs app phase), `app/(tabs)/{stats,index,ask}.tsx` (tab order Stats → Races → Signal; `index` = Races), `app/(tabs)/_layout.tsx` (header buttons, add-race sheet, cold-launch Stats redirect), `app/race/[id].tsx` (upcoming race + Race Prep), `app/race/add.tsx`, `app/results/[id].tsx` (completed result), `app/signal.tsx` (chat), `app/find-races.tsx`, `app/settings/index.tsx`, `app/auth-callback.tsx` (safety-net redirect), `app/+not-found.tsx`.
- Components: `src/components/` (shared UI), `components/onboarding/OnboardingFlow.tsx` (steps: identity → searching → candidates → save/emailForm → checkEmail → importing → summary), `FindMyRacesFlow.tsx`, `InitialPaywallGate.tsx`, `SignalConsentSheet.tsx`, `race/`, `races/`, `stats/`.
- Design tokens: `src/lib/brandTheme.ts` (light + dark palettes; `useBrandPalette()` follows system scheme; dark: canvas `#0B1218`, ink `#F2ECDF`, signalBlue `#7CA9CE`, medalGold `#D4AF6A`), `src/lib/theme.ts` (spacing, min touch size). **No custom fonts** — iOS system font (SF). Logo: `mobile/assets/brand/racesignal-mark-color.png`; icon `mobile/assets/images/icon.png`; exports in `brand/exports/`.
- Data access: `src/lib/db/{races,signal,paywall}.ts` (PostgREST under RLS), edge clients `lib/raceDiscovery.ts`, `lib/signal.ts`, `lib/deleteAccount.ts`; Supabase client `lib/supabaseClient.ts`.
- Backend: `supabase/functions/{race-discovery,signal,delete-account}/`, `supabase/migrations/0001…0011`, `supabase/config.toml` (`race-discovery` `verify_jwt=false` by design; `signal`, `delete-account` `verify_jwt=true`).

**State / persistence [V]:** React Context only: `AuthProvider`, `PurchasesIdentityBridge` (premium), `AppPhaseProvider` (classifies once at launch via `athlete_profiles.onboarding_completed_at`), `AthleteRacesProvider` (races fetched at login, merged in memory; **no offline cache**, refetched each launch), `RaceFilterProvider` (in-memory sport/year filters), `DevPreviewProvider` (dev-only; `__DEV__` && `EXPO_PUBLIC_ENABLE_DEV_PREVIEW`, not set in the EAS production env). AsyncStorage holds: Supabase session, onboarding draft, Find-My-Races retry draft, Signal consent (all athlete-id bound).

---

## 3. Auth & athlete data

**Sign-in [V]:** Supabase email **magic link** (`signInWithOtp`, `shouldCreateUser: true`, PKCE, redirect `racesignal://auth-callback`) is primary. **Email + password sign-in only** (never sign-up) is a secondary path added for Apple review; a dedicated reviewer account with synthetic races exists **[R]** (credentials delivered privately; none in repo). **Google is implemented but hidden**; **no Sign in with Apple**. Supabase Auth: only the `email` provider enabled, sign-ups open, email confirmation on. **Custom SMTP status [U]** — docs say the shared Supabase mailer was rate-limited and must be replaced before real launch.
- Session: AsyncStorage, auto-refresh. Deep links: custom scheme only (no universal links / associated domains). OnboardingFlow handles the initial/live URL; `auth-callback.tsx` only prevents a not-found flash.
- Known limitation: requesting a second magic link invalidates the first (single PKCE verifier slot); documented follow-up is threading `flowId` through `exchangeCodeForSession`.
- Post-login: password and magic-link paths both call `resumeReturningUser` (checks `onboarding_completed_at`, flips app phase). Cold launch with a session: phase classified once; Stats default is forced by an effect in `(tabs)/_layout.tsx` (see §7).

**Account deletion [V]:** Settings → Delete account → `delete-account` function → `auth.admin.deleteUser`. FK `on delete cascade` removes `athlete_profiles`, `races`, `signal_conversations/messages`, `signal_rate_limit`, `signal_free_usage`, `signal_usage_log`, `signal_request_dedup`. Client then clears local drafts + Signal consent and signs out. Confirmation copy already warns that this does not cancel an App Store subscription. **Not deleted:** the RevenueCat customer record (no RC delete call), Apple subscription, Anthropic's retained copy.

**Tables & access [V]:** `athlete_profiles` (id = auth uid, `racing_name`, `birth_year`, `onboarding_completed_at`, `initial_paywall_seen_at`), `races` (see below), `signal_conversations`, `signal_messages`. Owner-only RLS (select/insert/update; **no DELETE policy on `races`** — removal is a soft delete, `import_status='removed'`). Service-role-only (RLS on, no policies): `provider_config` (Sportstats kill switch), `discovery_rate_limit` (per-IP/day), `signal_rate_limit` (premium monthly), `signal_free_usage` (free lifetime), `signal_usage_log`, `signal_request_dedup`.

**Race data [V]:** Only provider: **Sportstats** via `race-discovery` (search + history unauthenticated; `detail` requires JWT). It calls three unofficial public Sportstats endpoints and **parses an embedded Next.js RSC JSON blob out of HTML** (`extractInitialResults`) — brittle if the page shape changes, and no formal provider agreement is documented **[U]**. Per-IP daily request cap (`SPORTSTATS_DAILY_REQUEST_CAP`, secret set; value [U], README says 300); kill switch via `provider_config`.
- Flow: racing name (whitespace-normalized) → identities → candidate history (can include future registrations that fail `detail` with `not_found`) → athlete selects → sequential detail fetch, one retry on network error, per-candidate classification (skip / retry-later / stop-batch on unauthorized, rate-limited, disabled, blocked) in `lib/raceImportBatch.ts` → `insertConfirmedRaces` (`lib/db/races.ts`).
- Dedup: unique partial index `(athlete_id, provider, provider_result_id)`; existing confirmed rows skipped; previously removed rows are **revived** in place with fresh data; 23505 tolerated. UI marks already-imported candidates.
- Manual entry: `provider='manual'` (null result id); upcoming races are manual-only; imported races read-only, manual races editable; Race Prep checklist labels are a client template (`lib/checklistTemplate.ts`), only completed ids persist (`checklist_completed`).
- Build 12 fixed triathlon split parsing (discipline transition detected via `ps` field presence) with live-payload fixtures (`normalize.test.ts`) **[V]**; a one-time repair of already-imported races was executed with a backup **[R]** (scripts `repair_preview.ts` / `repair_migrate.ts` remain in the function folder, not deployed — **do not rerun**).
- **Sharing:** every athlete's race rows are their own copy; there is no shared/global race table. After deletion + re-signup (same email → new UUID) the account is empty and onboarding restarts. **Consequence [V by schema]: the free Signal allowance resets to 3**, because `signal_free_usage` cascades with the account.

---

## 4. Signal

- **Model:** `claude-sonnet-5` (code default; no `SIGNAL_MODEL` secret) **[V]**. Direct Anthropic Messages API call from `supabase/functions/signal/index.ts`; `thinking: disabled`, `max_tokens 700`, 45 s model timeout, non-streaming, plain text.
- **Prompt:** `supabase/functions/signal/systemPrompt.ts` (tests: `systemPrompt.test.ts`).
- **What reaches the model:** client builds context (`mobile/src/lib/signalContext.ts`): seed race (full detail), same-sport races (full detail incl. splits/ranks/highlights + precomputed deltas vs seed), other-sport (compact), upcoming (compact), best-per-distance with percentiles. Server validates shape and verifies the seed race belongs to the caller; **everything else is client-trusted**. **Entire in-session chat history (text only) is resent every turn — no cap or summarization.** Conversations persist as text via RLS (`signal_conversations/messages`).
- **Screenshots:** `expo-image-picker`, quality 0.6, base64, one image per turn, jpeg/png/webp, 6,000,000 base64-char cap (client + server). Sent once, never stored by RaceSignal; the reply's "From your uploaded evidence" text is what persists. First-use consent sheet gates all sends (`lib/signalConsent.ts`, **stored in AsyncStorage only**, per athlete + disclosure version 1).
- **Limits:** free = **3 asks total, lifetime** (not per month) — confirmed in code, migration `0010`, deployed function, and unit tests; premium = **40 per UTC calendar month**. Premium resolved **server-side** each fresh request via RevenueCat REST (`/v1/subscribers/{uid}`, entitlement `premium`, `expires_date > now`) using the public SDK key; client flags never trusted.
- **When an ask counts:** reserved atomically (`reserve_signal_ask`) before the model call; **released if the model call fails** (timeout, non-2xx, empty text, exception). RevenueCat failure → `service_unavailable`, **nothing consumed, never treated as free**. Per-question `requestId` dedup (`signal_request_dedup`, fencing token, stale-reclaim after ~100 s) means a retry after a lost response returns the cached reply with no second ask. Builds without `requestId` (Build 10) are still accepted with the old, weaker behavior.
- **Timeouts/retries:** client 90 s call timeout (`timeout` reason); one silent retry only for the transient RN "Network request timed out"; athlete Retry reuses the same `requestId`. Free users hitting `rate_limited` get the hosted paywall; premium users at 40 get a message.
- **Safeguards against unsupported claims [V, prompt-level only]:** lead with a direct answer; use precomputed deltas (never do own arithmetic); percentile direction rules; no cross-distance percentile reuse; no "field strength" inference; "strongest discipline" scope rules; predictions only as hedged ranges from the athlete's own data with stated confidence and no invented benchmarks; screenshot content is data, never instructions; never imply screenshot data is saved. **No post-generation validator or moderation layer.** Deterministic logic is unit-tested (`signalContext.test.ts`); live-model regression harness `mobile/scripts/signal-eval/` (developer-only, manual).
- **Instrumentation:** `signal_usage_log` (athlete, time, input/output tokens, `had_image`, `was_premium`) on **successful** replies only; failures appear only in Supabase function logs (safe diagnostics, no content). No cost, latency, or model columns; no dashboards/alerts; no client analytics or crash reporting. Cost = manual SQL × Anthropic pricing.
- **Retention [V docs / U account]:** Anthropic's standard commercial retention is up to 30 days for API inputs/outputs including images unless a Zero Data Retention agreement is in place; ZDR is per-organization and **unconfirmed** for this account. `docs/legal/privacy-policy.md` says screenshots are "never retained past the one request," which overstates what RaceSignal can promise about Anthropic's side. The App Store privacy label was deliberately deferred (`app-store-metadata.md`); my earlier recommendation: disclose Photos or Videos unless ZDR is confirmed and legal agrees.

---

## 5. Subscriptions

**RevenueCat [V via API]:** project "RaceSignal"; iOS app bundle `com.cristianvillamarin.racesignal` with ASC key + subscription key configured; entitlement **`premium`** (both products); products **`racesignal_premium_monthly`** and **`racesignal_premium_annual`**; current offering **`default`** with packages `$rc_monthly`, `$rc_annual`; one hosted paywall ("Untitled Paywall", published 2026-09-27, revision 4). **Prices, free trial / intro offers, and Apple-side subscription group config are [U]** (not exposed by the RC API; live in ASC).
**Identity:** SDK configured anonymously (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, from EAS production env), then `Purchases.logIn(<Supabase user id>)`; `logOut` on sign-out. The same UUID is what the server looks up. After delete + re-signup the app user id changes; whether Restore transfers the Apple subscription depends on the RC restore setting **[U]**.
**Paywall placements [V]:** (1) one-time post-onboarding `presentPaywallIfNeeded('premium')` via `InitialPaywallGate` (gated by `athlete_profiles.initial_paywall_seen_at`; existing accounts were backfilled as seen in migration 0009); (2) Signal when a free athlete is `rate_limited`, then the blocked question is retried after a purchase/restore; (3) a free-tier upgrade affordance in the Signal screen; (4) Settings → Subscription upgrade row plus **Restore Purchases**. All present the same RC-hosted paywall; there is no custom paywall.
**Allowances:** Free = 3 asks **lifetime**. Premium = 40/month, window = first day of the current UTC month, reset implicit (new row, boundary 00:00 UTC on the 1st). Upgrading gives a fresh premium bucket immediately regardless of free asks used; lapsing returns the athlete to the free bucket where their lifetime count remains spent. A reserved question stays charged to the tier/month it started in. UI label: "Free plan · N of 3 Signal asks left" / "Premium · N of 40 Signal asks left" (server-provided numbers).
**Refresh/enforcement:** client `isPremium` from RC `CustomerInfo` (update listener + `refresh()` after purchase/restore); enforcement is server-side on every fresh ask. Races, Stats, Race Prep are free.

---

## 6. How we build and release

**Division of labor [R, from commit history and our sessions]:** The user (with ChatGPT/Codex as creative director) owns product, design, and acceptance. Claude Code implements, writes tests, traces root cause, builds, and submits. The user does **all physical-iPhone QA from TestFlight builds** and reports PASS/FAIL per Build N; Claude then traces and fixes. Rules we've followed: commit/build/deploy only on explicit instruction; one commit per TestFlight build ("Build N: …"); **no public App Store submission unless explicitly told**; never put secrets in the bundle/repo/chat; don't rerun the completed race-data repair; don't consume the reviewer account's Signal asks.

**Checks (run from `mobile/`) [V today: all pass]:**
```bash
npx tsc --noEmit
npx eslint src __tests__ --max-warnings=0
npx jest                      # 27 suites / 216 tests passing
npx expo-doctor               # 18/18 (last run 2026-09-28)
cd ../supabase/functions/signal && deno test --allow-read --no-check          # 32 pass
cd ../race-discovery && deno test --allow-read --no-check                      # 11 pass
```
Test conventions that keep Jest stable (RTL 14 is async): `await render(...)`, wrap every `fireEvent` and `unmount` in `await act(async …)`, keep real `import`s above the `jest.mock` calls (babel-jest hoists mocks; this also satisfies the `import/first` lint rule), and mock the Supabase client / AsyncStorage / `expo-linking`.

**Build profiles (`mobile/eas.json`) [V]:** `development` (dev client, simulator), `development-device` (dev client, internal, autoIncrement), `preview` (internal), `production` (store, autoIncrement). EAS plan is **Starter** (upgraded 2026-09-28 after the free quota blocked a build). Production-environment EAS vars (names): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_APPLE_ISSUER_ID`, `EXPO_APPLE_KEY_ID`, `EXPO_APPLE_PRIVATE_KEY`. Local `mobile/.env` is gitignored.
```bash
cd mobile
npx eas-cli build --platform ios --profile production --non-interactive --no-wait
npx eas-cli build:view <buildId>                 # poll until finished
npx eas-cli submit --platform ios --profile production --id <buildId> --non-interactive
npx eas-cli submit:view <submissionId>           # if submit outlives the shell timeout; don't resubmit on a transient CLI error
```
ASC App ID `6816325063` is in `eas.json`. Builds 13, 14, and 18 share one native fingerprint → recent releases were JS-only.

**Supabase [V + R]:** CLI is installed and linked. Migrations: `supabase db push`. Functions: `supabase functions deploy <name>`. Function deploys take effect for **every installed app version immediately**, so server changes must stay backward compatible (precedent: optional `requestId` for Build 10). Dev loop: `npx expo start` (dev client / Expo Go), plus physical TestFlight installs for device QA.

**OTA updates: not configured** — no `expo-updates`, no `runtimeVersion`, no `updates` block **[V]**. Every JS change needs a new TestFlight build; adding OTA later is itself a native change requiring a build.

**Recommended path for the next version (proposal, not yet done):**
1. User approves pushing the branch to `origin` (no remote backup today) and tagging `v1.0.0-build18` at `8e3f0ec` to preserve the submitted release.
2. Branch next work from `8e3f0ec` (e.g. `release-1.1`); bump `expo.version` for the next App Store version; build numbers continue remotely (next = 19).
3. Keep migrations additive; deploy functions only when compatible with the oldest build still live; avoid dropping columns/RPC signatures older clients use.
4. Per change: implement → tsc/eslint/jest/(deno) → commit → production build → TestFlight → user device QA with build number + commit → only then App Store submission, on explicit instruction.

---

## 7. Known issues & next-release work

**QA / test status**
- **Automated [V]:** all green at `8e3f0ec` (above).
- **Physical device [R]:** Build 14 (`15ebf5a`): PASS reviewer login → Stats, magic-link login with correct data, Upcoming card, Race Prep, filters, carousel; **FAIL: existing-session cold launch opened Races.** Builds 12 and 13 surfaced and fixed: splash icon clash, password sign-in not responding, post-login stall, missing Stats default, regressed next-race card. **No device result has been reported to me for Build 18 (`8e3f0ec`)**, which contains the cold-launch fix.

**Implemented + deployed + submitted, device-unverified**
- Cold-launch → Stats: `TabsNavigator` calls `router.replace('/stats')` once per mount **only** if `useSegments()` shows the group default (`(tabs)` or `(tabs)/index`); explicit tabs like `/ask` are preserved. Declarative `initialRouteName` / `unstable_settings` did not work for this conditionally-mounted navigator (device-confirmed Build 14). Known tradeoff: a deep link to bare `/` is indistinguishable from an ordinary launch.
- Test gap: only the isolated effect is covered (`__tests__/tabsDefaultRouteEffect.test.tsx`, 4 tests). A full-router test is blocked by an `expo-router@6.0.24` / `@testing-library/react-native@14.0.1` incompatibility (`renderRouter()` doesn't await the now-async `render()`).

**Open issues / constraints**
1. No remote backup of 27 commits (see §1).
2. Free Signal allowance resets after account deletion + re-signup (and across new emails) — product/abuse decision needed.
3. Privacy policy wording vs Anthropic retention; App Store privacy label unresolved; ZDR unconfirmed.
4. Custom SMTP for magic links unconfirmed; magic-link resend invalidates older email.
5. Sign in with Apple absent — only acceptable while no third-party login (Google) is shown (Guideline 4.8).
6. Sportstats single provider, unofficial scraping, brittle parser, per-IP caps, no agreement documented.
7. App Store metadata draft stale (review notes omit password path; store name placeholder "RaceSignal (4f141a)" status [U]); README/architecture docs stale.
8. Signal: unbounded history growth, client-trusted context, consent stored only on-device, no runtime fact-check layer, misleading env var name `SIGNAL_FREE_MONTHLY_CAP` (value 3, lifetime), thin cost/failure telemetry, no alerting.
9. RevenueCat customer record not deleted on account deletion.
10. Legal/support pages are public Notion pages (`lib/legalLinks.ts`); support email `racesignal@gmail.com`.

**Agreed / proposed for next version**
- Agreed [R]: keep Races/Stats/Race Prep free; Signal 3 lifetime free + Premium 40/month; hosted RC paywall only; no public App Store submission until instructed.
- Proposed, not decided: items 1–9 above.
- Separate workstream (not in the repo): Shipaton demo video. Storyboard approved with decisions (no Blummenfelt scene, minimal frame, SF Pro, no availability claim, no paywall footage); three stills + a 10 s motion sample delivered for review; full render awaits approval. Assets live in the Claude session scratchpad, not the repo.

---

## Missing information only the user can confirm
1. Did Build 18 finish Apple processing and appear in TestFlight? Which builds are installed on real testers' devices?
2. **Device QA of Build 18:** does a cold launch with an existing session now open Stats? Do deep links and the post-login path still behave?
3. Has anything been submitted for App Store review? Current ASC state (version record, screenshots, store name, privacy label, age rating, review notes, reviewer credentials still valid)?
4. Anthropic account: is Zero Data Retention active (Console → Settings → Privacy, or contract)? Should the privacy policy and App Store label say Photos or Videos are collected?
5. Is custom SMTP configured in Supabase Auth? Are the Supabase auth redirect URLs/allowlist correct for production?
6. App Store Connect pricing, free-trial/intro offers, and subscription group setup for the two products; RevenueCat "restore behavior" setting.
7. Decision on the free-allowance reset after delete/re-signup, and whether RevenueCat records should be deleted on account deletion.
8. Permission to push the branch to GitHub and tag `8e3f0ec`.
9. Whether Sportstats has any usage permission or whether we should plan a second/official provider.
10. Actual `SPORTSTATS_DAILY_REQUEST_CAP` value and whether the reviewer account's Signal allowance is still unspent.
