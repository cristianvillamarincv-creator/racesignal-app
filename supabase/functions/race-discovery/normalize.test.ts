// Regression tests for parseSingleResultDetail's split-normalization logic (P1-8, and the B.12
// live-payload-shape fix below), backed by real Sportstats getsingleresult payloads captured live
// from athletes' own accounts — not hand-invented data. Run with `deno test` from this directory
// (or `deno test supabase/functions/race-discovery/` from the repo root).
//
// Fixture provenance (fetched 2026-09-22 via public.sportstats.one/getsingleresult):
//   __fixtures__/barrelman-olympic.json     — Niagara Falls Barrelman, rid=144631, poid=573
//   __fixtures__/eagleman-70-3.json         — IRONMAN 70.3 Eagleman, rid=146358, poid=2024
//   __fixtures__/toronto-half-marathon.json — Toronto Marathon (Half), rid=145788, poid=10323
//
// B.12 device-QA regression: the live endpoint stopped returning a per-checkpoint `pace` object
// (confirmed against 7 real payloads, both triathlon and running, fetched fresh) sometime between
// 2026-09-22 and 2026-09-28, which made every checkpoint look like a discipline-transition marker
// and collapsed every triathlon race into a flat "Checkpoint N" list — the classification logic
// itself was never wrong, its one input signal (`pace.opd`) just stopped being present. These
// fixtures capture that *current* live shape so the fix (and any future regression) is covered by
// the exact payload shape production actually receives, not just the older cached shape above.
// Fixture provenance (fetched 2026-09-28 via public.sportstats.one/getsingleresult, no `pace` key
// on any checkpoint in any of these four):
//   __fixtures__/eagleman-70-3-live.json     — IRONMAN 70.3 Eagleman, rid=146358, poid=2024 (bib 2508)
//   __fixtures__/gulf-coast-70-3-live.json   — IRONMAN 70.3 Gulf Coast, rid=98611, poid=89 (bib 1081)
//   __fixtures__/barrelman-olympic-live.json — Niagara Falls Barrelman, rid=144631, poid=516 (bib 632)
//   __fixtures__/sporting-life-10k-live.json — Sporting Life 10K Toronto, rid=145797, poid=20514 (bib 20548)

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { parseSingleResultDetail } from './normalize.ts';
import type { RawSingleResult } from './sportstatsClient.ts';

import barrelman from './__fixtures__/barrelman-olympic.json' with { type: 'json' };
import eagleman from './__fixtures__/eagleman-70-3.json' with { type: 'json' };
import torontoHalf from './__fixtures__/toronto-half-marathon.json' with { type: 'json' };
import eaglemanLive from './__fixtures__/eagleman-70-3-live.json' with { type: 'json' };
import gulfCoastLive from './__fixtures__/gulf-coast-70-3-live.json' with { type: 'json' };
import barrelmanLive from './__fixtures__/barrelman-olympic-live.json' with { type: 'json' };
import sportingLifeLive from './__fixtures__/sporting-life-10k-live.json' with { type: 'json' };

Deno.test('Barrelman (Olympic) — single-checkpoint-per-leg shape, provider distance trusted', () => {
  const detail = parseSingleResultDetail(barrelman as unknown as RawSingleResult, 'Olympic');

  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Swim', splitSeconds: 1998, totalSeconds: 1998, pace: '2:13/100m' },
      { label: 'T1', splitSeconds: 192, totalSeconds: 2190, pace: undefined },
      { label: 'Bike', splitSeconds: 5106, totalSeconds: 7295, pace: '28.2 km/h avg' },
      { label: 'T2', splitSeconds: 132, totalSeconds: 7426, pace: undefined },
      { label: 'Run', splitSeconds: 2628, totalSeconds: 10054, pace: '4:23/km' },
    ],
  );
  // Provider-derived distances (single checkpoint per leg) should land on the real Olympic
  // standard distances (1.5K / 40K / 10K) — confirms the single-checkpoint trust rule, not just
  // the category fallback (this test passes a category, but the numbers below are independently
  // derived from the payload's own opd deltas, not the KNOWN_TRIATHLON_DISTANCES_M table).
  assertEquals(detail.finishSeconds, 10054);
});

