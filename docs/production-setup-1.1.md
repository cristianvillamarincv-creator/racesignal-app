# Production configuration and setup for 1.1

**Order and Build 18 notes revised 2026-10-10 (authoritative: `docs/production-rollout-checklist-1.1.md`): the website and Google publishing come before enabling production Google sign-in (S1), and deploying `delete-account` (S4) changes Build 18's account-deletion behavior.** Prepared 2026-10-07. **Nothing here has been done.** No production setting, secret, function or build has changed, and Build 18 with its production services is untouched. Scope decision: Sign in with Apple and Google stay in 1.1. The ordered release sequence and the rollback procedure are in `docs/release-1.1-checklist.md`; this page is the configuration to apply and who does each step.

Legend: **YOU** = private, credential or console step only you can do (secrets are never typed into chat). **ME** = I do it on your explicit instruction, one step at a time, read back afterward.

## Read-only findings already in hand (2026-10-07)
- Production config today (`npm run release:config`): Apple sign-in, Google sign-in and push all **off**, so a build now would have neither provider.
- EAS production environment: `EXPO_PUBLIC_SUPABASE_URL` points at the **production** project, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` is a production key (`appl_` prefix), plus the ASC submit keys. Nothing to change there.
- RevenueCat production project: app `RaceSignal iOS` (`com.cristianvillamarin.racesignal`) has the App Store Connect API key and the subscription key configured; entitlement `premium` has both products attached (`racesignal_premium_monthly`, `racesignal_premium_annual`); the `default` offering is current with a published paywall (revision 4). Not verified: whether the two products are approved or ready in App Store Connect, and the RevenueCat restore-behavior setting.
- Database: production and development both have migrations 0001 to 0011, so 1.1 needs no migration.
- Production functions: `signal` v16, `race-discovery` v8, `delete-account` v2.

## 1. Apple
| # | Step | Who |
|---|---|---|
| A1 | **Done 2026-10-08 (owner-reported):** production App ID `com.cristianvillamarin.racesignal` has Sign in with Apple enabled as a primary App ID; Push Notifications unchecked. | done |
| A2 (done 2026-10-09, owner-reported: production key created and the .p8 saved) | Keys → create a **Sign in with Apple** key whose primary App ID is the production App ID (or add the production App ID to the existing dev key's Configure screen). Download the `.p8` once. Note the Key ID and Team ID. Used only for account-deletion token revocation. | YOU |
| A3 | **Done 2026-10-09:** the four Supabase production secrets (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY`) were set with `supabase/prod/set-apple-secrets.py set --apply`; read-back and an independent read-only check confirmed them and left every other secret unchanged. | done |
| A4 | App Store Connect → Users and Access → **Sandbox** → create sandbox testers for the StoreKit checks. | YOU |
| A5 | App Store Connect: 1.1 version record, What's New text, review notes (keep the reviewer email+password path; add that Apple and Google sign-in are available and that Sign in with Apple satisfies Guideline 4.8), App Privacy answers (email via Apple and Google; local notifications; Anthropic), screenshots if needed. | YOU |

## 2. Google
| # | Step | Who |
|---|---|---|
| G1 | **Done 2026-10-09:** the production redirect URI was added beside the dev one on the existing Web client; a read-only probe shows Google accepts both. | done |
| G2 | Google Auth platform → Audience → **Publish app** (In production). Basic scopes only (`openid`, `email`, `profile`). Check the Publish screen for whether a privacy-policy link is required. | YOU |
| G3 | **Decision:** brand verification (showing the app name and logo) needs a domain you own with the policy hosted on it; the Notion pages cannot be verified. Either accept the unbranded consent screen or host the policy on your own domain and submit verification. | YOU |
| G4 | Give the Web client **ID** (not secret) to me for `environments.json`. Put the client **secret** into Supabase yourself (step S1). | YOU, then ME for the ID |

## 3. Supabase production
Do these only after the CLI token is rotated and on explicit instruction, one at a time.
| # | Step | Who |
|---|---|---|
| S0 | **Done 2026-10-08:** exposed CLI token revoked; replacement login verified read-only against both projects. | done |
| S1 | Authentication → Providers: **Apple** enabled with client ID `com.cristianvillamarin.racesignal`; **Google** enabled with the Web client ID and secret; **Skip nonce check stays off**; **Enable manual linking** on. | YOU (secrets) or ME with your silent prompt |
| S2 | URL configuration **read back 2026-10-08**: site URL `racesignal://auth-callback`; allow list `racesignal://auth-callback,racesignal://**`; no `exp://` or `racesignal-dev://` entry. Nothing to change. | done (read) |
| S3 | Custom SMTP is **confirmed configured** (read-only, 2026-10-08): `smtp.gmail.com:587`, sender `racesignal@gmail.com` (name RaceSignal), email rate limit 30 per hour. Magic-link deliverability and the production-scheme redirect are still checked on the TestFlight binary. | done (read), TestFlight |
| S4 | Deploy `delete-account` (Apple revocation), then `signal`, each with `--project-ref <production ref>`, one at a time, reading back versions. `race-discovery` stays v8. Follow the `signal` compatibility and rollback section of the release checklist first. | ME on explicit instruction |
| S5 | Read back `external_apple_enabled`, `external_google_enabled`, `security_manual_linking_enabled`; confirm the secret names exist. | ME |

## 4. RevenueCat
| # | Step | Who |
|---|---|---|
| R1 | App Store Connect: confirm both subscription products are in a state that can be purchased from a TestFlight sandbox build (and will be submitted with the version if needed). Confirm pricing, any intro offer and the subscription group. | YOU |
| R2 | RevenueCat dashboard (production project): confirm the **restore behavior** setting (how a restored purchase transfers between app user IDs). Our user ID is the Supabase user ID. Tell me the setting. | YOU |
| R3 | Confirm App Store Server Notifications are pointed at RevenueCat for the production app. | YOU |
| R4 | Nothing to change in code or EAS: the production key and hosted paywall are already configured (verified above). I can re-read the production offering and paywall at release time. | ME (read-only) |

## 5. Local notifications
No Apple capability, entitlement, key, server or RevenueCat step is involved. Production config keeps `pushEntitlement` **false**, so the production binary has no `expo-notifications` plugin; the checklist records why that is sufficient (native module autolinked, plugin only adds push entitlement and sounds) and that it must be **confirmed on the TestFlight binary**: a reminder scheduled a few minutes ahead actually arrives and its tap opens the right screen. Privacy policy and App Privacy answers should mention local notifications (YOU).

## 6. Build configuration (after the steps above)
| # | Step | Who |
|---|---|---|
| B1 | In `mobile/config/environments.json` set `production.features.appleSignIn` and `googleSignIn` to `true`, leave `pushEntitlement` `false`, set `production.google.webClientId`. | ME on instruction |
| B2 | Run `npm run release:config`: expect Apple entitlement `true`, `pushEntitlementPlugin` `false`, `runtimeAuthFlags` apple and google `true`. | ME |
| B3 | Bump `version` to `1.1.0` (the iOS build number is EAS-managed, next is 19). | ME on instruction |
| B4 | Production build and submit to TestFlight (Apple login prompts during the build). | ME on instruction, YOU for the Apple login |

## What waits for the TestFlight binary
Sign-in on the production deep link and an existing account staying signed in; Apple and Google sign-in, connect, conflicts and Welcome-back on the production backend; Apple deletion with real revocation; a StoreKit sandbox purchase and Restore under production RevenueCat; a Signal answer against production; account deletion; local notification delivery, isolation and permission handling on the binary. Use throwaway accounts, never the reviewer account.
