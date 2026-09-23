# Milestone B.1 — Real Athlete Beta: Architecture Notes

Reference doc for the persisted-data/auth architecture built in B.1. Supersedes the in-chat
architecture proposal for anything that changed during implementation (see the Google-auth
revision below).

## Summary

`racing name → Sportstats discovery (unauthenticated) → bulk-select candidates → sign in only to
save → detail fetched for selected only → persisted via RLS → activation summary`. Full schema,
Edge Function, and mobile integration details live in [supabase/README.md](supabase/README.md)
and the code itself — this file exists for the decisions that need a durable home rather than a
buried code comment.

## B.1 final validated state — Step 2 checkpoint

Physical-device acceptance passed with this feature set. Each item names its primary source of
truth; the sections below (mostly written earlier, during implementation) go deeper on the *why*
for the ones that had a real bug to root-cause.

1. **Value-before-signup onboarding** — `OnboardingFlow.tsx`: racing name → Sportstats search →
   disambiguation (if needed) → bulk-select candidates, all before any sign-in prompt. Auth is
   reached only at the `save` step, after the athlete has already seen what would be imported.
2. **Sportstats athlete/race recovery** — `supabase/functions/race-discovery/` (Edge Function:
   `search`/`history` unauthenticated, `detail` requires a valid Supabase JWT checked inside the
   function) + `mobile/src/lib/raceDiscovery.ts` (thin client). The only place Sportstats-specific
   request/parsing logic lives, per the original B.1 architecture decision.
3. **Alternate racing-name search** — `FindMyRacesFlow.tsx` (`/find-races`, reachable from the
   global `+` and from Settings), the same discovery pipeline reused post-login. Never calls
   `upsertAthleteProfile`, so searching under a fuller/different name only affects which races are
   found, never the stored `athlete_profiles.racing_name`.
4. **Duplicate awareness** — `fetchImportedProviderResultIds()` (`lib/db/races.ts`, filtered to
   `import_status = 'confirmed'`) marks already-imported candidates "Already added" and
   non-selectable, in both onboarding and Find My Races, before the athlete can re-select them.
5. **Newest-first discovery** — `toCandidateRaces()` in
   `supabase/functions/race-discovery/normalize.ts` sorts candidates by `eventDate` descending.
6. **Durable onboarding completion** — `athlete_profiles.onboarding_completed_at`
   (`migrations/0003_onboarding_completed_at.sql`), read once at launch by `lib/appPhase.tsx` to
   classify a signed-in athlete as done-with-onboarding or not. Written by
   `markOnboardingComplete()` (`lib/db/races.ts`) only when `runImport()` reaches a fully-done
   state (every selected race saved, including zero selected) — **not** when a partial/failed
   import merely shows its summary screen — or when the athlete explicitly taps "Continue anyway"
   on that screen (`handleEnterApp()` in `OnboardingFlow.tsx`). Survives force-close/relaunch
   either way.
7. **Email magic-link auth** — `supabase.auth.signInWithOtp()` / `completeAuthFromUrl()` in
   `lib/auth.tsx`, PKCE flow, resumable through app-kill via the `onboardingDraft.ts` +
   `racesignal://auth-callback` mechanism described below.
8. **Google auth intentionally hidden** — not configured for this version, so the buttons and
   `handleGoogleSignIn` wiring were removed from onboarding's UI (`SaveStep`/`CheckEmailStep` in
   `OnboardingFlow.tsx`) rather than exposing a broken action. The underlying `signInWithGoogle()`
   utility remains in `lib/auth.tsx`, unused, so re-enabling it later is a small diff, not a
   rebuild. Revisit before App Store release (see "Required before App Store submission" below,
   which already covers the Sign-in-with-Apple requirement this reintroduces).