Deno.test('Eagleman (70.3) — multi-mat bike/run legs collapse to one row each, category-distance pace', () => {
  const detail = parseSingleResultDetail(eagleman as unknown as RawSingleResult, '70.3');

  // Exactly 5 rows — the 26 raw checkpoints (11 bike mats, 10 run mats, plus a stray no-distance
  // blip right before the finish that isn't a real transition) must never leak through as extra
  // rows; that was the original P1-8 bug.
  assertEquals(detail.splits.length, 5);
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Swim', splitSeconds: 2379, totalSeconds: 2379, pace: '2:03/100m' },
      { label: 'T1', splitSeconds: 223, totalSeconds: 2601, pace: undefined },
      { label: 'Bike', splitSeconds: 8969, totalSeconds: 11569, pace: '36.1 km/h avg' },
      { label: 'T2', splitSeconds: 276, totalSeconds: 11845, pace: undefined },
      { label: 'Run', splitSeconds: 5854, totalSeconds: 17698, pace: '4:37/km' },
    ],
  );
  assertEquals(detail.finishSeconds, 17698);
});

Deno.test('Eagleman (70.3) — with no category, multi-mat legs get a time but no fabricated pace', () => {
  const detail = parseSingleResultDetail(eagleman as unknown as RawSingleResult, undefined);

  const bike = detail.splits.find((s) => s.label === 'Bike');
  const run = detail.splits.find((s) => s.label === 'Run');
  assertEquals(bike?.pace, undefined);
  assertEquals(run?.pace, undefined);
  // Swim is still single-checkpoint, so its provider-derived distance/pace doesn't depend on category.
  assertEquals(detail.splits.find((s) => s.label === 'Swim')?.pace, '2:03/100m');
});

Deno.test('Toronto Marathon (Half) — no transitions detected, no misleading provider km labels', () => {
  const detail = parseSingleResultDetail(torontoHalf as unknown as RawSingleResult, 'Half Marathon');

  // Not a triathlon shape (zero transition markers) — generic checkpoint fallback.
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Checkpoint 1', splitSeconds: 3640, totalSeconds: 3640, pace: undefined },
      { label: 'Checkpoint 2', splitSeconds: 1856, totalSeconds: 5496, pace: undefined },
      { label: 'Finish', splitSeconds: 12, totalSeconds: 5507, pace: '4:21/km' },
    ],
  );
  // Neither intermediate label mentions a distance at all (the source payload's own opd-derived
  // "14.2 km" / "35.2 km" labels exceed the real 21.1km half-marathon course — proven misleading,
  // see the P1-8 investigation notes).
  for (const split of detail.splits) {
    if (split.label !== 'Finish') {
      assertEquals(split.label.includes('km'), false);
    }
  }
  assertEquals(detail.finishSeconds, 5507);
});

Deno.test('Toronto Marathon (Half) — with no category, Finish gets a time but no fabricated pace', () => {
  const detail = parseSingleResultDetail(torontoHalf as unknown as RawSingleResult, undefined);
  const finish = detail.splits.find((s) => s.label === 'Finish');
  assertEquals(finish?.pace, undefined);
});

// --- B.12: current live payload shape (no `pace` object on any checkpoint) ---
//
// These four cover exactly what item 1 of the B.12 fix asked for: another 70.3 beyond Eagleman,
// an Olympic-distance Barrelman-style race, and a running race, each in the *current* live shape —
// plus re-confirming Eagleman itself now that its own live payload no longer matches the cached
// fixture above. `ps` (present on every real in-leg checkpoint, absent on every real transition
// marker in all four) is what restores correct classification; `opd`/pace numbers are never
// fabricated from it, so distances fall back to the known category table wherever the provider's
// own per-checkpoint distance isn't available — verified below via the no-category variants.

