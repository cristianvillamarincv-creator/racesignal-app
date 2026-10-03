# Version 1.1 release configuration and checklist

Sign in with Apple, Sign in with Google, and the push-notification entitlement are **implemented and enabled for the development variant only**. Version 1.1 ships them through an explicit, ordered release step that nothing performs automatically. Nothing below has been done for production.

## The explicit release configuration

Three places must agree. If any one is missing, that feature stays off or the build refuses to build.

| Where | What | Today |
|---|---|---|
| `mobile/config/environments.json` -> `production.features` | `appleSignIn`, `googleSignIn`, `pushEntitlement` (booleans) | all `false` |
| `mobile/config/environments.json` -> `production.google` | `iosClientId`, `webClientId` (public identifiers) | `null` |
| Production dashboards and secrets | Supabase providers, manual linking, `APPLE_*` secrets, Apple and Google developer consoles | not touched |

`app.config.js` turns the flags into native configuration and runtime behavior: `appleSignIn` -> the Sign in with Apple entitlement and the Apple button; `googleSignIn` -> the Google plugin (URL scheme) and the Google button; `pushEntitlement` -> `expo-notifications` entitlement only. With a flag **off**, Expo's automatic plugin entitlements are stripped, so the production binary and App ID capabilities stay exactly as Build 18's. A production build with `googleSignIn` on but no Google client IDs **fails at config time** instead of shipping without it.

`cd mobile && npm run release:config` prints the production configuration as it will build (flags, entitlement/plugin presence, public Google IDs; no secrets). Run it before the release build and paste the output in the release notes.

## Order of operations

Backend first, additive only, then the app. Build 18 and earlier keep working at every step: nothing here changes an existing function's request/response contract except an optional extra field in `delete-account`'s success response (older builds ignore it and never send the new optional request field).

**0. Preconditions.** The consolidated development rebuild passed the iPhone checklist in `docs/social-sign-in.md` (including the real-address Google linking test and the Apple conflict/link tests), and the owner says "release 1.1 configuration go".

**1. Google Cloud (production iOS client).** In the same dedicated Google Cloud project: create an iOS OAuth client for `com.cristianvillamarin.racesignal`. Reuse the Web client (add `https://<production ref>.supabase.co/auth/v1/callback` as an authorized redirect URI). Move the consent screen's Audience to **In production** (basic scopes only; add the privacy-policy and terms links from `mobile/src/lib/legalLinks.ts`) and complete any branding verification Google asks for.

**2. Apple Developer.**
- App ID `com.cristianvillamarin.racesignal`: **Sign in with Apple** and **Push Notifications** capabilities. EAS enables both automatically when the production build includes the entitlements (the "Synced capabilities" step); you can also tick them in Identifiers first.
- A Sign in with Apple **key** whose primary (or grouped) App IDs include the production App ID: reuse the development key by adding the production App ID in its Configure screen, or create a second key. Needed only for account-deletion token revocation.
- APNs key: EAS creates or reuses one at build time (`eas credentials`); it is account-level, not per app.

**3. Supabase production (explicit owner instruction, one step at a time).**
- Authentication -> Providers: **Apple** enabled with client ID `com.cristianvillamarin.racesignal`; **Google** enabled with `<web client id>,<ios client id>` (web first) and its web client secret; **Skip nonce check stays off** (see `docs/social-sign-in.md`); **Enable manual linking** on.
- Secrets (silent prompts, nothing in chat): `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (production bundle ID), `APPLE_PRIVATE_KEY`.
- Deploy `delete-account` (and only it) with an explicit `--project-ref` for production; confirm `signal` and `race-discovery` versions and hashes are unchanged.
- Verify with the production auth settings read-back (`external_apple_enabled`, `external_google_enabled`, `security_manual_linking_enabled`) and a throwaway-account deletion smoke test.

**4. App configuration.** Set `production.features` to `true` for the features shipping, fill `production.google` with the production iOS and Web client IDs, run `npm run release:config` and confirm: Apple entitlement `true`, Google plugin `true`, push entitlement `true`, `runtimeAuthFlags` all on. Commit.

**5. App Store Connect and policy text** (owner decisions; this repository contains no published legal pages):
- App Privacy: email address is collected through Sign in with Apple / Google (linked to the user, used for authentication); review the label against `docs/legal/app-store-metadata.md`. Push tokens are not collected yet.
- Privacy Policy and Terms: mention Apple and Google sign-in; mention notifications only when the notification feature actually ships.
- App Review notes: keep the existing reviewer email+password path (unchanged); add that Apple and Google sign-in are available and that Sign in with Apple satisfies Guideline 4.8.

**6. Production build and verification** (explicit instruction to build/submit required):
- Production build; the "Synced capabilities" step should show Sign in with Apple and Push being added to the production App ID.
- TestFlight QA against the production backend with **throwaway accounts, never the reviewer account**: fresh Apple and Google sign-in, an existing magic-link account staying signed in after the update, Connected accounts (link, conflict), the Welcome-back review-or-skip flow, account deletion with Apple revocation, Signal and Premium unchanged, and the development app still separate.

**7. Notifications.** Version 1.1 ships the entitlement only. The notification feature itself (priority 4) still needs a permission prompt UX, token registration, server-side sending, and a privacy-label/policy update. Background (silent) notifications would additionally need `enableBackgroundRemoteNotifications` and therefore another build; it is not enabled.

## Rollback

Flip the three `production.features` flags to `false` and rebuild to remove the buttons and entitlements from the next build; disable the Apple and Google providers in Supabase production to stop provider sign-ins immediately. Accounts that already linked a provider keep their email sign-in (every account keeps at least one identity).

## Not done yet (as of this commit)

Every item above. Production Supabase, RevenueCat, the production App ID, and `environments.json` -> `production` are exactly as they were for Build 18.