9. **Shared live race state across tabs** — `lib/racesContext.tsx`'s single `AthleteRacesProvider`
   is the one source of truth Home/Season/Stats all read via `useAthleteRaces()`. Every mutation
   (`addManualRace`, `updateManualRace`, `removeRace`, and provider imports via
   `applyImportedRaces()`) merges the result into shared state immediately/optimistically instead
   of depending on a follow-up `refetch()` — so an import or edit is reflected on every tab without
   an app restart.
10. **Manual historical/upcoming race creation** — `race/add.tsx` (`ManualRaceInput`,
    `addManualRace()`), one form covering both an upcoming race (drives Home's countdown) and a
    historical one the discovery adapter didn't find.
11. **Native date input** — `@react-native-community/datetimepicker`, inline on iOS, replacing
    free-text `YYYY-MM-DD` entry in `race/add.tsx`. Requires a Development Build with this native
    module baked in (already the case as of the build that shipped this).
12. **Structured H/M/S finish-time input** — `HmsField` + `hmsToSeconds()` in `race/add.tsx`,
    replacing ambiguous free-text `"H:MM:SS"` parsing.
13. **Manual race editing/removal** — `race/add.tsx` doubles as the edit screen via `?raceId=`
    (`Race.isManual` gates the entry point; an imported race is never editable, only removable).
    Remove is available from both the upcoming-race prep screen (`race/[id].tsx`, `isManual`-gated
    — every upcoming race is manual by construction, since Sportstats only returns completed
    results) and the result-detail screen (`results/[id].tsx`, available for any race regardless
    of provider). Both confirm via `Alert.alert` before calling `removeRace()`.
14. **Upcoming race countdown** — `RaceCountdownCard` + `getNextRace()` (`lib/races.ts`) on Home,
    and the same countdown on the race-prep screen (`race/[id].tsx`) via `daysUntil()`/
    `formatCountdown()`.
15. **Normalized running/triathlon result presentation** — `parseSplits()` in
    `supabase/functions/race-discovery/normalize.ts` groups raw Sportstats checkpoints by
    discipline (segment-count-independent — a "no cumulative-distance field" checkpoint is a
    transition marker, regardless of how many raw mats surround it), producing Swim/T1/Bike/T2/Run
    for a triathlon or a plain checkpoint list for a running race. Distance/pace is only ever shown
    when it comes from a single trustworthy checkpoint or a known standardized category mapping —
    never invented. `results/[id].tsx` additionally filters out any zero-duration placeholder split
    and shows a known race distance (e.g. "Half Marathon · 21.1 km") next to the category label
    when recognized. See "Split normalization (P1-8)" below for the full root-cause history.
16. **Global `+` race actions** — one header-left action sheet
    (`(tabs)/_layout.tsx`'s `HeaderAddButton`, present on every tab) offering **Find past races /
    Add upcoming race / Add manually**, in that order. Every pushed screen it opens (and Settings,
    Race prep, Result detail) shares one standardized top-left Back control
    (`components/HeaderBackButton.tsx`, wired via each screen's `headerLeft` in `app/_layout.tsx`)
    rather than a mix of native-default and ad-hoc in-content back links.
17. **Provider race remove/re-import behavior** — `insertConfirmedRaces()` (`lib/db/races.ts`)
    checks each candidate's `import_status` against what's already in the database: `confirmed` ->
    skip (harmless no-op), never-seen -> insert, previously `removed`/`rejected` -> **revive that
    same row** with freshly-fetched detail data rather than inserting a duplicate (the
    `(athlete_id, provider, provider_result_id)` unique index has no `import_status` filter, so a
    removed row permanently occupies that slot — the pre-fix version silently treated it as
    "already imported" and could never bring it back). `fetchImportedProviderResultIds()` already
    excluded `removed` rows from "Already added," so a removed race is selectable again and its
    re-import always reflects the current normalization logic, not stale data from whenever it was
    first imported.
18. **Sportstats safety limit** — `discovery_rate_limit` table, keyed on `(ip_address,
    window_date)`, checked/incremented once per request across all three Edge Function actions
    (`search`/`history`/`detail`) in `checkAndIncrementRateLimit()`. `window_date` is a UTC
    calendar day (`new Date().toISOString().slice(0, 10)`), not a rolling 24h window, so it resets
    at UTC midnight rather than 24h after the first request. Cap is
    `SPORTSTATS_DAILY_REQUEST_CAP`, currently set to **300** (raised from an initial default of 30,
    which was tuned for a private-beta safety margin but proved too aggressive for a normal
    onboarding + multi-search + large-import session). This is a server-side safety guard against a
    bug or abuse hammering Sportstats, not a normal product constraint a real user should ever see;
    the in-app message if it ever does trip is a generic "Race search is temporarily unavailable —
    please try again shortly," with no "add manually" suggestion implying it's a routine outcome.

### Known release-readiness item (not a B.1 blocker)

**Supabase's shared/default email sender is unsuitable for production.** Confirmed directly
against this project: `/auth/v1/otp` returns `{"code":429,"error_code":
"over_email_send_rate_limit","msg":"email rate limit exceeded"}` after only a handful of magic-link
sends. This is Supabase Auth's own built-in cap on their shared mailer (used because no custom SMTP
is configured) — unrelated to the Sportstats rate limit above, and not something raising our own
config can fix. It's project-wide, not per-user, so it would block real customers' sign-ins almost
immediately at any real usage volume. **Before App Store release**, configure a real SMTP provider
(Resend, Postmark, SES, SendGrid, etc.) in the Supabase Dashboard under Authentication → Emails,
with a verified sending domain (SPF/DKIM). Not addressed now because the app's own behavior around
it (auth flow, error copy, resumability) has already been validated independent of which mailer is
behind it — this is purely an infrastructure/account-setup step for later.

## Step 4 final validated state — V1 UX/design checkpoint

Physical-device acceptance passed for the full Step 4 pass: information architecture, race
correctness fixes, and a lightweight brand direction. Explicitly **not** covered by Step 4: AI
itself (the `Ask`/AI tab exists as a nav entry only — see Step 5), RevenueCat, final branding
assets (app icon/wordmark/splash), and automatic upcoming-race lookup — all deliberately deferred.

1. **`Races → Stats → AI` navigation** — `(tabs)/_layout.tsx`. Replaces the earlier three-way
   Home/Season/Stats split (Home added a year-scoped remix of the other two tabs plus a
   placeholder Strava card; both cut). `Races` (`(tabs)/index.tsx`, kept as `index.tsx` so it's
   the tab group's default/first screen) is now the **single canonical surface race history is
   browsed on** — `Stats` never lists raw races, only deep-links back to Races via a PB/highlight
   card's `onPress`.
2. **Shared sport/year filters, session-scoped** — `lib/raceFilterContext.tsx`'s
   `RaceFilterProvider`, mounted once above the tab navigator (not per-screen), so changing the
   sport or year filter on either Races or Stats updates the other immediately. Plain in-memory
   React state, never persisted — a cold launch always resets to "All sports" / "All years" (that
   exact wording standardized across both screens, replacing an earlier inconsistent mix of
   "All"/"Overall"/"All Time"). Race-name search is deliberately **not** part of this shared state
   — see the next item.
3. **Global race search** — one header search icon (`(tabs)/_layout.tsx`'s
   `HeaderSearchButton`), reachable from every tab, is the single entry point. It bumps
   `RaceFilterProvider`'s `searchFocusRequestId` counter rather than passing a route param, so it
   reliably reveals + focuses Races' own local search field whether Races is already the active,
   already-mounted tab or reached by switching from Stats. Races keeps the field hidden
   (`isSearchVisible` state) until requested, so it no longer permanently occupies space; a
   "Cancel" action clears the query, collapses the field, and returns Races to its normal layout.
   Search itself is unchanged — local, client-side, case-insensitive substring match
   (`filterRacesByName` in `lib/races.ts`) — this was never rebuilt as a second system.
4. **Upcoming-race carousel** — `components/races/UpcomingCarousel.tsx` reuses the existing
   `RaceCountdownCard` unchanged: one full-width card per upcoming race, soonest first, horizontal
   snap-scroll, with small page dots shown only when there's more than one card. The whole card
   (not just its "Open race prep" pill, which is now a visual-only affordance) is the tap target
   into that race's detail screen.
5. **Persistent Race Prep checklist** — `races.checklist_completed` (`text[]`, default `'{}'`,
   `supabase/migrations/0004_race_checklist.sql`) stores only which item ids are checked off; the
   item labels/sections stay a fixed client-side template
   (`lib/checklistTemplate.ts` — 7 sections, 28 items, restored from the original read-only
   fixture). Rendered as a collapsible "Race Prep" card (`components/race/RacePrepChecklist.tsx`)
   on the upcoming-race detail screen (`race/[id].tsx`), gated on `race.isManual` (every upcoming
   race is manual by construction — Sportstats only returns completed results). Reuses the same
   `provider = 'manual'`-scoped update pattern as `updateManualRace` (`updateRaceChecklist` in
   `lib/db/races.ts`); no new RLS policy needed since the existing "own races update" policy
   already covers the new column. **Documented, not built**: profile-level default templates,
   separate Running/Triathlon defaults, athlete-editable items, and new races inheriting a
   template — noted directly in `lib/checklistTemplate.ts` as a future direction.
6. **Corrected sport/category normalization** — `inferSport()` (`lib/raceMapping.ts`, renamed from
   `inferSportFromCategory`) previously classified a bare `"70.3"` or `"70.3 Results"` category as
   `sport: 'other'` (matched neither "triathlon" nor a running keyword), hiding real 70.3 races
   (confirmed live: IRONMAN 70.3 Eagleman/Gulf Coast/Victoria) from the Triathlon filter and
   dropping their PR/fastest-split highlights from Triathlon Stats. Fixed by adding "70.3" and
   "ironman" as triathlon signals, plus a narrow event-name fallback for a generic category value
   like Sportstats' "Overall Results" (IRONMAN 70.3 Syracuse) that carries no signal on its own.
   Deliberately conservative — "sprint" and bare "olympic" were **not** added, since they're
   ambiguous outside a triathlon-specific category string. The 4 already-imported affected rows
   were repaired directly in the database (one-time data fix, not a schema change). Regression
   tests in `__tests__/raceMapping.test.ts`.
7. **Lifetime PR/PB semantics** — a PR/Personal Best is always computed against the athlete's full
   completed-race history first (`getDistancePRStatuses`/`getAllHighlightsUnfiltered` in
   `lib/highlights.ts`); sport/year filters are applied to the result afterward, never to the input
   pool before computation — so selecting a slower year can never promote a slower race into a PR
   that a faster race in a different year already holds. Real-data bug found and fixed alongside
   this: `distanceLabel` (Sportstats' raw category text, or a free-typed manual value) was used
   unnormalized as the PR/PB/fastest-split grouping key, so real spelling variants of the same
   distance ("10k" vs "10km", "70.3" vs "70.3 Results", "Olympic" vs "Olympic Triathlon") formed
   separate comparison pools, letting a lone/slower race in a mis-spelled group trivially "win" it
   (e.g. a 50:40 10K became the shown PB purely because no real "10k"-labeled race existed to beat
   it, even though a faster "10km"-labeled race did). Fixed with `canonicalDistanceLabel()` — a
   small, exact-match-only (never fuzzy) alias table for variants actually observed in this
   athlete's real data. Regression tests in `__tests__/highlights.test.ts`.
8. **Midnight / sage / champagne visual direction** — `lib/theme.ts`. A lightweight V1 pass toward
   a future brand system, not the final one (final palette, iconography, app icon, and wordmark
   remain deferred). Two tokens carry real, restricted meaning: `colors.achievement` (champagne/
   gold, `#D4B06A`) reserved for actual accomplishments — trophy/medal icons, PR/podium badges — and
   `colors.accent` (sage/aqua, `#5CA896`) for progress/active/selected state. Races' row-level
   achievement signal was deliberately kept to the `AchievementBadge` pill alone (at most one
   per row, via `pickPrimaryHighlight` in `lib/highlights.ts`) — an earlier full-height gold
   left-rail on every achievement row was removed for reading like an accidental timeline and
   overusing the achievement color.
9. **Startup auth hydration fix** — `lib/auth.tsx`'s `AuthProvider` collapsed two independent async
   paths (a `getSession()` promise racing a separate `onAuthStateChange` subscription) into one:
   supabase-js v2 guarantees the `onAuthStateChange` callback fires exactly once with
   `INITIAL_SESSION` immediately after AsyncStorage restoration finishes, so that single callback
   now sets both `session` and `isReady`. The two-path version could settle out of order on a real
   device — `isReady` flipping true a tick before `session` reflected its real, restored value —
   which permanently locked `AppPhaseProvider`'s one-shot classification (`lib/appPhase.tsx`,
   deliberately `[authReady]`-only in its effect dependencies, preserved unchanged) onto a stale
   "no session," sending a returning, already-onboarded athlete back into onboarding. Validated on
   a physical device: existing authenticated/onboarded athletes now consistently cold-launch
   directly into the app.

## Authentication (revised three times — see history below)

Reached **only** at the save step — after the athlete has already seen their discovered race
candidates, never before:

- **Magic-link email (currently the only method offered)** —
  `supabase.auth.signInWithOtp({email, options: {emailRedirectTo}})`, matching Supabase's actual
  default email template (a clickable link, not a numeric code — the first device test surfaced
  that OTP-code UI was the wrong assumption). The athlete taps the link in Mail; it redirects
  through the `racesignal://auth-callback` scheme. See the resume-safety and dead-end sections
  below for how that's made robust.
- **Google OAuth — implemented but currently hidden (P1-6)** — not configured for this version, so
  exposing it would just be a broken action. `expo-auth-session` +
  `expo-web-browser`'s `openAuthSessionAsync`, PKCE code exchanged via
  `supabase.auth.exchangeCodeForSession`, is still present and working in `mobile/src/lib/auth.tsx`
  (`signInWithGoogle()`) — only `OnboardingFlow.tsx`'s button/handler wiring was removed. Revisit
  whether to configure and re-expose it before App Store release (see the Sign-in-with-Apple
  requirement immediately below, which applies the moment Google is re-enabled).

**Racing name authority**: the racing name typed during the discovery step is the *only* thing
ever written to `athlete_profiles.racing_name` or used to search Sportstats. Neither Google's
OAuth profile nor the sign-in email is ever read into that field — `runImport()` in
`OnboardingFlow.tsx` takes the racing name as an explicit argument sourced from onboarding state.

**Auth screens are never a dead end**: every screen past 'save' (email form, "check your email")
offers Back (returns to 'save' with racing name / candidates / selections untouched), a way to
switch to the other method (Google ⇄ email), and — on "check your email" — Resend (30s cooldown,
`RESEND_COOLDOWN_SECONDS` in `OnboardingFlow.tsx`) and "use a different email." A failed or
cancelled Google attempt lands back on 'save' with a specific error and every selection intact,
not a reset.

**Redirect resume-safety**: both Google's browser sheet and a tapped magic link hand control to
something outside the app's own JS context, and the app can be backgrounded or (Android
especially) killed while that's happening. Immediately before either one, `onboardingDraft.ts`
persists `{racingName, birthYearHint, candidates, selectedResultIds}` to AsyncStorage. Three
distinct paths can complete the resulting sign-in, all funneled through the same
`completeAuthFromUrl()` in `lib/auth.tsx`: (1) Google's `openAuthSessionAsync` promise resolving
in-process, (2) a cold start where the launch URL itself is the redirect (`Linking.getInitialURL()`,
checked once on mount), (3) a warm foreground/background handoff while the app stayed alive
(`Linking.addEventListener('url', ...)`) — which is the path a tapped magic-link email normally
takes. A `processedUrlRef` guards against handling the same redirect URL twice. The draft is
cleared only once import finishes, not before, so a crash mid-import still leaves it recoverable.

### Root cause of the first device test's Google failure

`supabase-js` defaults `flowType` to `'implicit'`. Under implicit flow, a completed OAuth redirect
carries its tokens in the URL **fragment** (`racesignal://auth-callback#access_token=...`), but
`completeAuthFromUrl()` only ever checked `?code=` in the query string — the fragment was silently
ignored, so the flow looked like it "did nothing." Fixed in `supabaseClient.ts` by setting
`flowType: 'pkce'` explicitly, which makes Supabase's redirect carry `?code=` instead.
`completeAuthFromUrl()` still parses the fragment as a defensive fallback and logs
(`console.log`/`console.warn`, tagged `[Auth]`) which branch it took, plus surfaces a
stage-specific, human-readable message for: provider config errors (`error_description` in the
redirect), code-exchange failures, fragment/session-setup failures, and "redirected back with
neither" (almost always a redirect-URL mismatch between the app, Supabase, and Google Cloud).

## Resolved: Google OAuth requires a Development Build, not Expo Go

Expo Go can't register a stable custom URL scheme with Google's OAuth client (it shares one
`exp://` scheme across every app running inside it), so the `racesignal://auth-callback` redirect
Google/Supabase are configured for only resolves correctly in a build that actually owns that
scheme. Per Expo's current guidance, the fix is a Development Build (`expo-dev-client`, built via
EAS, distributed internally to Alanna's/Cristian's own device — not Expo Go, not an Expo Go proxy
redirect workaround). `mobile/eas.json`'s `development-device` profile (`developmentClient: true`,
`ios.simulator: false`) is what that build uses. Since the email fallback moved to a magic link
(see Authentication below), both sign-in paths now depend on this same Development Build — there
is no remaining auth path that works inside Expo Go.

