# Sign in with Apple and Google

Implemented on `release-1.1` for **development services only**. Production Supabase, RevenueCat and App Store configuration were not changed, and the production variant has every provider switched off (see `release-1.1-checklist.md`).

## What the athlete sees

- **New athletes** (end of onboarding, "Sign in to save N races"): Apple, Google, and "Continue with email". Pending race selections are written to the onboarding draft *before* a provider sheet opens, exactly like the email path.
- **Returning athletes** ("Already have an account? Sign in"): the same provider buttons above the email form. Email link and email+password (the reviewer path) are unchanged.
- **Settings -> Connected accounts** (only when a provider is enabled in the build): shows email, and for Apple/Google either "Connected" or "Connect Apple/Google".
- Layout (one screen for both contexts, "Welcome back." for returning athletes, "Sign in to save N races." during onboarding): heading, "Keep your race history in one place.", Apple, Google, an "or use email" divider, a boxed "Email address" field, "Send sign-in link", and the existing password and Back links. Both provider buttons fill the content width, are 52pt high with a 26pt radius, 12pt apart; Apple's is its native button ("Continue with Apple"), Google's is a drawn button with the official multicolor G and "Continue with Google". Dark mode: white provider buttons; light mode: Apple black, Google white with an outline. A provider failure appears directly under that provider's button; email errors stay with the email form. A provider that is off for the build, or (Apple) missing from the installed binary, does not render.
- Screenshots of both contexts in dark and light: `docs/design/auth-screens/` (rendered from the real components in a browser; Apple's native button is a labeled stand-in there).

## Account rules (product decisions)

1. **Supabase's documented automatic linking, nothing custom.** If a provider sign-in carries a **verified** email equal to an existing account's email, Supabase attaches the provider to that account. Same Supabase user id, so races, Signal usage (`signal_free_usage`, monthly counters) and the RevenueCat identity (app user id = Supabase user id) all carry over. There is no merge code and no data migration anywhere.
2. **Different email, or Apple "Hide My Email"**: not matched automatically. Signing in with that provider creates a **new, empty** account. Existing athletes are told (one line under the buttons) to sign in with email first and connect the provider in Settings. That path preserves the account.
3. **Connecting never replaces the signed-in account.** Settings calls `linkIdentity({ provider, token, nonce })` (see below). If that Apple/Google account already belongs to a different RaceSignal account, Supabase answers `identity_already_exists`; the app shows a recoverable message ("nothing was changed on either account..."), and neither account nor the session is touched. A defensive check also restores the original session if the server ever answered with a different user id.
4. **Returning vs new**: from "Already have an account? Sign in" the athlete goes the returning-user way (Stats, or onboarding if that account never finished it). Otherwise the saved draft is resumed, and the app looks up `athlete_profiles.onboarding_completed_at` first (this applies to every sign-in method, magic link included):
   - **Account not completed** (a brand-new account): the normal onboarding import of the saved selections.
   - **Account already completed** (for example Supabase linked the provider to it by verified email) **and** the saved selections include races it does not have yet: nothing is discarded or imported. A "Welcome back." screen offers **Review selected races** or **Skip**. *Review* opens the normal race list with the selections kept and races the account already has marked "Already added" (the existing confirmed-`provider_result_id` deduplication, plus the existing duplicate check inside `insertConfirmedRaces`); nothing is added until the athlete taps "Add N races". That import only adds races: it **never upserts the profile** (racing name, birth year) and **never rewrites `onboarding_completed_at`**. *Skip* clears the draft and goes to Stats.
   - Account already completed and every selected race is already in it (or none were selected): straight to Stats, no question.
5. **Cancelling** the provider sheet is silent: same screen, no error, selections still in the draft.
6. The provider's profile name is never requested or stored (Apple: only the email scope). The racing name from discovery stays the only name source.

## Verified API facts

- **Manual linking with native ID tokens** (installed `@supabase/auth-js` 2.112.4, read from `GoTrueClient.js`): `supabase.auth.linkIdentity({ provider, token, nonce? })` is the supported call. With a `token` it POSTs `/auth/v1/token?grant_type=id_token` with `link_identity: true` and the **current session's JWT**, and returns `AuthTokenResponse`. It requires **Enable manual linking** on the project (`security_manual_linking_enabled`), which is now on for the dev project. Errors used: `identity_already_exists`, `manual_linking_disabled`.
- **Automatic linking has no off switch** (no setting in the dev project's auth config, and the docs list none); it applies to `signInWithIdToken` for verified emails.
- **Google: why the native ID-token flow was replaced (found on the first device test).** Apple worked; Google failed for new and existing accounts after Google's "You shared some Google Account data" email, so the Google sheet and consent succeeded. The Metro log showed the exact stage: `signInWithIdToken(google)` rejected with `Passed nonce and nonce in id_token should either both exist or not`. The ID token was extracted correctly (the library's response shape is `{ type: 'success', data: User }` and we read `response.data.idToken`; Supabase received a token and rejected it at the nonce check, with no audience error). Cause: since we sent no nonce, the token itself must have carried a `nonce` claim (GoogleSignIn-iOS 9 adds one); the free `@react-native-google-signin` library has no nonce parameter (a paid-version feature) and does not reveal the value; Supabase requires the request nonce and the token nonce to both exist (or both be absent) and hashes the supplied nonce with SHA-256 before comparing. There was no supported value to send. The options were (a) Supabase's **Skip nonce check** (what Supabase documents for this library; rejected: it removes replay protection and was to stay off), (b) the paid library, (c) custom native code, or (d) **Supabase's OAuth redirect flow**. We use (d): `signInWithOAuth` / `linkIdentity` with `skipBrowserRedirect`, an in-app browser sheet, and the PKCE `?code=` exchange magic links already use. No client-side token handling, so no nonce to get wrong; Skip nonce check stays **off**.
- **Effective Google configuration (verified against the dev project).** Supabase's OAuth start redirects to `accounts.google.com` with `client_id` = the Web client in `mobile/config/environments.json`, `redirect_uri` = `https://<dev ref>.supabase.co/auth/v1/callback` (an authorized redirect URI on that Web client), `response_type=code`, `scope=email profile`, and the app adds `prompt=select_account`. The app never sees a Google client ID. The Google iOS OAuth client and the native Google SDK are no longer used (the dependency was removed; the already-installed binary still contains the unused module, and the next native build drops it).
- **Metro or rebuild?** The Google fix is JavaScript only and loads through Metro: the OAuth sheet and the code exchange need nothing the installed development build lacks. Removing the unused Google package from `package.json` only matters for the next native build.
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

### 1. Google Cloud project and credentials (done for development)

A dedicated Google Cloud project `RaceSignal` with the Google Auth platform configured (External audience, Testing mode with your Google account as a test user, scopes `openid`, `email`, `profile`; privacy/terms links left blank because the Notion pages cannot be verified as an authorized domain) and **one Web application client** whose authorized redirect URI is `https://sjmixferxnkwbzkcofnp.supabase.co/auth/v1/callback`. Its client ID is in `mobile/config/environments.json` (`development.google.webClientId`, read only by `supabase/dev/configure-auth.py`); its secret was set on the dev Supabase project through the silent prompt (`python3 supabase/dev/configure-auth.py google`). **No iOS client is needed** now; the earlier iOS client and the older, unused Web client can be deleted in Google Cloud.

### 2. Sign in with Apple key (for account deletion only; sign-in itself needs nothing)

The key's primary App ID must already have the Sign in with Apple capability, so do this **after the consolidated rebuild** (EAS enables the capability on the dev App ID), or first tick it yourself under Identifiers -> `com.cristianvillamarin.racesignal.dev` -> Sign in with Apple. Then: Apple Developer -> Certificates, Identifiers & Profiles -> **Keys** -> **+** -> enable **Sign in with Apple** -> **Configure** (primary App ID `com.cristianvillamarin.racesignal.dev`) -> Register -> **Download the `.p8` once**; note the 10-character **Key ID**. Then `supabase/dev/set-dev-apple-key.sh` (prompts for the Key ID and the `.p8` path; sets `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY` on dev only). Keep the `.p8` out of the repo.

## The consolidated development rebuild (done; build 2)

The native changes were `expo-apple-authentication` + the Sign in with Apple entitlement, `expo-crypto`, and `expo-notifications` + the push entitlement (`aps-environment`). Everything else (the Google OAuth flow, buttons, flows, Settings, tests) loads through Metro. EAS will ask for your Apple login to enable the Sign in with Apple and Push Notifications capabilities on the dev App ID and to create an APNs key.

### Push notifications (prepared, inactive)

Only the config plugin entitlement is present. There is no permission request, no token registration, no background mode (`remote-notification` is not enabled), and no notification code. `app.config.js` adds the entitlement per variant from `config/environments.json` -> `features.pushEntitlement`.

## Why production's native config is unchanged

Expo auto-applies the config plugins of any installed package (`expo-apple-authentication` adds the Sign in with Apple entitlement, `expo-notifications` adds `aps-environment`), even when `app.json` never lists them. So the packages being installed would have changed the production binary and, at the next production build, the production App ID's capabilities. `app.config.js` therefore removes exactly those entitlements (and the Apple package's `CFBundleAllowMixedLocalizations` key) for any variant whose feature flag is off. Checked with `npx expo config --type introspect`: production has **no** entitlements and none of the new Info.plist keys; development has `com.apple.developer.applesignin` and `aps-environment: development`, and no `UIBackgroundModes`/`remote-notification`.

