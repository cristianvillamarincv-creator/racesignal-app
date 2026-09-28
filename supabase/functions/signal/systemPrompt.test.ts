// Regression tests for buildSystemPrompt's factual-quality pass (B.1 Task 2). Run with
// `deno test` from this directory (or `deno test supabase/functions/signal/` from the repo root) —
// this Edge Function is a separate Deno project from mobile/, so these are NOT picked up by the
// mobile Jest suite (see mobile/__tests__/ for the client-side equivalents: format.test.ts and
// signalContext.test.ts).

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { buildSystemPrompt } from './systemPrompt.ts';
import type { SignalContext } from './types.ts';

const EMPTY_CONTEXT: SignalContext = {
  sameSportDetailed: [],
  otherSportsCompact: [],
  upcoming: [],
  bestPerDistance: [],
};

Deno.test('formatDuration (via buildSystemPrompt) — never renders a raw seconds count', () => {
  const context: SignalContext = {
    ...EMPTY_CONTEXT,
    seedRace: {
      id: 'race-1',
      name: 'Test Marathon',
      sport: 'running',
      distanceLabel: 'Marathon',
      eventDate: '2026-01-01',
      location: 'Test City',
      // The exact figure the B.1 investigation called out: 10054s must never render as "10054s" —
      // it must read as 2:47:34 (2h 47m 34s), matching mobile's lib/format.ts formatFinishTime.
      finishSeconds: 10054,
      splits: [{ label: 'Run', elapsedSeconds: 10054, paceLabel: '4:23/km' }],
      highlights: [],
      notes: [],
    },
  };

  const prompt = buildSystemPrompt(context);

  assertStringIncludes(prompt, '2:47:34');
  // Never the raw seconds count, with or without a trailing "s" unit marker.
  assertEquals(/\b10054s\b/.test(prompt), false);
  assertEquals(/\b10,054s\b/.test(prompt), false);
});

Deno.test('formatDuration — sub-hour durations render as M:SS, not H:MM:SS', () => {
  const context: SignalContext = {
    ...EMPTY_CONTEXT,
    bestPerDistance: [{ canonicalDistance: '10K', raceName: 'Test 10K', finishSeconds: 2448 }], // 40:48
  };

  const prompt = buildSystemPrompt(context);

  assertStringIncludes(prompt, '40:48');
  assertEquals(/\b2448s\b/.test(prompt), false);
});

Deno.test('buildSystemPrompt — includes the percentile-direction correction', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  // A lower percentile number is the stronger placement — the model must never invert this (e.g.
  // never claim "top 23% trails top 26%").
  assertStringIncludes(prompt, 'LOWER percentile number is a BETTER');
  assertStringIncludes(prompt, 'Top 23%');
});

Deno.test('buildSystemPrompt — includes the field-competitiveness-from-percentages-alone guardrail', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'stronger age-group competition');
  assertStringIncludes(prompt, 'percentile is this athlete');
});

Deno.test('buildSystemPrompt — includes the raw-duration-does-not-mean-strongest guardrail', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'never "strongest" just because');
});

Deno.test('buildSystemPrompt — includes the cross-distance comparability guardrail', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'account for the distance/category');
  assertStringIncludes(prompt, '5K time vs. a marathon time');
});

Deno.test('buildSystemPrompt — includes the fact-vs-interpretation guardrail', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'fact versus interpretation');
  assertStringIncludes(prompt, 'definitely');
});
