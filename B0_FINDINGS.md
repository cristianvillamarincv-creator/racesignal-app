# Milestone B.0 Findings — Race Recovery Technical Spike

**Status:** PASS. Race-recovery discovery is sufficiently validated to proceed to B.1.
**Date:** 2026-08-27
**Spike code:** [`spikes/race-recovery/`](spikes/race-recovery/) (standalone, not connected to `mobile/`)

## Hypothesis tested

Can RaceSignal take a new endurance athlete who has never used the app, ask for a small amount of
identity/race information, and reliably discover their real historical race results from
public/authorized sources — without scraping, bypassing access controls, or automating login?

## Evaluation input

- **Athlete:** Alanna Harvey (a real second athlete, not hardcoded product data — used here only
  as the B.0 evaluation case)
- **Birth year:** 1991 (supplied only as match evidence, never treated as identity proof)
- **Known-race anchors (2, not a full race list):**
  - Toronto Half Marathon, ~2026, Toronto
  - Barrelman Olympic Triathlon, ~2025, Niagara Falls/Welland, ON

## Results

### Discovery: 17/17

A single name search against Sportstats' public athlete-search surface resolved to one athlete
profile and returned **17 candidate races spanning 2016–2026**, reproducing the manual browser
benchmark exactly — same events, dates, categories, result IDs, and source URLs. Both known
anchors were present in the list. This is the core "wow moment" evidence: two known races plus a
name were enough to surface 15 additional plausible historical results.

### Detail: 9/9 fields matched

Full result detail (finish time, bib, overall/gender/age-group rank with field sizes, and
swim/bike/run splits) was fetched for the two anchor races only — not for all 17 — matching the
intended product flow of "discover lightweight candidates first, fetch full detail only for what
the athlete selects." Every field matched the manual benchmark exactly once a rounding
convention was corrected (see Adapter constraints below).

| Field | Result |
|---|---|
| Toronto Half — finish, overall, gender, AG rank | ✅ 4/4 |
| Barrelman — finish, AG rank, swim/bike/run splits | ✅ 5/5 |

## Request sequence used

1. `GET public.sportstats.one/namesearch?dn={name}&limitcount=30` — name → athlete ID
2. `GET sportstats.one/results/athlete/{id}` — candidate list (embedded JSON in server-rendered HTML)
3. `GET public.sportstats.one/getsingleresult?rid={resultId}&potype=pid&poid={athleteId}` — full
   detail, fetched only for selected/anchor candidates

All three are public, unauthenticated, on endpoints Sportstats' own frontend calls (not hidden or
reverse-engineered against anything private). 4 total requests for this run, sequential, ~700ms
apart. `sportstats.one/robots.txt` disallows only `/api/`; `public.sportstats.one` has no
`robots.txt`. No login, no CAPTCHA, no proxy rotation, no retry-on-block logic was needed or used.

## Sportstats adapter constraints (why this must stay isolated)

- **These are undocumented internal endpoints**, not a published/versioned public API. They were
  identified by observing Sportstats' own frontend network calls, not from any developer
  documentation or support agreement. Sportstats can change field names, response shape, or
  remove/gate these endpoints at any time without notice, deprecation window, or breaking-change
  communication.
- Response fields are opaque, single-letter keys (`ro`, `rg`, `rc`, `cd`, `st`, `opd`, `pc`, …)
  reverse-mapped by comparing output against the manual benchmark, not documented anywhere.
  Field-name drift on Sportstats' side would silently break parsing rather than fail loudly.
  Time-rounding convention (ceil, not nearest) was likewise inferred empirically, not documented.
- **Requirement carried into B.1:** all Sportstats-specific request/parsing logic must live behind
  a single replaceable provider-adapter interface (`RaceCandidate`-shaped input/output), never
  called directly from app/UI/domain code — matching the original B.0 architecture proposal. This
  is what lets us swap in a documented API (Athlinks, once access is granted) or add another
  provider later without touching anything above the adapter boundary.

## Known scaling/access risk

- **No SLA, no rate-limit documentation, no commercial-use terms** for these endpoints — B.0
  deliberately used low, sequential, human-scale request volume (4 requests for one athlete) and
  never tested or needs to test what happens at real product scale (many users onboarding
  concurrently). That question is explicitly out of scope for B.0 and unresolved.
- If Sportstats begins blocking, rate-limiting, or challenge-gating this traffic pattern at scale,
  the product's fallback path (user-provided result URL → manual entry) must already exist as a
  first-class option, not an afterthought — this shapes the B.1 architecture requirement to
  support "candidate" and "manual add" as parallel input paths from the start.
- Reaching out to Sportstats about a supported/documented integration (raised in the B.0
  provider-research phase) remains open and non-blocking — B.1 does not depend on it.

## Conclusion

Race-recovery discovery is **sufficiently validated to proceed**. A real second athlete, given
only a name, birth year, and two remembered races, had 15 additional real historical results
surfaced automatically and correctly through a legitimate, low-volume, unauthenticated public
request path. The core onboarding risk this spike was built to retire — "can we actually find
someone's races from almost nothing" — is retired. What remains for B.1 is turning this into a
persisted, per-athlete product flow with proper confirmation gating and adapter isolation, not
further discovery-feasibility research.