## Required before App Store submission: Sign in with Apple

B.1 ships Google as a third-party/social sign-in option and does **not** add Sign in with Apple.
Apple App Store Review Guideline 4.8 requires an equivalent privacy-preserving sign-in option
(typically Sign in with Apple) whenever an app offers a third-party login — an app offering
"Continue with Google" without also offering Apple's equivalent is a real, documented rejection
reason at review time. This was a deliberate B.1 scope decision (email OTP remains a working
non-Apple, non-Google fallback for the beta), but **Sign in with Apple must be added before any
App Store submission** — tracked here so it isn't rediscovered at submission time. Not required
for TestFlight/internal beta distribution to Alanna.

## Root cause of the second device test's "0 races imported" blocker

Confirmed against the live database (`supabase db query --linked`), not guessed: an
`athlete_profiles` row existed with `racing_name: ''`, and `races` had zero rows. That's the
signature of `runImport()` being called with an empty name and an empty candidate list, not a
Postgres/RLS failure. Traced to `OnboardingFlow.tsx`'s `Linking.addEventListener('url', ...)` —
registered once inside a `useEffect(() => {...}, [])` — whose callback closed over `racingName` /
`candidates` / `selectedIds` from the component's *first render*, before the athlete had typed
anything or selected a single race, and never saw subsequent updates. That listener is exactly
the path a magic-link tap resumes through (`processAuthRedirect`), so it fired with the stale,
empty values.

