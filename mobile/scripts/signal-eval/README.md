# Signal regression harness (developer-only)

Exercises the **real, deployed** `signal` Edge Function, the real system prompt, and the real
`buildSignalContext()`/`dbRowToRace()` logic against a real test athlete's data — never a mock or
fake Signal implementation. Built during the Step 5 stabilization pass after manual iPhone testing
proved too slow for iterating on AI-quality changes.

**This does not ship.** It lives outside `src/` (Metro only bundles what's reachable from
`src/app/*`, which never imports anything here), and is excluded from `tsconfig.json`'s `include`
and `eslint.config.js`'s lint targets — it does not affect the app's own `tsc`/`eslint` runs, the
production bundle, or runtime behavior in any way.

## What it checks, and what it doesn't

Deterministic correctness — precomputed time deltas, per-distance percentiles — is covered by
fast, **zero-model-call** Jest unit tests in `__tests__/signalContext.test.ts`. Run those first;
they're free and catch a real regression in the context-assembly logic before spending an API
call on it.

This harness's job is different: **end-to-end behavior against the live model** — reliability
(does the request actually succeed), and best-effort automated red-flags for the exact wrong
phrasings found during evaluation (e.g. the model re-inventing a wrong number or an unsupported
benchmark). Free-text grading is inherently fuzzy — every case prints the full reply so a human can
sanity-check it in a few seconds; the pass/fail flags are a first pass, not a substitute for that.

## Setup

You need:
1. A real Supabase athlete account with race history (any RaceSignal test account works).
2. That project's **service-role key** — used *only* to mint a non-interactive session for that
   athlete (the programmatic equivalent of tapping a magic-link email; no email is actually sent).
   Get it with:
   ```bash
   supabase projects api-keys --project-ref <your-project-ref> --reveal -o json
   ```
3. `mobile/.env` already has `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — this
   harness reads the same two variables.

**Never commit the service-role key or a minted session token.** Pass them as environment
variables for the single invocation, not in a file.

## Running it

From `mobile/`:

```bash
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
SIGNAL_EVAL_EMAIL=<test-athlete-email> \
npx tsx --env-file=.env scripts/signal-eval/regressionCases.ts
```

Run every case (default), or name specific ones to control API usage:

```bash
SUPABASE_SERVICE_ROLE_KEY=... SIGNAL_EVAL_EMAIL=... \
npx tsx --env-file=.env scripts/signal-eval/regressionCases.ts five-turn-reliability
```

### Regression cases

| Name | Covers |
|---|---|
| `eagleman-vs-victoria-arithmetic` | The exact real bug: a race-to-race time difference the model used to miscalculate itself. Flags if the old wrong ~13-minute figure reappears. |
| `tenk-percentile-accuracy` | The exact real bug: a percentile generalized from one distance onto another. Flags if the wrong "top 2-3%" 10K claim reappears. |
| `strongest-discipline-ambiguity` | Runs the same close-call question twice; fails if neither/either reply fails to acknowledge how close the evidence is. |
| `california-prediction-no-benchmark` | Flags an invented population statistic/ratio (e.g. "athletes at this level typically...") not present in RaceSignal's own context. |
| `five-turn-reliability` | The core P0 acceptance test: 5 consecutive turns in one conversation, zero failures required. |
| `screenshot-extraction-and-followup` | Needs `SIGNAL_EVAL_IMAGE_PATH=/path/to/screenshot.png` (or skips itself with a clear note). Confirms extraction + the "From your uploaded evidence" section, then confirms a follow-up doesn't resend the image (checked via request size, not just success). |

The first four assume the test athlete has a race with "Eagleman" in its name (or a 10K result);
adjust `findRaceByName`'s search term in `regressionCases.ts` if evaluating a different athlete.

## Cost control

Each case makes 1–5 real model calls (see the table). Running everything is roughly 10-15 calls.
Prefer naming specific cases while iterating on a fix, and only run the full set before calling a
fix done.
