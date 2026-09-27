# App Store Connect metadata — prepared, not yet submitted (Step 7.5)

## Store name

App Store Connect currently shows a temporary/placeholder name: **"RaceSignal (4f141a)"**. This
needs to be changed to the real store-facing name ("RaceSignal") in App Store Connect before
submission — flagging this now so it isn't missed; not something fixable from the codebase.

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

## App Review notes (draft)

```
RaceSignal uses email magic-link sign-in (no password). To test:

1. Enter any real email address you can access on this device/browser at the sign-in screen.
2. RaceSignal sends a one-time sign-in link to that address — open it from the same device to
   return to the app and complete sign-in.
3. If the emailed link doesn't arrive within a couple of minutes, please check spam, and note that
   requesting a new link is rate-limited to one per minute per email address.

Once signed in, you'll land in onboarding, which offers to search for your race results
automatically (via a public race-results search) or let you add a race by hand — either path works
for review. From there:
- The Signal tab (or "Ask Signal" on any race) is our AI analysis feature — it answers questions
  using the athlete's own race history via a large language model.
- Settings → Delete account permanently deletes the test account and all of its data; please use
  this rather than re-using the same test email across multiple review sessions if you'd like a
  clean account each time.

Contact: racesignal@gmail.com
```

Update this once Step 7.1's magic-link reliability fix is confirmed on a real device, and again if
you'd rather offer a specific standing demo account instead of "any email you control."

## Not yet finalized (deliberately)

- **App Privacy "nutrition label"** — holding off per your instruction, since RevenueCat (Step 8)
  may add payment-related data collection that changes the disclosure. Fill this out once Step 8
  lands, using `docs/legal/privacy-policy.md` as the source of truth for what's actually collected.
- **Privacy Policy / Terms / Support URLs** — placeholders until you publish the Notion pages and
  share the final URLs; then: paste them into App Store Connect's respective fields, and set
  `PRIVACY_POLICY_URL` / `SUPPORT_URL` in `mobile/src/lib/legalLinks.ts`.
