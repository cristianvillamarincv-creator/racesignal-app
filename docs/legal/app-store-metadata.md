# App Store Connect metadata: draft

**Status (updated 2026-10-02): working draft. Nothing here has been confirmed against App Store Connect.** Build 18 (`8e3f0ec`, version 1.0.0) was uploaded to App Store Connect on 2026-09-28. Whether it finished Apple processing, whether any version record or App Review submission exists, and the current state of every field below are **unconfirmed** and need the owner to check App Store Connect. This file does not change any published legal page (the privacy policy, terms, and support pages live in `privacy-policy.md`, `terms-of-use.md`, `support.md` and their public Notion pages, and were not edited).

## Store name

App Store Connect showed a temporary placeholder name, **"RaceSignal (4f141a)"**, when this draft was first written. The intended store-facing name is "RaceSignal". **Unconfirmed** whether it has since been changed.

## Subtitle (30 chars max)

`Race history, AI-analyzed`
(29 chars)

## Promotional text (170 chars max, editable without a new build)

`Track every race, and ask Signal what your history says about the one that's next. Real results,
real analysis — no spreadsheets.`

## Description

```
RaceSignal is where endurance athletes keep their race history — and ask what it means.

TRACK YOUR RACES
Automatically find your past results, or add races by hand. RaceSignal keeps your event details,
splits, and placements in one place, organized by sport and distance.

ASK SIGNAL
Signal is RaceSignal's built-in AI analyst. Ask it anything about your history — "How have my
70.3 times trended?", "What does my history suggest for my next Ironman?", "Compare these two
races" — and get an answer grounded in your own results, not a generic training plan. Attach a
screenshot from Garmin, Strava, TrainingPeaks, or your watch, and Signal will factor it in.

YOUR DATA, YOUR CALL
Your race history is yours. Delete your account and everything with it, any time, right from
Settings.

RaceSignal is built for triathletes, runners, and other endurance athletes who want their race
history to be more than a list — and want a straight answer about what it means for what's next.
```

Accuracy notes (verified against the code, 2026-10-02):
- Screenshots are an optional, one-per-message attachment (a picture the athlete already has), **not** a live connection to Garmin, Strava, or TrainingPeaks. The in-app copy says so. Do not describe it as an integration or sync.
- Signal does not promise race predictions or guaranteed improvement; it gives hedged analysis from the athlete's own history.
- Race results are found via a public race-results search (Sportstats). Do not claim coverage of other providers.

**Subscription disclosure, not yet drafted.** The app sells an auto-renewing Premium subscription. Apple's subscription guidelines expect the store description/metadata to describe the subscription and link the Terms of Use and Privacy Policy. This draft contains none of that. The wording, and whether it belongs in the description, is a decision for the owner; it is not written here so that no unapproved claim is invented.

## Premium (verified from RevenueCat on 2026-10-02; prices and trials unconfirmed)

- Entitlement `premium`. Products: `racesignal_premium_monthly` and `racesignal_premium_annual`. Offering `default` (`$rc_monthly`, `$rc_annual`) with one hosted paywall (published 2026-09-27).
- Allowances: Races, Stats, and Race Prep are free. Signal: **3 asks total, for the life of a free account**; Premium: **40 asks per UTC calendar month**. Never describe free Signal as unlimited or as "3 per month".
- **Unconfirmed:** App Store Connect product status, prices, free trial / intro offers, subscription group setup, and RevenueCat's restore-behavior setting.

## Keywords (100 chars max, comma-separated, no spaces needed but counted)

`race,triathlon,running,marathon,ironman,70.3,training,results,splits,PR,AI coach,performance`

(Tune once you see what competitors rank for — this is a first pass, not final.)

## Age rating recommendation

**4+** is the right starting point: no user-to-user chat, no user-generated content shared between
athletes, no objectionable content, no gambling/alcohol/tobacco themes. Signal is a scoped,
system-prompted AI feature answering questions about the athlete's own race data — not an
open-ended chatbot.

One caveat: Apple's age-rating questionnaire asks specific questions about AI-generated content.
Answer those honestly based on Signal's actual scope (structured, race-data-grounded responses,
not open-ended/unmoderated generation) — if Apple's own questionnaire logic pushes this to a higher
tier based on your answers, that's expected and fine; don't answer around it to force 4+.

## Copyright

`© 2026 Cristian Villamarin`
(Adjust the year/entity name if you're submitting under a different legal name or company.)

## App Review notes (updated draft; the earlier draft said "no password", which is no longer accurate)

```
RaceSignal's primary sign-in is an emailed one-time magic link. Because a reviewer may not be
able to open a real inbox, a secondary email + password sign-in is also available:

1. On the first screen choose "Already have an account? Sign in", then "Sign in with email and
   password".
2. Use the review account credentials entered in this submission's "Sign-in information" fields.
3. The review account already contains sample race history, so Stats, Races, Race Prep, and
   Signal can be exercised immediately.

Signal (the Signal tab, or "Ask Signal" on a race) is an AI analysis feature. It sends the
athlete's race data and question, and an optional attached screenshot, to a third-party AI
provider (Anthropic) to generate a reply, after a first-use consent prompt. Free accounts include
3 Signal asks in total; Premium (auto-renewing subscription, purchased in-app) includes 40 per
month. Please avoid spending the review account's free asks beyond what review requires.

Settings → Delete account permanently deletes the account and its data.

Contact: racesignal@gmail.com
```

- The review credentials are **not stored in this repository**. They were delivered to the owner privately.
- **Unconfirmed:** that this text and the credentials have been entered in App Store Connect, and that the review account and its Signal allowance are still usable.

## Open items (all unconfirmed or undecided)

- **App Privacy "nutrition label":** not finalized. It must reflect, at minimum, the data in `privacy-policy.md`, RevenueCat purchase data, and the screenshot flow. Anthropic's standard commercial API retention is up to 30 days unless a Zero Data Retention agreement applies; **whether this account has ZDR is unconfirmed**, and the published privacy policy's screenshot-retention wording has **not** been changed or reconciled with that. Recommendation previously given: disclose "Photos or Videos" unless ZDR is confirmed and the owner/legal agree otherwise. The decision belongs to the owner.
- **Privacy Policy / Terms / Support URLs:** the app links public Notion pages (`mobile/src/lib/legalLinks.ts`). Confirm the same URLs are entered in App Store Connect.
- **Custom SMTP** for magic-link email (Supabase's shared mailer is rate-limited): unconfirmed. This affects review and real customers.
- **Sign in with Apple:** not implemented. Required only if a third-party login such as Google is ever shown (Guideline 4.8); Google is currently hidden.
- Screenshots, app icon assets, export-compliance answers (`ITSAppUsesNonExemptEncryption: false` is set in `app.json`), and the final version/build selection for review: not verified.
