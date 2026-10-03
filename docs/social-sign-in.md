# Sign in with Apple and Google

Implemented on `release-1.1` for **development services only**. Production Supabase, RevenueCat and App Store configuration were not changed, and the production variant has every provider switched off (see "Turning it on for production").

## What the athlete sees

- **New athletes** (end of onboarding, "Sign in to save N races"): Apple, Google, and "Continue with email". Pending race selections are written to the onboarding draft *before* a provider sheet opens, exactly like the email path.
- **Returning athletes** ("Already have an account? Sign in"): the same provider buttons above the email form. Email link and email+password (the reviewer path) are unchanged.
- **Settings -> Connected accounts** (only when a provider is enabled in the build): shows email, and for Apple/Google either "Connected" or "Connect Apple/Google".
- Buttons are the providers' own native buttons (Apple `AppleAuthenticationButton`, Google `GoogleSigninButton`), same height, full width, so neither is more prominent. A provider that is off for the build, or whose native module is not in the installed binary, simply does not render.

## Account rules (product decisions)

1. **Supabase's documented automatic linking, nothing custom.** If a provider sign-in carries a **verified** email equal to an existing account's email, Supabase attaches the provider to that account. Same Supabase user id, so races, Signal usage (`signal_free_usage`, monthly counters) and the RevenueCat identity (app user id = Supabase user id) all carry over. There is no merge code and no data migration anywhere.
2. **Different email, or Apple "Hide My Email"**: not matched automatically. Signing in with that provider creates a **new, empty** account. Existing athletes are told (one line under the buttons) to sign in with email first and connect the provider in Settings. That path preserves the account.
3. **Connecting never replaces the signed-in account.** Settings calls `linkIdentity({ provider, token, nonce })` (see below). If that Apple/Google account already belongs to a different RaceSignal account, Supabase answers `identity_already_exists`; the app shows a recoverable message ("nothing was changed on either account..."), and neither account nor the session is touched. A defensive check also restores the original session if the server ever answered with a different user id.
4. **Returning vs new**: after any provider sign-in the app looks up `athlete_profiles.onboarding_completed_at`. Completed -> straight to Stats (the saved draft is discarded rather than imported over an existing profile). Not completed -> normal onboarding (new athletes import their saved selections). From "Already have an account? Sign in" the returning path is always used.
5. **Cancelling** the provider sheet is silent: same screen, no error, selections still in the draft.
6. The provider's profile name is never requested or stored (Apple: only the email scope). The racing name from discovery stays the only name source.

## Verified API facts

