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
  assertStringIncludes(prompt, 'Race duration is not evidence');
});

Deno.test('buildSystemPrompt — strongest discipline needs comparable discipline-level evidence; without it, limitation plus improvement evidence', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, '=== STRONGEST OR WEAKEST DISCIPLINE ===');
  // Valid evidence unlocks a verdict: per-leg rank or percentile against the same race field, never raw metrics or duration.
  assertStringIncludes(prompt, 'Name a strongest or weakest discipline only from comparable discipline-level evidence');
  assertStringIncludes(prompt, 'against the same race field');
  assertStringIncludes(prompt, 'raw metrics from different sports are not comparable');
  assertStringIncludes(prompt, 'compare the three disciplines by their ranks against the same field');
  assertEquals(prompt.includes('pace or power data covering all three'), false);
  // Without it: a short limitation scoped to the three disciplines, then improvement evidence, no implied winner.
  assertStringIncludes(prompt, 'among swim, bike, and run');
  assertStringIncludes(prompt, 'labelled as time gained between those races, not strength');
  assertStringIncludes(prompt, 'most decorated');
  assertStringIncludes(prompt, 'transitions');
  // The old absolute prohibition and the "never name one" heading are gone.
  assertEquals(prompt.includes('NEVER NAME ONE'), false);
  assertEquals(prompt.includes('Within triathlon, swim and run are close'), false);
  assertEquals(prompt.includes('running has the stronger overall signal'), false);
});

Deno.test('formatDetailedRace — a leg rank against the same field is rendered on the split when present, and only then', () => {
  const race = {
    id: 'r1', name: 'Ridgeline 70.3', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2026-06-14', location: '',
    finishSeconds: 17930, highlights: [], notes: [],
    splits: [
      { label: 'Swim', elapsedSeconds: 2150, legRank: { place: 412, field: 1720, percentile: 24 } },
      { label: 'Bike', elapsedSeconds: 9370 },
    ],
  };
  const prompt = buildSystemPrompt({ ...EMPTY_CONTEXT, sameSportDetailed: [race] });
  assertStringIncludes(prompt, 'Swim 35:50 (leg rank: 412/1720 (Top 24%)), Bike 2:36:10');
  assertEquals(buildSystemPrompt({ ...EMPTY_CONTEXT, sameSportDetailed: [{ ...race, splits: [{ label: 'Swim', elapsedSeconds: 2150 }] }] }).includes('leg rank:'), false);
});

Deno.test('buildSystemPrompt — voice: no dashes, no trailing question or offer, no proportional gain claims', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'Do not use em dashes');
  assertStringIncludes(prompt, 'the word "to"');
  assertStringIncludes(prompt, 'End when the answer is complete');
  assertStringIncludes(prompt, 'Do not close with a question or an offer');
  assertStringIncludes(prompt, 'proportionally');
});

Deno.test('dates — every race date is written as a named month with its year, and best-per-distance lines carry the date', () => {
  const race = (id: string, eventDate: string, finishSeconds: number) => ({
    id, name: 'Riverside 10K', sport: 'running', distanceLabel: '10K', eventDate, location: 'X', finishSeconds, highlights: [], notes: [],
  });
  const context: SignalContext = {
    ...EMPTY_CONTEXT,
    sameSportDetailed: [race('a', '2026-04-19', 2675), race('b', '2024-04-20', 2770)],
    bestPerDistance: [{ canonicalDistance: '10K', raceName: 'Riverside 10K', finishSeconds: 2675, overallPercentile: 5, ageGroupPercentile: 5 }],
  };
  const prompt = buildSystemPrompt(context);
  assertStringIncludes(prompt, 'Riverside 10K (running, 10K, Apr 19, 2026, X)');
  assertStringIncludes(prompt, 'Riverside 10K (running, 10K, Apr 20, 2024, X)');
  // The personal-best line names which of the two same-named races it is.
  assertStringIncludes(prompt, '- 10K: Riverside 10K (Apr 19, 2026), 44:35');
  assertEquals(/\b2026-04-19\b/.test(prompt), false);
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
  assertStringIncludes(prompt, 'Do not use em dashes');
  assertStringIncludes(prompt, 'Separate observed facts from supported interpretation');
  assertStringIncludes(prompt, 'Do not invent causes or turn a result into an unsupported claim about fitness, course difficulty, or field strength');
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
    'Race duration is not evidence',
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
  assertStringIncludes(prompt, 'no visible self-correction');
  assertStringIncludes(prompt, 'no per-leg rankings');
  assertStringIncludes(prompt, 'Use the actual dates in the context');
  assertStringIncludes(prompt, 'ranked by absolute time');
  assertStringIncludes(prompt, 'Never mention how the numbers were produced');
  assertStringIncludes(prompt, 'Call a race the athlete');
  assertStringIncludes(prompt, 'largest first');
  assertStringIncludes(prompt, 'Count the races of a distance before saying');
  assertStringIncludes(prompt, 'never rank raw times, splits, or percentiles from different distances against each other as equivalent measures');
  // Cross-distance discussion is allowed when asked, with a stated scope; it is no longer a blanket ban.
  assertStringIncludes(prompt, 'Discuss another distance only when the athlete asks for it');
  assertStringIncludes(prompt, 'Stop at the answer');
  // First person, not a repeated third-person product name.
  assertStringIncludes(prompt, "I don't have your training volume");
  assertEquals(prompt.includes('no training data in RaceSignal'), false);
});

