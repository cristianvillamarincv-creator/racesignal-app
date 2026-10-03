# RaceSignal (mobile)

Expo / React Native iOS app for endurance athletes: bring your race history together (Stats, Races, Race Prep) and ask **Signal**, an AI analyst grounded in your own results. Backed by Supabase (auth, Postgres, Edge Functions) and RevenueCat (Premium).

Current release: **1.0.0, build 18** (tag `v1.0.0-build18`, commit `8e3f0ec`), uploaded to App Store Connect on 2026-09-28. Apple processing / review status is **unconfirmed** here. Next-version work happens on `release-1.1`. See `../docs/development-workflow.md` for branches, testing, and release steps, and `../docs/handoffs/2026-10-02-technical-handoff.md` for a full technical snapshot.

## Stack

Expo SDK **54** (pinned deliberately; see `AGENTS.md`), React Native 0.81, React 19, expo-router 6, `@supabase/supabase-js`, `react-native-purchases` (+ `-ui`), `expo-image-picker`, TypeScript, Jest (`jest-expo`) + `@testing-library/react-native` 14. No analytics, crash reporting, or OTA updates (`expo-updates` is not installed).

## Setup

```bash
cd mobile
npm install
cp .env.example .env.development   # fill in the racesignal-dev values; never commit .env* files
```

There are two environments, chosen explicitly by `APP_VARIANT` (see `app.config.js`; unset means production). Full details: `../docs/development-environment.md`.

| | development | production |
|---|---|---|
| App / bundle ID / scheme | RaceSignal Dev / `com.cristianvillamarin.racesignal.dev` / `racesignal-dev` | RaceSignal / `com.cristianvillamarin.racesignal` / `racesignal` |
| Local env file | `.env.development` (used by `expo start`) | `.env.production` (used when `NODE_ENV=production`) |
| Cloud builds | EAS `development` environment (profiles `development`, `development-device`) | EAS `production` environment (profile `production`) |

Environment variables (names only; values are never stored in the repo):

| Variable | Used for |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (must match the variant; config refuses mismatches) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat public SDK key: `test_...` (Test Store) in development, `appl_...` in production |
| `EXPO_PUBLIC_ENABLE_DEV_PREVIEW` | Local-only Developer Preview switch (also requires `__DEV__`); not set in release builds |
| `APP_VARIANT` | `development` or `production`; set explicitly by every npm launch script and `eas.json` profile |

`.env*` files are gitignored except `.env.example`.

## Run

```bash
npm run start:go     # Expo Go + dev environment (JS-only features; password sign-in)
npm run start:dev    # dev client (RaceSignal Dev build) + dev environment
```

Do not use bare `expo start` for QA. Expo Go cannot test purchases or the magic-link return. No `RaceSignal Dev` build exists yet; creating one (`npx eas-cli build --platform ios --profile development-device`) is an explicit owner decision. Full steps: `../docs/development-workflow.md` §3.

## Project structure

- `src/app/`: expo-router routes. `(tabs)/` holds Stats (`stats.tsx`), Races (`index.tsx`), Signal landing (`ask.tsx`); plus `race/[id]`, `race/add`, `results/[id]`, `signal`, `find-races`, `settings`, `auth-callback`.
- `src/components/`: shared and domain UI; `onboarding/OnboardingFlow.tsx`, `FindMyRacesFlow.tsx`, `InitialPaywallGate.tsx`.
- `src/lib/`: design tokens (`brandTheme.ts`, `theme.ts`), auth (`auth.tsx`), premium (`premium.tsx`, `purchases.ts`), data access (`db/`), edge-function clients (`raceDiscovery.ts`, `signal.ts`, `deleteAccount.ts`), Signal context (`signalContext.ts`), import (`raceImportBatch.ts`, `raceMapping.ts`).
- `src/fixtures/`: sample data used by Developer Preview and tests.
- `__tests__/`: Jest tests. `scripts/signal-eval/`: developer-only live-model regression harness (not bundled).
- State is React Context only (no Redux/React Query). AsyncStorage holds the Supabase session and a few account-bound drafts; races are refetched at launch (no offline cache).

## Checks

```bash
npm run typecheck            # tsc --noEmit
npx eslint src __tests__ --max-warnings=0
npm test                     # jest: 35 suites / 301 tests on release-1.1
npx expo-doctor
```

## Builds (EAS)

`eas.json` profiles: `development` (simulator dev client), `development-device` (internal dev client), `preview` (internal), `production` (store; remote build numbers, auto-increment). Production builds and App Store submission are release-candidate steps run only on explicit instruction; see `../docs/development-workflow.md` §3.4.