## Turning it on for production

A separate, explicit release step with its own ordered checklist: `docs/release-1.1-checklist.md` (release configuration flags, `npm run release:config`, Google/Apple/Supabase/App Store steps, verification, rollback). Production is off today and nothing in it has been done.

## Accepted for version 1.1: Google through browser OAuth (native Google sign-in deferred)

**Decision (owner, 2026-10-03):** version 1.1 ships Google sign-in through Supabase's browser OAuth flow. Native Google sign-in is **deferred**. "Skip nonce check" stays **off**. Apple stays native.

Why: the native Google ID-token flow failed on the first device test because the token carried a nonce that neither the free library nor the app could supply (see above), and Supabase requires the request and token nonces to agree. A native flow with the check left on needs a small patch to the Google library (GoogleSignIn-iOS 9 accepts a custom nonce, the free React Native wrapper does not expose it) and one native rebuild, or the paid library. Neither is part of 1.1.

What the athlete sees: a standard iOS confirmation, "RaceSignalDev wants to use sjmixferxnkwbzkcofnp.supabase.co to sign in" (the production app will name the production project's domain). That is iOS's normal prompt for any web sign-in session (`ASWebAuthenticationSession`); the native Google SDK uses the same session type and prompt, naming `google.com` instead. Consequences:
- Browser OAuth is the **only** Google flow, not a fallback.
- The domain is not masked. Supabase custom domains are a paid add-on and are not used.
- `preferEphemeralSession` would suppress the prompt but Google would no longer see the browser's existing sessions (password retyped every time, no autofill or passkeys), so it is not used.
- Revisit native Google sign-in after 1.1 if the prompt's domain matters more than the extra native work.

## Same-email accounts: what we found for cristian.villamarin.cv@gmail.com (2026-10-03, read-only)

`python3 supabase/dev/account-lookup.py <email>` (read-only SELECTs on development and production):

| | Production | Development |
|---|---|---|
| Accounts for the address | 1 (`fb879b81…`), created 2026-09-27, email only | 1 (`dcf2b0a9…`), created 2026-10-03 00:32 UTC, **email + google** |
| Onboarding / races / Signal free usage | completed 09-28 / 42 / 3 | completed 02:53:36 (after the Google sign-in) / 11 / none |

- **The production account (the magic-link history with 42 races) is a different project.** It was never in development, and nothing was copied.
- **In development there is exactly one account for the address, and Google attached to it (same user id).** Its email identity (00:32) and Google identity (02:52:42) are on the same user id. No duplicate account was created for that address.
- **Why it looked like a new account:** the development magic-link account was an **empty shell**: the athlete profile row did not exist until 02:53:16, after the Google sign-in. A magic link had created and confirmed the login at 00:32 but onboarding was never completed in development, so there were no races or profile to preserve, and the app correctly sent that account through onboarding (new athletes import their selections). It is not a routing bug and not an account-linking bug. A separate Google-only development account (`c1245172…`, `cristian.flipd@gmail.com`) was created at 02:52:15, 27 seconds before, by the first Google attempt with that other Google address.
- Routing now logs `onboardingCompleted=<bool> pendingSelections=<n>` at sign-in (booleans and counts only), so the next report shows which branch ran.

**Observed server-side test (development, synthetic account):** a user whose only identity is a Google identity with a verified email, then a magic-link sign-in for the same address: Supabase returned the **same user id**; races, profile, Signal usage and the RevenueCat customer were unchanged; no `email` identity row was added (identities stayed `['google']`). This is why `link-test.py verify --expect-new email` does not require an email identity.

### Real same-project runbook (development)

Accounts you can use: `cristian.villamarin.cv@gmail.com` now has both methods and data; `cristian.flipd@gmail.com` is Google-only.

**A. Magic link first, then Google (clean).** In the dev app: Settings -> Delete account on the `cv` account (your own dev account; nothing in production is affected). Sign in with a magic link to `cristian.villamarin.cv@gmail.com`, complete onboarding and import races. Then `python3 supabase/dev/account-lookup.py cristian.villamarin.cv@gmail.com` (note the dev user id and race count) and `python3 supabase/dev/link-test.py snapshot --email cristian.villamarin.cv@gmail.com`. Sign out, then "Already have an account? Sign in" -> **Continue with Google** with that exact address. Expect Stats with no onboarding. Then `python3 supabase/dev/link-test.py verify --email cristian.villamarin.cv@gmail.com --expect-new google` (expect all PASS) and run the lookup again (same user id, `email` + `google` identities, same race count).

**B. Google first, then magic link.** Use `cristian.flipd@gmail.com` (Google-only, 1 race) before deleting anything: `snapshot --email cristian.flipd@gmail.com`; sign out; "Already have an account?" -> email -> **Send sign-in link** to that address (a free Supabase project's default mailer only reaches Supabase organization members; if it reports "not authorized", add the address under the organization's members or skip B, since the server-side result above already shows the behavior). Tap the link on the phone. Then `verify --email cristian.flipd@gmail.com --expect-new email` (same user id and data; identities stay `['google']`).

**C. Already-linked returning login.** Any account with both methods: snapshot, sign out, sign in with the other method, `verify --expect-new none`. If authentication keeps the same id but onboarding starts again, send me the `[Onboarding] ... routing:` log lines and the lookup output.

## Verified-email Google linking test (real address, development only)

Goal: show that signing in with Google, with a real Google address you control that is already an **email-authenticated dev account**, attaches Google to that same account (same Supabase user id, races, Signal usage, profile, RevenueCat customer). Do **not** use `dev.athlete@example.com`, which is not a real Google address.

1. `python3 supabase/dev/link-test.py prepare --email you@gmail.com` (use the exact address the Google account signs in with, not a `+alias`). It registers that address in the **development** project as an email-authenticated, email-verified account (or fills in what is missing if you already registered through the app's magic link), with a profile, 3 synthetic races, Signal free usage 1 of 3, and the RevenueCat dev customer under the Supabase user id. Nothing is written to the repo.
   - A genuine in-app magic link works too, but a free Supabase project's default mailer only delivers to members of your Supabase organization, so the direct route is the dependable one.
2. `python3 supabase/dev/link-test.py snapshot --email you@gmail.com` records the "before" state in `~/.racesignal-dev/` (mode 600).
3. On the iPhone (after the rebuild): sign out -> "Already have an account? Sign in" -> **Continue with Google** -> choose that same Google account. Expect Stats with the 3 races.
4. `python3 supabase/dev/link-test.py verify --email you@gmail.com` must print PASS for: same Supabase user id; a Google identity now attached; email identity still attached; same races (count and ids); profile untouched; Signal free usage unchanged; the RevenueCat customer is the Supabase user id and unchanged. (Without a real Google sign-in, only "a google identity is now attached" fails; that is the control.)

## iPhone test checklist (after the consolidated rebuild)

1. **Fresh account**: onboarding -> select races -> **Continue with Apple** -> lands in the app with the races imported. Repeat with Google on a second fresh dev account.
2. **Verified-email Google linking**: the section above, with your real Google address (Google now opens a browser sheet with an account chooser, then returns to the app).
3. **Apple identity already attached to a separate account must conflict.** Sign in with Apple (Hide My Email is fine) on a fresh install: this creates account B and attaches that Apple identity to it. Now, signed in as a *different* account A, **Settings -> Connected accounts -> Connect Apple** with that same Apple ID: expect the conflict message ("already connected to a different RaceSignal account... nothing was changed on either account"), and both A and B still sign in as before. Same check for Google.
4. **Successful Apple linking needs an Apple identity that is unused on dev**: an Apple ID that has never signed in to RaceSignal Dev, or one whose dev account you first deleted (Settings -> Delete account removes the user and its identities, which frees the identity). Then sign in as account A by email, **Settings -> Connect Apple** -> succeeds, A keeps its user id and data, and Settings shows Apple as Connected.
5. **Existing completed account with pending selections**: on the account from step 2 (or any completed account), start a fresh onboarding, select races, sign in with Google/Apple/email. Expect "Welcome back." with **Review selected races** and **Skip**; Review shows the selections with already-added races marked; adding imports only new races, and the racing name and birth year in the profile do not change; Skip goes to Stats and the draft is gone.
6. **Cancel** each provider sheet (sign-in and connect): no error, same screen. Kill the app mid-flow and relaunch: pending selections restored.
7. Email magic link and email+password still work.
8. Delete a throwaway Apple account: Apple sheet appears; cancel it -> "Delete anyway / Keep my account"; accept -> deleted, note shown if revocation was not confirmed.
9. Signal still works; the paywall and Premium state are unchanged; the TestFlight app is still installed separately.
