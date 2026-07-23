# RaceSignal (Milestone A — mock-data app shell)

Expo React Native app for RaceSignal. This milestone is a polished, navigable app shell backed
entirely by local mock data — no Supabase, no RevenueCat, no AI backend, no push notifications,
no real authentication. See `../RaceSignal_Claude_Code_Master_Build_File.md` for the full product
spec.

## Setup

```bash
cd mobile
npm install
```

## Run

```bash
npx expo start
```

Then press `i` to open in the iOS Simulator, or scan the QR code with the Expo Go app on a
physical iPhone.

## Project structure

- `src/app/` — Expo Router routes (file-based routing)
- `src/components/` — shared and domain UI components
- `src/fixtures/` — static mock data (populated + empty variants)
- `src/lib/` — theme tokens, formatting helpers, dev fixture mode switch

## Previewing empty states

Edit `src/lib/devFixtureMode.ts` and change `DEV_FIXTURE_MODE` to `'empty'` or `'error'`, then
reload the app. There is no in-app switcher for this yet — that's intentional for this milestone.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint .
npm test             # jest
npx expo-doctor      # Expo environment/config sanity check
```

## Building with EAS (not part of Milestone A)

`eas.json` has placeholder build profiles. Actually creating a build requires your own Expo
account: run `eas login`, then `eas build --profile development --platform ios`.
