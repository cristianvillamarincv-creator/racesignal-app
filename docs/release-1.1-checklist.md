# Version 1.1 release configuration and checklist

**Scope decision (2026-10-07): Sign in with Apple and Google stay in 1.1.** They are not to be switched off to shorten the release. Sign in with Apple, Sign in with Google, and the push-notification entitlement are **implemented and enabled for the development variant only**. Version 1.1 ships Apple and Google sign-in through an explicit, ordered release step that nothing performs automatically (the push entitlement is not shipped: notifications are local only). The private steps and the exact setup are in `docs/production-setup-1.1.md`. Nothing below has been done for production.

## The explicit release configuration

Three places must agree. If any one is missing, that feature stays off or the build refuses to build.

| Where | What | Today |
|---|---|---|
| `mobile/config/environments.json` -> `production.features` | `appleSignIn`, `googleSignIn`, `pushEntitlement` (booleans) | all `false` |
| `mobile/config/environments.json` -> `production.google.webClientId` | the Google Web client ID, read only by the Supabase provider script | `null` |
| Production dashboards and secrets | Supabase providers, manual linking, `APPLE_*` secrets, Apple and Google developer consoles | not touched |

`app.config.js` turns the flags into native configuration and runtime behavior: `appleSignIn` -> the Sign in with Apple entitlement and the Apple button; `googleSignIn` -> the Google button (Google needs no native module or client ID in the app: it uses Supabase's OAuth redirect flow); `pushEntitlement` -> `expo-notifications` entitlement only. With a flag **off**, Expo's automatic plugin entitlements are stripped, so the production binary and App ID capabilities stay exactly as Build 18's.

`cd mobile && npm run release:config` prints the production configuration as it will build (flags, entitlement/plugin presence, public Google IDs; no secrets). Run it before the release build and paste the output in the release notes.

## Order of operations

Backend first, additive only, then the app. Build 18 and earlier keep working at every step: nothing here changes an existing function's request/response contract except optional extra fields in `delete-account`'s success response (older builds ignore them and never send the new optional request field). **Correction 2026-10-10: that is a compatibility statement, not a "no behavior change" statement.** Build 18 calls `delete-account`, so deploying it also makes Build 18 account deletions ask RevenueCat to delete the customer and record the request (see `docs/production-change-plan-1.1.md` step 4); that needs an explicit owner decision like `signal`.

**0. Preconditions.** The consolidated development rebuild passed the iPhone checklist in `docs/social-sign-in.md` (including the real-address Google linking test and the Apple conflict/link tests), and the owner says "release 1.1 configuration go".

**1. Google Cloud (browser OAuth is the accepted 1.1 approach; native Google sign-in is deferred).** In the same dedicated Google Cloud project, reuse the one Web client and add `https://<production ref>.supabase.co/auth/v1/callback` as a second authorized redirect URI. No iOS client is needed (Google sign-in uses Supabase's OAuth redirect flow, not the native SDK). Move the consent screen's Audience to **In production** (**Publish app**). With only the basic scopes (`openid`, `email`, `profile`), Google's docs say published apps need no test-user list, show no warning, and do not expire authorizations after 7 days (in Testing, only listed test users can sign in and authorization expires after 7 days).

**Open decision: branding verification.** Showing the app name/logo on Google's consent screen needs brand verification, which requires a domain you own and verify in Google Search Console with the privacy policy hosted on it. The Notion pages (`*.notion.site`) cannot be verified, so Google rejects them as the privacy-policy link (the Branding page reports "Missing domain"). Options: (a) accept the unbranded consent screen (users see only the application domain) and leave the links blank; (b) host the privacy policy and terms on a domain you own, add it under Authorized domains, and submit brand verification. It is **unconfirmed** whether Google requires a privacy-policy link just to publish a basic-scope app; check the Publish app screen. Decide before this step. With the native iOS sign-in, the consent UI is Google's system sheet, so (a) is the lighter path.

**2. Apple Developer.**
- App ID `com.cristianvillamarin.racesignal`: the **Sign in with Apple** capability. EAS enables it automatically when the production build includes the entitlement (the "Synced capabilities" step); you can also tick it in Identifiers first. **Do not enable Push Notifications:** 1.1's notifications are local only.
- A Sign in with Apple **key** whose primary (or grouped) App IDs include the production App ID: reuse the development key by adding the production App ID in its Configure screen, or create a second key. Needed only for account-deletion token revocation.
- No APNs key is needed (no push).

**3. Supabase production (explicit owner instruction, one step at a time).**
- Authentication -> Providers: **Apple** enabled with client ID `com.cristianvillamarin.racesignal`; **Google** enabled with the Web client ID and its client secret; **Skip nonce check stays off** (see `docs/social-sign-in.md`); **Enable manual linking** on.
- Secrets (silent prompts, nothing in chat): `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (production bundle ID), `APPLE_PRIVATE_KEY`.
- Deploy `delete-account` (and only it) with an explicit `--project-ref` for production; confirm `signal` and `race-discovery` versions and hashes are unchanged.
- Verify with the production auth settings read-back (`external_apple_enabled`, `external_google_enabled`, `security_manual_linking_enabled`) and a throwaway-account deletion smoke test.

**4. App configuration.** Set `production.features.appleSignIn` and `googleSignIn` to `true` (both ship together: Guideline 4.8), fill `production.google.webClientId`, run `npm run release:config` and confirm: Apple entitlement `true`, `pushEntitlementPlugin` **`false`** (notifications are local only), `runtimeAuthFlags` (apple, google) both on. Set `appleSignIn` and `googleSignIn` to `true` and leave `pushEntitlement` `false`. Commit.

**5. App Store Connect and policy text** (owner decisions; this repository contains no published legal pages):
- App Privacy: email address is collected through Sign in with Apple / Google (linked to the user, used for authentication); review the label against `docs/legal/app-store-metadata.md`. Push tokens are not collected yet.
- Privacy Policy and Terms: mention Apple and Google sign-in; mention notifications only when the notification feature actually ships.
- App Review notes: keep the existing reviewer email+password path (unchanged); add that Apple and Google sign-in are available and that Sign in with Apple satisfies Guideline 4.8.

**6. Production build and verification** (explicit instruction to build/submit required):
- Production build; the "Synced capabilities" step should show Sign in with Apple and Push being added to the production App ID.
- TestFlight QA against the production backend with **throwaway accounts, never the reviewer account**: fresh Apple and Google sign-in, an existing magic-link account staying signed in after the update, Connected accounts (link, conflict), the Welcome-back review-or-skip flow, account deletion with Apple revocation, Signal and Premium unchanged, and the development app still separate.

**7. Notifications (see also the production binary section below).** Version 1.1's notifications are **local only** (race-prep and between-race reminders scheduled on the device; see `docs/notifications.md`). There is no push token registration, no server-side sending and no silent notifications, so `enableBackgroundRemoteNotifications` stays off and no new server component is needed. The `pushEntitlement` flag still controls the `expo-notifications` entitlement. Before release: update the privacy policy and App Privacy answers to mention local notifications, and finish the pending notification device QA listed in `docs/release-1.1-qa-status.md`.

**8. Race prediction and the production `signal` deployment.** The `signal` function must be deployed to production **before** the 1.1 app reaches anyone, and only after the compatibility check and rollback procedure below. Not deployed to production; development only so far.

## Production `signal` deployment: Build 18 compatibility and rollback

**Compatibility with Build 18 (verified by diff on 2026-10-07; nothing deployed).** Compared `supabase/functions/signal` at tag `v1.0.0-build18` (`8e3f0ec`) with the current code:
- **Request and response contract: unchanged.** Same required fields (`context`, `history`, `message`, optional `image`, optional `requestId`), same validation, same reply payload (`reply`, `remaining`, `cap`, `isPremium`), same unavailable reasons. The type changes are optional fields only.
- **Additive only:** a read-only `{ action: 'usage' }` that Build 18 never sends, and one extra read of the caller's own races per ask (same service-role client the seed-race check already uses; no new secret or environment variable).
- **No database migration:** production and development both have migrations 0001 to 0011.
- **What does change for Build 18 users the moment it deploys:** answers. The prompt was rewritten since Build 18 (analyst voice, shorter replies, no invented provisional range or stated confidence, conservative finish-time ranges from a server-derived basis). Build 18's old loose "What does my history suggest..." suggestion still shows and is answered by the new rules. No UI change is needed in Build 18; replies render as plain text.
- **Production state verified:** the deployed production `signal` (v16) source is byte-identical to tag `v1.0.0-build18` for `index.ts`, `usage.ts` and `systemPrompt.ts` (downloaded read-only 2026-10-07). The tag is on GitHub (`750c322`).
- **Not verified:** no Build-18-shaped request has been run against the new function. `index.ts` has no unit harness, and a real call needs a signed-in session. The check that closes this gap is the post-deploy test below, run from a Build 18 install.

**Before deploying:**
1. Rotate the exposed Supabase CLI token and `supabase login` again.
2. Record the current production version and hash: `supabase functions list --project-ref <production ref>` (identify by hash: sha256 `cea75ad1d54539788adccafc4aafab8bda956652b1acf13dd55bab8e30acec92`; it was v16 and became v17 on 2026-10-09 when Apple secrets were set, with no code change).
3. Confirm tag `v1.0.0-build18` exists locally and on `origin` (`git ls-remote --tags origin`).
4. Run the checks (`deno test --allow-read=. supabase/functions/signal/`).

**Deploy:** explicit instruction only, always with `--project-ref <production ref>` (never a bare command; this repo's link points at production), from `supabase/` with only `signal` named.

**Right after deploying (Build 18 compatibility test):** from a Build 18 install signed in to a throwaway or test production account, send one Signal question. Expect a normal reply, the allowance down by exactly one, and no error screen. Check the function logs for errors. Also confirm the Premium state and a free-limit paywall still behave.

**Roll back if** a Build 18 request fails (an error reply instead of an answer), the allowance counts wrongly, errors appear in the logs, or the answers are unacceptable.

**Rollback procedure (about two minutes; no database change is involved):**
1. `git worktree add ../rs-rollback v1.0.0-build18`
2. `cd ../rs-rollback && supabase functions deploy signal --project-ref <production ref>` (the worktree's `supabase/functions/signal` is the Build 18 code and has no prediction files).
3. `supabase functions list --project-ref <production ref>`: a new version number is expected (versions only increase; the hash may differ from v16 because of bundling).
4. Prove it is the Build 18 code: `supabase functions download signal --project-ref <production ref> --use-api` into a scratch directory and `diff` `index.ts`, `usage.ts` and `systemPrompt.ts` against the worktree (expect no differences).
5. Repeat the Build 18 test question. `git worktree remove ../rs-rollback`.
6. No data cleanup is needed: counters, conversations and the request log use the same schema before and after. Any 1.1 app already in testers' hands would again get the old invented ranges from the old server, so roll the app back or hold it until the server is redeployed.

## Local notifications in the production binary

The development build does not prove production behavior: the production variant is built **without** the `expo-notifications` config plugin (`pushEntitlement` is false, so `release:config` shows `pushEntitlementPlugin: false`). What was checked on 2026-10-07 (read-only):
- The plugin only adds the `aps-environment` push entitlement, notification sounds (none configured) and an optional `remote-notification` background mode. Nothing local notifications need.
- The native module (`EXNotifications`, including its app-delegate subscriber that routes taps) is autolinked from `package.json` whether or not the plugin runs (`expo-modules-autolinking` lists it).
- The permission request is a plain `UNUserNotificationCenter` authorization request; only the push-token module registers for remote notifications, and the app never requests a push token.
- EAS production environment holds the production Supabase URL and a production RevenueCat key (`appl_` prefix).

So no extra capability, entitlement or key is needed for local notifications, and the push capability should stay off. This is static evidence. **It is confirmed only by the TestFlight checks below.**

## Tracked before submission: account deletion and the RevenueCat customer record

Found 2026-10-08 when a development account was deleted from the app: the auth user, profile, races, Signal data and Apple identity were all removed, but the account's **RevenueCat customer record still exists** (in the development project; production behaves the same because `delete-account` does not touch RevenueCat). It holds the app user ID (the Supabase user ID), first/last-seen timestamps, device and country metadata, and any purchase history. **Unresolved.** Before App Store submission we must confirm exactly what RevenueCat keeps after an account is deleted (the app user ID and its metadata, purchase and subscription history, any attributes, and how long RevenueCat retains it) and then decide how deletion handles it: for example, delete the customer through RevenueCat's API as part of account deletion, or keep it with a documented, justified retention. **A privacy-policy statement alone does not close this review**; the policy must match whatever we actually do. An active App Store subscription is not cancelled by deleting the account (the deletion alert already says so). Not implemented; no production change. **Verified facts and a concrete plan (secret key, `delete-account` change, tests, development rollout, backfill of existing orphans, replacement Privacy wording) are in `docs/revenuecat-deletion-plan.md` (2026-10-09); **Implemented and verified on the development project on 2026-10-10 (section 8 of that plan); production not changed; the sweep still needs a production schedule and a phone test before the privacy sentence can go live.**

## Verification required before release

The development checks use the dev build, Test Store and dev accounts. The TestFlight checks use the production binary, the production backend and throwaway accounts (never the reviewer account). Existing evidence is reused, not redone.

| Area | Existing evidence | Development check (before building) | TestFlight check (on the binary) |
|---|---|---|---|
| **Restore Purchases** | Automated: restore result alerts (restored and nothing to restore) on the Subscription screen; premium-awareness flow tests. Device: a Test Store purchase from the exhausted Send resumed one question (passed). Restore itself on device: not yet. | From Settings → Plan → Subscription → Restore Purchases: with an active Test Store subscription expect "Purchases restored"; without one expect "Nothing to restore". After an exhausted-Send restore, the pending question is sent once. | A real StoreKit sandbox purchase, then Restore on a reinstall or second device under the **production** RevenueCat project: Premium returns for the same Supabase user and never attaches to another account. Owner to confirm RevenueCat's restore-behavior setting first. |
| **Notification account isolation and cleanup** | Automated: reconcile and provider tests (account isolation, session loss), sign-out cancels notifications before sign-out, deletion clears notification state and the unsent Signal draft. Device: not yet. | Account A enables race-prep with a registered race; Developer tools → pending shows its reminders. Sign out; sign in as account B; its pending list holds nothing from A. Delete a throwaway dev account; the next account sees nothing from it. | No developer tools in the binary: A enables with the weekly time a few minutes ahead and signs out; confirm no notification arrives at that time, and B's Notifications screen is off with nothing scheduled. Repeat once after deleting a throwaway account. |
| **Permission handling** | Automated: provider and settings tests (denied, revoked, refused prompt). Device: not yet. | First switch-on shows the iOS prompt only then (never at launch). Deny: the in-app message and Open iOS Settings shortcut appear. Enable in iOS Settings and return: it recovers. Revoke later: the warning returns. | The same on the binary: the prompt appears only when a switch is turned on, and a denied or revoked state shows the message. Plus the production-binary delivery check: one reminder actually arrives (weekly time a few minutes ahead) and tapping it opens the right screen. |

## Rollback

Flip the three `production.features` flags to `false` and rebuild to remove the buttons and entitlements from the next build; disable the Apple and Google providers in Supabase production to stop provider sign-ins immediately. Accounts that already linked a provider keep their email sign-in (every account keeps at least one identity).

The consolidated QA and setup status is in `docs/release-1.1-qa-status.md`.

## Not done yet (as of this commit)

Every item above. Production Supabase, RevenueCat, the production App ID, and `environments.json` -> `production` are exactly as they were for Build 18.