- **Manual linking with native ID tokens** (installed `@supabase/auth-js` 2.112.4, read from `GoTrueClient.js`): `supabase.auth.linkIdentity({ provider, token, nonce? })` is the supported call. With a `token` it POSTs `/auth/v1/token?grant_type=id_token` with `link_identity: true` and the **current session's JWT**, and returns `AuthTokenResponse`. It requires **Enable manual linking** on the project (`security_manual_linking_enabled`), which is now on for the dev project. Errors used: `identity_already_exists`, `manual_linking_disabled`.
- **Automatic linking has no off switch** (no setting in the dev project's auth config, and the docs list none); it applies to `signInWithIdToken` for verified emails.
- **Google nonce**: Supabase checks nonce only if the ID token has one; its rule (`token_oidc.go`) is "the nonce in the request and in the token must **both exist or both be absent**" (mismatch is an error). The free `@react-native-google-signin/google-signin` (16.1.5, GoogleSignIn-iOS 9) has **no nonce parameter on iOS** (that is a paid-version feature; `SignInParams` only has `loginHint`), so its tokens carry no nonce claim and we send none. That passes **without** enabling "Skip nonce check", which stays **off**. If a future SDK adds a nonce claim by itself, Supabase rejects the token with "should either both exist or not" (a normal sign-in error), and we would then either license the paid library or revisit; we would not silently skip the check.
- **Apple nonce**: the app gives Apple the SHA-256 (hex) of a random raw nonce and gives Supabase the raw nonce (`lib/nonce.ts`, `expo-crypto`).

## Account deletion and Apple token revocation

Apple requires revoking the athlete's Sign in with Apple tokens when the account is deleted. Behavior (`lib/accountDeletion.ts`, `delete-account` function):

- If the account has an Apple identity, Settings asks Apple for a fresh single-use **authorization code** (Apple's sheet) and sends it to `delete-account`.
- The function exchanges the code for a refresh token (`appleid.apple.com/auth/token`) and revokes it (`/auth/revoke`), signing a short-lived ES256 client secret with the Sign in with Apple key. It is bounded (6 s per call) and **can never block deletion**: any failure returns `appleRevocation: 'failed'` and the account is deleted regardless; with no code or no secrets configured it returns `'not_attempted'`.
- Successful Apple reauthentication is **not required**: Apple unavailable, an error, or a different Apple ID on the phone -> deletion proceeds without revocation. If the athlete **cancels** Apple's sheet, they get one extra choice, "Delete anyway" or "Keep my account"; it is never a hard stop.
- Whenever an Apple account was involved and revocation was not confirmed, the athlete gets a note after deletion with the exact iOS path to remove RaceSignal from Sign in with Apple.
- Tested: 8 Deno tests (JWT shape/signature, exchange+revoke, rejected code, failing revoke, timeout, malformed key) plus a live dev check that a failing revocation still deletes the user (`appleRevocation: "failed"`). A real revocation needs the Apple key (private step below) and a device.

## Development services configured (dev project only)

- Apple provider enabled with the dev bundle ID as the only client ID (native flow needs no Services ID or rotating secret). **Manual linking enabled.** Google not yet enabled (needs your credentials).
- `delete-account` redeployed to dev with the revocation code. No `APPLE_*` secrets set yet.
- Helpers (all dev-only, explicit target): `supabase/dev/configure-auth.py status|apple|google`, `supabase/dev/set-dev-apple-key.sh`, `supabase/dev/dev-supabase.sh deploy delete-account`.

## Private setup you still need to do

### 1. Google Cloud project and credentials (dedicated project)

1. [console.cloud.google.com](https://console.cloud.google.com) -> project picker -> **New project** -> name `RaceSignal` (a dedicated project; the account that owns it matters, use one you will keep).
2. Menu -> **Google Auth platform** -> **Get started** (or **Branding**): App name `RaceSignal`, user support email `racesignal@gmail.com`; **Audience: External**; contact email; agree. Under **Branding** add the privacy-policy and terms links from `mobile/src/lib/legalLinks.ts`. Under **Data access** add exactly the scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (basic sign-in scopes, no sensitive scopes).
3. **Audience**: while the app is in *Testing*, only listed test users can sign in. Add your own Google account as a test user for now; **publish to production before real users** (basic scopes need no verification review, but Google may ask to verify branding/domains).
4. Menu -> **Clients** -> **Create client**:
   - Type **iOS**, name `RaceSignal Dev iOS`, **Bundle ID `com.cristianvillamarin.racesignal.dev`**. Copy the **client ID** (ends `.apps.googleusercontent.com`). (For production later, a second iOS client with `com.cristianvillamarin.racesignal`.)
   - Type **Web application**, name `RaceSignal Supabase`, **Authorized redirect URI** `https://sjmixferxnkwbzkcofnp.supabase.co/auth/v1/callback`. Copy the **client ID** and the **client secret** (the secret is the only private value: do not paste it anywhere except the prompt below).
5. Put the two **client IDs** (public identifiers, not secrets) into `mobile/config/environments.json` under `development.google` (`iosClientId`, `webClientId`), tell Claude, and I will commit them. Then run, in your own terminal, from the repo root:
   `python3 supabase/dev/configure-auth.py google` -> paste the **web client secret** at the hidden prompt. It enables Google on the dev project (web ID first, then iOS ID), leaves "Skip nonce check" off, and prints the resulting settings (never the secret).

### 2. Sign in with Apple key (for account deletion only; sign-in itself needs nothing)

The key's primary App ID must already have the Sign in with Apple capability, so do this **after the consolidated rebuild** (EAS enables the capability on the dev App ID), or first tick it yourself under Identifiers -> `com.cristianvillamarin.racesignal.dev` -> Sign in with Apple. Then: Apple Developer -> Certificates, Identifiers & Profiles -> **Keys** -> **+** -> enable **Sign in with Apple** -> **Configure** (primary App ID `com.cristianvillamarin.racesignal.dev`) -> Register -> **Download the `.p8` once**; note the 10-character **Key ID**. Then `supabase/dev/set-dev-apple-key.sh` (prompts for the Key ID and the `.p8` path; sets `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY` on dev only). Keep the `.p8` out of the repo.

## The consolidated development rebuild (do not run until the steps above are done)

Native changes that need one new development build: `expo-apple-authentication` + the Sign in with Apple entitlement, `@react-native-google-signin/google-signin` + the Google URL scheme in Info.plist (only included once both Google client IDs are in `environments.json`; **fill them in before building**), `expo-crypto`, and `expo-notifications` + the push entitlement (`aps-environment`). Everything else (buttons, flows, Settings, tests) loads through Metro. EAS will ask for your Apple login to enable the Sign in with Apple and Push Notifications capabilities on the dev App ID and to create an APNs key.

### Push notifications (prepared, inactive)

Only the config plugin entitlement is present. There is no permission request, no token registration, no background mode (`remote-notification` is not enabled), and no notification code. `app.config.js` adds the entitlement per variant from `config/environments.json` -> `features.pushEntitlement`.

## Why production's native config is unchanged

Expo auto-applies the config plugins of any installed package (`expo-apple-authentication` adds the Sign in with Apple entitlement, `expo-notifications` adds `aps-environment`), even when `app.json` never lists them. So the packages being installed would have changed the production binary and, at the next production build, the production App ID's capabilities. `app.config.js` therefore removes exactly those entitlements (and the Apple package's `CFBundleAllowMixedLocalizations` key) for any variant whose feature flag is off. Checked with `npx expo config --type introspect`: production has **no** entitlements and none of the new Info.plist keys; development has `com.apple.developer.applesignin` and `aps-environment: development`, and no `UIBackgroundModes`/`remote-notification`.

## Turning it on for production (a later, explicit release step)

Production is off today (`environments.json` -> `production.features` all `false`, no production Google IDs), so the production config and Build 18's capabilities are unchanged. To ship: enable Apple and Google providers on the production Supabase project (production bundle ID as the Apple client ID; production web+iOS Google client IDs), enable manual linking there, set `APPLE_*` secrets and deploy `delete-account` there, create the production Google iOS client, fill `production.google`, flip `production.features`, and let EAS enable the capabilities on the production App ID in that production build. None of this has been done.

## iPhone test checklist (after the consolidated rebuild)

1. Fresh install: onboarding -> select races -> **Continue with Apple** -> lands in the app with the races imported. Repeat with Google on a second dev account.
2. Existing dev email account (`dev.athlete@example.com`): sign out -> "Already have an account? Sign in" -> **Google with the same verified email** -> same account (same races, same Signal count; Settings shows Google connected).
3. Apple with **Hide My Email**: creates a separate new account; then sign in with email on the original, **Settings -> Connected accounts -> Connect Apple** -> succeeds and keeps the account. Try connecting an Apple/Google already used by another account -> conflict message; both accounts still sign in.
4. Cancel each provider sheet (sign-in and connect): no error, same screen. Kill the app mid-flow and relaunch: pending selections restored.
5. Email magic link and email+password still work.
6. Delete a throwaway Apple account: Apple sheet appears; cancel it -> "Delete anyway / Keep my account"; accept -> deleted, note shown if revocation was not confirmed.
7. Signal still works; the paywall and Premium state are unchanged; the TestFlight app is still installed separately.
