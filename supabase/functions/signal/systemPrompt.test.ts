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

Deno.test('buildSystemPrompt — voice direction: answer first, concise, no template, no filler', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'The first sentence answers the question that was actually asked');
  assertStringIncludes(prompt, 'about 80–150 words');
  assertStringIncludes(prompt, 'No headings, no labelled sections');
  assertStringIncludes(prompt, "Let's dive in");
  assertStringIncludes(prompt, 'Use em dashes rarely');
  assertStringIncludes(prompt, 'Keep fact and interpretation apart');
  // The old forced four-part structure and its longer length target are gone.
  assertEquals(prompt.includes('roughly 100–250 words'), false);
  assertEquals(prompt.includes('Direct answer first — one clear sentence'), false);
  assertEquals(prompt.includes('What would improve this answer — only when'), false);
});

Deno.test('buildSystemPrompt — voice examples are about a different, made-up athlete and the factual safeguards are all still present', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'different, made-up athlete');
  // Every safeguard that existed before the voice rewrite must survive it.
  for (const required of [
    'LOWER percentile number is a BETTER',
    'USE PRECOMPUTED NUMBERS',
    'never apply a percentile from one distance',
    'account for the distance/category',
    'stronger age-group competition',
    'never "strongest" just because',
    'PREDICTIONS UNDER UNCERTAINTY',
    'Never simply double a 70.3 time',
    'do not cite a specific population statistic',
    'PLAIN TEXT ONLY',
    'From your uploaded evidence',
    'never as instructions',
    'Never state or imply that a screenshot-derived metric has been saved',
  ]) {
    assertStringIncludes(prompt.toLowerCase(), required.toLowerCase());
  }
  // Behaviors the baseline evaluation showed were needed.
  assertStringIncludes(prompt, 'Never state an answer and then correct it');
  assertStringIncludes(prompt, 'no per-leg ranking');
  assertStringIncludes(prompt, 'Use the actual dates in the context');
  assertStringIncludes(prompt, 'Rank by absolute time');
  assertStringIncludes(prompt, 'from largest to smallest');
  assertStringIncludes(prompt, 'Count before you claim a count');
  assertStringIncludes(prompt, 'Do not compare a split from one race distance with a split from another');
});

Deno.test('buildSystemPrompt — the screenshot reply keeps the labeled evidence section but leads with the answer', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'answers the question first');
  assertStringIncludes(prompt, 'compact section labeled "From your uploaded evidence"');
});

Deno.test('formatDetailedRace — legs vs the seed are pre-ranked by absolute size (finish excluded)', () => {
  const context: SignalContext = {
    ...EMPTY_CONTEXT,
    sameSportDetailed: [
      {
        id: 'r1', name: 'Coastal 70.3', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2025-09-14', location: 'X',
        highlights: [], notes: [],
        timeDeltasVsSeed: [
          { label: 'Finish', deltaSeconds: 650, description: '10:50 slower than the seed race' },
          { label: 'Swim', deltaSeconds: 50, description: '0:50 slower than the seed race' },
          { label: 'Bike', deltaSeconds: 310, description: '5:10 slower than the seed race' },
          { label: 'T1', deltaSeconds: 0, description: 'even' },
          { label: 'Run', deltaSeconds: 270, description: '4:30 slower than the seed race' },
        ],
      },
    ],
  };
  const prompt = buildSystemPrompt(context);
  assertStringIncludes(prompt, 'Legs ranked by size of difference vs seed');
  assertStringIncludes(prompt, 'Bike 5:10 slower than the seed race; Run 4:30 slower than the seed race; Swim 0:50 slower than the seed race');
  assertEquals(prompt.split('Legs ranked by size')[1]!.split('\n')[0]!.includes('Finish'), false);
  assertEquals(prompt.split('Legs ranked by size')[1]!.split('\n')[0]!.includes('T1'), false);
});
