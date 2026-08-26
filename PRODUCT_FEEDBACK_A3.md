# Product Feedback — Milestone A.3 (Real Personal Data Prototype)

**Status:** Confirmed learnings from testing A.3 on real race data (Cristian's own history) on
physical iPhone via Expo Go. Captured before committing the A.3 checkpoint so the validated
prototype's commit carries the product reasoning behind it, not just the diff.

**Date:** 2026-08-26

This is a decisions/learnings log, not a spec for the next milestone. Nothing in this document
should be implemented as part of A.3 — it is the input to B.0/B.1 planning.

---

## 1. Core direction validated

- Single-player utility is the right V1 direction.
- The Home / Season / Stats / AI tab structure works.
- Real race data makes the product meaningfully valuable — mock data could not validate this.
- **Decision: do not return to social-first for V1.**

## 2. Home

- Improve the year selector UX.
- Add a clear **+ Add next race** action.
- Top yearly metrics should be centered and visually balanced.
- Current preferred top metrics:
  - Races
  - PRs this year / Personal Bests, depending on context
  - Avg AG finish
- Race Signal is removed for now (no reintroduction planned for V1).

## 3. Race details

- Preserve source/provider provenance.
- When a result is imported from a provider, show the provider name + a source URL / "View
  official result" link.
- Notes should eventually be editable.
- Split-level PRs are important and should be surfaced clearly (see also §5).

## 4. Season

- Current structure works well — no redesign needed.
- **+ Add next race** should also be available here (not just Home).
- Premium locking rules are unresolved — **do not treat current lock positions as final.**
- Future idea: race discovery/planning may live in Season or in AI.

## 5. Stats

- Keep the current information architecture.
- Prefer 3 headline metrics on one row:
  - Races
  - Personal Bests
  - Avg AG finish
- Best AG finish may remain deeper in the page — feels redundant as a headline metric.
- Add info affordances where a metric's definition may need explanation.
- Remove unnecessary text explaining Premium when an icon alone is enough.
- **Most important new requirement:** triathlon split-level PRs must be computed and surfaced.
  Example: a race may not be an overall PR but may still contain a fastest swim, fastest bike, or
  fastest run split. If a race is both an overall PR *and* contains split PRs, show both.
- Avoid duplicate highlights for the same accomplishment (e.g. showing "2nd" and "2/24" as two
  separate podium highlights for the same result).
- A first recorded result at a distance should establish the initial personal-best baseline for
  the imported history, while still being distinguishable internally from a later PR improvement
  (this refines, not reverses, A.3's First Recorded / PR Performance / Current PB model).

## 6. AI

Preferred example prompts:
- "What upgrade should I make to my bike?"
- "What races should I do next year?"
- "Compare my 70.3 bike splits."
- "Do I need a new wetsuit?"
- "Tell me about race-day nutrition and how to train for it."

Future race-discovery example: *"Find me a flat North American race in early 2027."*

## 7. Athlete profile

Profile should eventually include:
- **Gear** — shoes, bike, wetsuit, power meter.
- **Connections** — start with one training provider.
- **Race-history setup/import.**
- **Account/settings.**
- Proper back navigation.

## 8. Training

- Do not show fake training data.
- A future real training connection should power: recent activities, yearly swim/bike/run totals,
  training time, gear mileage, and training milestones.

## 9. Onboarding

**This is now the highest-priority product flow.**

Target flow: name / remembered race → real race search → confirm identity/results → populated
RaceSignal.

Cristian's wife will be the first real beta tester, so onboarding must be designed for someone
with no fixture data and no developer help.

## 10. Product decision

- Do not create an A.4 milestone just to polish the mock.
- **A.3 is the validated prototype.**
- Next step after this note: commit A.3, then begin **B.0 (race-recovery spike)** /
  **B.1 (real onboarding architecture)**.