Deno.test('Eagleman (70.3) LIVE shape — no pace object anywhere, ps-based classification matches the cached-fixture result', () => {
  const detail = parseSingleResultDetail(eaglemanLive as unknown as RawSingleResult, '70.3');
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Swim', splitSeconds: 2379, totalSeconds: 2379, pace: '2:05/100m' },
      { label: 'T1', splitSeconds: 223, totalSeconds: 2601, pace: undefined },
      { label: 'Bike', splitSeconds: 8969, totalSeconds: 11569, pace: '36.1 km/h avg' },
      { label: 'T2', splitSeconds: 276, totalSeconds: 11845, pace: undefined },
      { label: 'Run', splitSeconds: 5854, totalSeconds: 17698, pace: '4:37/km' },
    ],
  );
  assertEquals(detail.finishSeconds, 17698);
});

Deno.test('Eagleman (70.3) LIVE shape — with no category, times are correct but every pace is undefined (no opd, no category to fall back to)', () => {
  const detail = parseSingleResultDetail(eaglemanLive as unknown as RawSingleResult, undefined);
  assertEquals(
    detail.splits.map((s) => s.pace),
    [undefined, undefined, undefined, undefined, undefined],
  );
  assertEquals(detail.splits.map((s) => s.totalSeconds), [2379, 2601, 11569, 11845, 17698]);
});

Deno.test('Gulf Coast (70.3) LIVE shape — a second, independent 70.3 payload classifies correctly', () => {
  const detail = parseSingleResultDetail(gulfCoastLive as unknown as RawSingleResult, '70.3 Results');
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Swim', splitSeconds: 2729, totalSeconds: 2729, pace: '2:24/100m' },
      { label: 'T1', splitSeconds: 230, totalSeconds: 2959, pace: undefined },
      { label: 'Bike', splitSeconds: 9687, totalSeconds: 12646, pace: '33.4 km/h avg' },
      { label: 'T2', splitSeconds: 226, totalSeconds: 12872, pace: undefined },
      { label: 'Run', splitSeconds: 7059, totalSeconds: 19931, pace: '5:35/km' },
    ],
  );
  assertEquals(detail.finishSeconds, 19931);
});

Deno.test('Barrelman (Olympic) LIVE shape — sparse single-checkpoint-per-leg race still classifies, and still gets a pace via category fallback (not silently dropped)', () => {
  const detail = parseSingleResultDetail(barrelmanLive as unknown as RawSingleResult, 'Olympic Triathlon');
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Swim', splitSeconds: 1823, totalSeconds: 1823, pace: '2:01/100m' },
      { label: 'T1', splitSeconds: 149, totalSeconds: 1971, pace: undefined },
      { label: 'Bike', splitSeconds: 4454, totalSeconds: 6425, pace: '32.3 km/h avg' },
      { label: 'T2', splitSeconds: 132, totalSeconds: 6556, pace: undefined },
      { label: 'Run', splitSeconds: 2487, totalSeconds: 9043, pace: '4:09/km' },
    ],
  );
  assertEquals(detail.finishSeconds, 9043);
});

Deno.test('Barrelman (Olympic) LIVE shape — with no category, classification still succeeds (labels never depend on category) but no pace is fabricated', () => {
  const detail = parseSingleResultDetail(barrelmanLive as unknown as RawSingleResult, undefined);
  assertEquals(
    detail.splits.map((s) => s.label),
    ['Swim', 'T1', 'Bike', 'T2', 'Run'],
  );
  assertEquals(
    detail.splits.map((s) => s.pace),
    [undefined, undefined, undefined, undefined, undefined],
  );
});

Deno.test('Sporting Life 10K LIVE shape — a running race is never forced into Swim/Bike/Run just because ps is present on its checkpoints', () => {
  const detail = parseSingleResultDetail(sportingLifeLive as unknown as RawSingleResult, '10km');
  assertEquals(
    detail.splits.map((s) => ({ label: s.label, splitSeconds: s.splitSeconds, totalSeconds: s.totalSeconds, pace: s.pace })),
    [
      { label: 'Checkpoint 1', splitSeconds: 1521, totalSeconds: 1521, pace: undefined },
      { label: 'Finish', splitSeconds: 1585, totalSeconds: 3106, pace: '5:11/km' },
    ],
  );
  assertEquals(detail.finishSeconds, 3106);
});