Deno.test('buildSystemPrompt — the screenshot reply keeps the labeled evidence section but leads with the answer', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, 'answers the question first');
  assertStringIncludes(prompt, 'compact section labeled "From your uploaded evidence"');
  // The section stays the complete factual record; the narrative above it is selective.
  assertStringIncludes(prompt, 'complete factual record for later turns');
  assertStringIncludes(prompt, 'Keep the narrative above it selective');
  assertStringIncludes(prompt, 'normalized power above average power means power varied during the ride');
  assertStringIncludes(prompt, 'Do not judge how hard, easy, solid, or demanding a ride or score was');
  // A difference between two screenshot figures is not supplied, so it is never presented as if it were.
  assertStringIncludes(prompt, 'is not in the image and is not computed for you');
  assertStringIncludes(prompt, 'Never put a derived difference in the evidence section');
  assertEquals(prompt.includes('uneven power'), false);
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

Deno.test('same-distance repeats — computed earlier to later, legs ranked by absolute size, only for repeated distances', () => {
  const tri = (id: string, name: string, date: string, finish: number, splits: [string, number][]) => ({
    id, name, sport: 'triathlon', distanceLabel: '70.3', eventDate: date, location: 'X', finishSeconds: finish,
    splits: splits.map(([label, elapsedSeconds]) => ({ label, elapsedSeconds })), highlights: [], notes: [],
  });
  const context: SignalContext = {
    ...EMPTY_CONTEXT,
    sameSportDetailed: [
      tri('b', 'Ridgeline 70.3', '2026-06-14', 17930, [['Swim', 2150], ['Bike', 9370], ['Run', 6090]]),
      tri('a', 'Coastal 70.3', '2025-09-14', 18580, [['Swim', 2200], ['Bike', 9680], ['Run', 6360]]),
      { id: 'c', name: 'Harbor Sprint', sport: 'triathlon', distanceLabel: 'Sprint Triathlon', eventDate: '2024-06-09', location: 'X', finishSeconds: 4560, highlights: [], notes: [] },
    ],
  };
  const prompt = buildSystemPrompt(context);
  assertStringIncludes(prompt, 'SAME-DISTANCE REPEATS');
  assertStringIncludes(
    prompt,
    '- 70.3: Coastal 70.3 (Sep 14, 2025) to Ridgeline 70.3 (Jun 14, 2026): finish 10:50 faster (5:09:40 to 4:58:50). Legs, largest difference first: Bike 5:10 faster (2:41:20 to 2:36:10); Run 4:30 faster (1:46:00 to 1:41:30); Swim 0:50 faster (36:40 to 35:50)',
  );
  // A distance raced once is not a repeat.
  assertEquals(prompt.split('SAME-DISTANCE REPEATS (already computed')[1]!.split('\n\n')[0]!.includes('Sprint'), false);
  // And with nothing repeated the section is absent.
  assertEquals(buildSystemPrompt(EMPTY_CONTEXT).includes('SAME-DISTANCE REPEATS (already computed'), false);
});