**Fix**: `processAuthRedirect` (and `restorePendingAuth`, which happened to already be correct)
now both funnel through one `resumeFromDraftAndImport(userId)` that reads `racingName` /
`candidates` / `selectedResultIds` straight from the AsyncStorage draft — never from a component
closure — since the draft is written synchronously right before sign-in starts and can't go stale
the way a long-lived effect closure can.

**Never-false-success + retry, now built in**: `runImport` tracks exactly what got detail-fetched
(`rows`) versus what was never attempted (`remainingCandidates`, when the Sportstats adapter stops
early on a block/rate-limit) versus what failed to *save* after being fetched
(`stillNeedsInsert`, when the Supabase insert itself throws). The onboarding draft is cleared only
when both are empty — i.e. only once every selected race is actually confirmed persisted. A
partial or total failure shows an explicit message and a **Retry** button (re-attempts exactly the
unsaved subset — already-fetched rows go straight to a re-insert, never-fetched candidates redo
the full fetch+insert) instead of a false "success" or a silently dropped selection. `[Import]`-
and `[db/races]`-tagged `console.log`/`console.warn` lines trace every stage for future debugging
without needing a fresh DB query each time.

## Find My Races (post-login re-discovery)

`/find-races` (`FindMyRacesFlow.tsx`) is the same discovery pipeline (search → disambiguate →
bulk-select → detail → persist) reused after login, reachable from Home/Season/Stats' empty state
and from Settings. Deliberately simpler than onboarding's version: already authenticated, so there
is no sign-in step and no redirect-survival draft (nothing in this flow ever leaves the app). It
never calls `upsertAthleteProfile` — nothing in this file can overwrite
`athlete_profiles.racing_name` — so searching under a different/fuller name (e.g. "Cristian Andres
Villamarin" for an account whose primary racing name is "Cristian Villamarin") only affects which
races are found, never the stored identity. The same partial/retry handling as onboarding's
`runImport` applies here too.

**Provenance**: `races.provider_athlete_name` (new column, `migrations/0002_...sql`) records the
Sportstats-recorded display name for whichever identity a search matched, independent of
`athlete_profiles.racing_name` — populated when available (both onboarding and Find My Races pass
`selectedIdentity.displayName` into `candidateDetailToInsertRow`), left `null` when a resumed
import lost track of which identity was selected (an accepted, documented gap — see the "if
available" wording in the original requirement).

## Name normalization

`lib/nameNormalization.ts`: `normalizeNameForQuery` (trim + collapse internal whitespace,
casing preserved — used before every `searchAthletes()` call and before writing
`racing_name`) and `normalizeNameForComparison` (same, plus lower-cased — for comparing two names,
never for display or for what's sent to Sportstats). This is intentionally limited to
whitespace/case, per the explicit instruction not to add fuzzy alias inference — "Cristian
Villamarin" and "cristian   villamarin" are treated as the same input; "Cristian Villamarin" and
"Cristian Andres Villamarin" are not.

**Verified Sportstats is already case-insensitive, so the outbound query itself isn't
lower-cased.** Three live, sequential requests to `public.sportstats.one/namesearch` with
`Cristian Villamarin` / `cristian villamarin` / `CRISTIAN VILLAMARIN` all returned the identical
four candidate athlete IDs (5194975, 1054446, 593790, 3966184) — only JSON key ordering differed.
Forcing the query to lowercase before sending it would discard the athlete's original
capitalization for no discovery benefit, so `normalizeNameForQuery` only trims/collapses
whitespace and leaves casing untouched; `normalizeNameForComparison` remains the lower-cased
variant for any future in-app equality check.

## Everything else

Schema, duplicate protection, date model, Edge Function boundary (no `races`/`athlete_profiles`
writes from the function, service-role client isolated to `provider_config`/`discovery_rate_limit`
only), race lifecycle (`confirmed`/`removed`), and Manual Add Race are unchanged from the approved
B.1 plan — see `supabase/migrations/0001_init.sql` and `supabase/functions/race-discovery/`.
