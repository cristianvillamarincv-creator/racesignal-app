// Regression tests for parseSingleResultDetail's split-normalization logic (P1-8), backed by real
// Sportstats getsingleresult payloads captured live from the athlete's own account — not
// hand-invented data. Run with `deno test` from this directory (or `deno test
// supabase/functions/race-discovery/` from the repo root).
//
// Fixture provenance (fetched 2026-09-22 via public.sportstats.one/getsingleresult):
//   __fixtures__/barrelman-olympic.json     — Niagara Falls Barrelman, rid=144631, poid=573
//   __fixtures__/eagleman-70-3.json         — IRONMAN 70.3 Eagleman, rid=146358, poid=2024
//   __fixtures__/toronto-half-marathon.json — Toronto Marathon (Half), rid=145788, poid=10323

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { parseSingleResultDetail } from './normalize.ts';
import type { RawSingleResult } from './sportstatsClient.ts';

import barrelman from './__fixtures__/barrelman-olympic.json' with { type: 'json' };
import eagleman from './__fixtures__/eagleman-70-3.json' with { type: 'json' };
import torontoHalf from './__fixtures__/toronto-half-marathon.json' with { type: 'json' };

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
