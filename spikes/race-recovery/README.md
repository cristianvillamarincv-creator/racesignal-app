# Race Recovery Spike (B.0)

Standalone, throwaway proof-of-concept. **Not connected to the RaceSignal app** — no imports
to/from `mobile/`, no Supabase, no production onboarding UI. Exists only to answer one question:
can we reproduce, programmatically, the Sportstats candidate-discovery experience a human gets
from the public "Find Results" search?

## What this proves

```
racingName -> Sportstats athlete match -> lightweight candidate list (~17 entries)
           -> (only for candidates the caller selects) -> full detail fetch -> normalized RaceCandidate[]
```

This mirrors the intended product architecture: name search produces a lightweight list; full
detail is fetched only for races the user actually selects — not for every candidate found.

## Constraints honored

- Public, unauthenticated Sportstats endpoints only (see `src/sportstatsClient.ts` for exactly
  which three, and how each was identified).
- Sequential requests, fixed delay between them, low volume (discovery = 2 requests total;
  detail = 1 additional request per selected candidate, not per candidate found).
- No login automation, no CAPTCHA solving, no proxy rotation, no access-control bypass.
- Any 403/429/503 or a response body matching a block/challenge marker stops the run immediately
  — no retry, no fallback, no silent degradation.
- Output is candidate data only. Nothing here writes to a database or claims a result belongs to
  anyone — that "this is me / not me" confirmation is a product-layer decision, out of scope here.

## Run it

```bash
npm install
npm start
```

Runs the B.0 evaluation case (Alanna Harvey, both known anchors) by default. To try a different
athlete/anchors:

```bash
npm start -- --name "Some Name" --birthYear 1990 \
  --knownRace "Some Event:2024" --knownRace "Other Event:2023"
```

`--knownRace` may be repeated. Only candidates matching a `--knownRace` (event-name substring +
year) get a full detail fetch; every other discovered candidate stays a lightweight entry
(event/date/category/source URL only) — exactly as the product architecture intends.

## Files

- `src/types.ts` — shapes mirroring the B.0 architecture proposal (`RaceCandidate`,
  `AthleteSearchRequest`, etc.)
- `src/sportstatsClient.ts` — the three HTTP calls, with block-detection and a fixed inter-request
  delay
- `src/normalize.ts` — raw provider JSON/HTML → `RaceCandidate[]` / `RaceCandidateDetail`
- `src/acceptanceCheck.ts` — the manual-benchmark comparison used to validate this run (not part
  of the reusable adapter — this is the one-time proof harness)
- `src/cli.ts` — wires it together and prints discovery + detail + the acceptance check
