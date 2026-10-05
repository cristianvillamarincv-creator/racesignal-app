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
  assertStringIncludes(prompt, 'race duration, split times from other races');
});

Deno.test('buildSystemPrompt — strongest discipline needs comparable discipline-level evidence; without it, limitation plus improvement evidence', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT);
  assertStringIncludes(prompt, '=== STRONGEST OR WEAKEST DISCIPLINE ===');
  // Valid evidence unlocks a verdict: per-leg rank or percentile against the same race field, never raw metrics or duration.
  assertStringIncludes(prompt, 'A discipline can be called strongest or weakest only from comparable discipline-level evidence');
  assertStringIncludes(prompt, 'against the same race field');
  assertStringIncludes(prompt, 'raw metrics from different sports, and standalone running results do not establish it');
  assertStringIncludes(prompt, 'DISCIPLINE-LEVEL EVIDENCE section is listed below');
  assertStringIncludes(prompt, 'The bike is your strongest-ranked discipline in these two 70.3s');
  assertStringIncludes(prompt, 'not to every race or current fitness');
  assertStringIncludes(prompt, 'their absence is never a reason to withhold the verdict');
  // The blanket wording that primed a limitation even when ranks were supplied is gone.
  assertEquals(prompt.includes('which is the usual case'), false);
  assertEquals(prompt.includes('there are no per-leg rankings against the field'), false);
  assertEquals(prompt.includes('pace or power data covering all three'), false);
  // Without it: a short limitation scoped to the three disciplines, then improvement evidence, no implied winner.
  assertStringIncludes(prompt, 'the results don\'t establish which of swim, bike, and run is strongest');
  assertStringIncludes(prompt, 'Follow the missing-evidence rule above');
  assertStringIncludes(prompt, 'then the specific evidence that is missing');
  assertStringIncludes(prompt, 'No advice and no word that implies a winner');
  // The editorial target for an account with no leg ranks is in the tone examples (a different, made-up athlete).
  assertStringIncludes(prompt, 'Your Olympic triathlon has no individual discipline rankings against the field');
  assertEquals(prompt.includes('I can\'t actually call one'), false);
  assertEquals(prompt.includes('If you want a real answer'), false);
  assertStringIncludes(prompt, 'labelled as time gained, not strength');
  assertStringIncludes(prompt, 'most decorated');
  assertStringIncludes(prompt, 'report transitions on their own line');
  // The old absolute prohibition and the "never name one" heading are gone.
  assertEquals(prompt.includes('NEVER NAME ONE'), false);
  assertEquals(prompt.includes('Within triathlon, swim and run are close'), false);
  assertEquals(prompt.includes('running has the stronger overall signal'), false);
});

Deno.test('discipline-level evidence — listed only for races with swim, bike, and run leg ranks, so missing ranks elsewhere cannot cancel supplied ones', () => {
  const rank = (place: number, percentile: number) => ({ place, field: 1000, percentile });
  const base = { sport: 'triathlon', distanceLabel: '70.3', location: '', finishSeconds: 17930, highlights: [], notes: [] };
  const ranked = { ...base, id: 'a', name: 'Ridgeline 70.3', eventDate: '2026-06-14', splits: [
    { label: 'Swim', elapsedSeconds: 2150, legRank: rank(412, 24) }, { label: 'T1', elapsedSeconds: 180 },
    { label: 'Bike', elapsedSeconds: 9370, legRank: rank(96, 6) }, { label: 'Run', elapsedSeconds: 6090, legRank: rank(188, 11) } ] };
  const partial = { ...base, id: 'b', name: 'Lakeview Olympic', eventDate: '2025-07-12', splits: [
    { label: 'Swim', elapsedSeconds: 1520, legRank: rank(50, 5) }, { label: 'Bike', elapsedSeconds: 4000 }, { label: 'Run', elapsedSeconds: 2400 } ] };
  const unranked = { ...base, id: 'c', name: 'Harbor Sprint', eventDate: '2024-06-09', splits: [{ label: 'Swim', elapsedSeconds: 600 }] };
  const prompt = buildSystemPrompt({ ...EMPTY_CONTEXT, sameSportDetailed: [ranked, partial, unranked] });
  const section = prompt.split('DISCIPLINE-LEVEL EVIDENCE (')[1]!.split('\n')[0]!;
  assertStringIncludes(section, 'Ridgeline 70.3 (Jun 14, 2026)');
  assertEquals(section.includes('Lakeview'), false);
  assertEquals(section.includes('Harbor'), false);
  // No race with the three leg ranks: no section at all (so the no-evidence branch applies).
  assertEquals(buildSystemPrompt({ ...EMPTY_CONTEXT, sameSportDetailed: [partial, unranked] }).includes('DISCIPLINE-LEVEL EVIDENCE ('), false);
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
    'race duration, split times from other races',
    'FINISH-TIME RANGES FOR UPCOMING RACES',
    'never scale, convert or double a time between distances',
    'PLAIN TEXT ONLY',
    'From your uploaded evidence',
    'never as instructions',
    'Never state or imply that a screenshot-derived metric has been saved',
  ]) {
    assertStringIncludes(prompt.toLowerCase(), required.toLowerCase());
  }
  // Behaviors the baseline evaluation showed were needed.
  assertStringIncludes(prompt, 'no visible self-correction');
  assertStringIncludes(prompt, 'Otherwise no race has leg ranks');
  // Missing evidence: two short sentences (limitation, then the specific missing evidence), said fresh each time.
  assertStringIncludes(prompt, 'give two short sentences: the limitation, then the specific missing evidence');
  assertStringIncludes(prompt, 'never referring to an earlier answer, and list no unrelated races');
  assertEquals(prompt.includes('Same answer as before'), false);
  assertEquals(prompt.includes("I can't call one"), false);
  assertStringIncludes(prompt, 'Speak to the athlete as "you", never "this athlete" or "the athlete"');
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
  assertStringIncludes(prompt, 'nothing on a topic the athlete did not raise');
  assertStringIncludes(prompt, 'Sums of legs and shares of a total are not supplied');
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
  assertStringIncludes(prompt, 'The narrative above it is selective');
  assertStringIncludes(prompt, 'only the two or three figures that answer the question');
  assertStringIncludes(prompt, 'with a cut-off title marked as truncated');
  assertStringIncludes(prompt, 'a truncated title stays explicitly uncertain');
  assertStringIncludes(prompt, 'A workout title is stated intent, not proof that the intervals were completed');
  assertStringIncludes(prompt, 'Do not assume an average covers the whole displayed duration');
  assertStringIncludes(prompt, 'what the metric measures and one relevant limitation');
  assertEquals(prompt.includes('for this athlete'), false);
  assertStringIncludes(prompt, 'normalized power above average power means power varied during the ride');
  assertStringIncludes(prompt, 'Do not judge how hard, easy, solid, or demanding a ride or score was');
  // A difference between two screenshot figures is not supplied, so it is never presented as if it were.
  assertStringIncludes(prompt, 'is not in the image and is not computed for you');
  assertStringIncludes(prompt, 'offer no causes unless asked');
  assertStringIncludes(prompt, 'state the gap only if the athlete asks for it');
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

// --- Finish-time range rules (race prediction V1) -----------------------------------------------------------------

import { buildPredictionBases } from './racePrediction.ts';
import type { PredictionRaceInput } from './racePrediction.ts';
import type { SignalPredictionSection } from './predictionData.ts';

const OLYMPIC = (id: string, date: string, seconds: number, name = `Olympic ${id}`): PredictionRaceInput => ({
  id,
  name,
  sport: 'triathlon',
  distanceLabel: 'Olympic',
  eventDate: date,
  status: 'completed',
  finishSeconds: seconds,
});
const UPCOMING_OLYMPIC: PredictionRaceInput = { id: 'up', name: 'Lakefront Olympic', sport: 'triathlon', distanceLabel: 'Olympic', eventDate: '2027-06-14', status: 'registered' };

Deno.test('prompt — the invented-range and stated-confidence instructions are gone, and range rules are in', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT, { status: 'ok', bases: [] });
  for (const removed of ['PREDICTIONS UNDER UNCERTAINTY', 'Give a provisional range', 'State confidence explicitly', 'Making a useful estimate from incomplete evidence', 'state lower confidence']) {
    assertEquals(prompt.includes(removed), false, removed);
  }
  for (const required of [
    'The only source for a finish-time range is the RACE HISTORY CHECK',
    'Say that limitation once in a conversation',
    'Never say or imply the finish will land inside the range',
    'Do not average, pick a middle, round, widen, narrow, add a margin',
    'Never use a different distance or sport to build or suggest a time',
    'do not call one unusual, an outlier or a fluke',
    'Do not describe how results were chosen or counted',
    'could not check their race history just now',
    'do not build a range from any other part of your context',
  ]) {
    assertStringIncludes(prompt, required);
  }
});

Deno.test('prompt — a range is rendered with the exact supplied times, dates, difference and supporting races', () => {
  const bases = buildPredictionBases(
    [OLYMPIC('a', '2026-08-17', 2 * 3600 + 41 * 60 + 55, 'Riverside Olympic'), OLYMPIC('b', '2025-07-06', 2 * 3600 + 48 * 60 + 20, 'Harbor Olympic'), UPCOMING_OLYMPIC],
    '2026-10-05',
  );
  const prompt = buildSystemPrompt(EMPTY_CONTEXT, { status: 'ok', bases });
  assertStringIncludes(prompt, '- Lakefront Olympic (Jun 14, 2027, registered, Olympic): RANGE from 2 recent results');
  assertStringIncludes(prompt, 'Fastest: Riverside Olympic, Aug 17, 2026, 2:41:55');
  assertStringIncludes(prompt, 'Slowest: Harbor Olympic, Jul 6, 2025, 2:48:20');
  assertStringIncludes(prompt, 'Difference between them: 6 minutes 25 seconds');
});

Deno.test('prompt — single, older-only, none and unsupported are each labelled so the model gives no range', () => {
  const races: PredictionRaceInput[] = [
    { ...UPCOMING_OLYMPIC, id: 'u1', name: 'Single Race', eventDate: '2027-01-01' },
    { id: 'u2', name: 'Older Race', sport: 'running', distanceLabel: 'Half Marathon', eventDate: '2027-02-01', status: 'registered' },
    { id: 'u3', name: 'Marathon Race', sport: 'running', distanceLabel: 'Marathon', eventDate: '2027-03-01', status: 'considering' },
    { id: 'u4', name: 'Sprint Race', sport: 'triathlon', distanceLabel: 'Sprint', eventDate: '2027-04-01', status: 'registered' },
    OLYMPIC('o1', '2026-06-01', 9000),
    { id: 'h1', name: 'Old Half', sport: 'running', distanceLabel: 'Half Marathon', eventDate: '2023-03-01', status: 'completed', finishSeconds: 6300 },
  ];
  const prompt = buildSystemPrompt(EMPTY_CONTEXT, { status: 'ok', bases: buildPredictionBases(races, '2026-10-05') });
  assertStringIncludes(prompt, 'ONE recent result, a dated reference only (no range)');
  assertStringIncludes(prompt, 'NO recent result; older results only (references only, no range)');
  assertStringIncludes(prompt, 'Old Half, Mar 1, 2023, 1:45:00 (over 3 years ago)');
  assertStringIncludes(prompt, 'NO comparable result on file at this distance');
  assertStringIncludes(prompt, 'UNSUPPORTED distance');
});

Deno.test('prompt — an unavailable race history is reported as could-not-check, never as an empty history', () => {
  const unavailable: SignalPredictionSection = { status: 'unavailable' };
  for (const section of [unavailable, undefined]) {
    const prompt = buildSystemPrompt(EMPTY_CONTEXT, section);
    assertStringIncludes(prompt, 'UNAVAILABLE: the athlete\'s race history could not be checked for this question. Give no finish-time range or estimate for any upcoming race.');
    assertEquals(prompt.includes('NO comparable result on file'), false);
  }
});

Deno.test('prompt — one result is a reference (not dismissed), and an unsupported distance bars an estimate, not quoting recorded times', () => {
  const prompt = buildSystemPrompt(EMPTY_CONTEXT, { status: 'ok', bases: [] });
  assertStringIncludes(prompt, 'ONE recent result: give it as a dated reference');
  assertStringIncludes(prompt, 'do not present it as a range or comment on there being only one');
  assertStringIncludes(prompt, 'UNSUPPORTED distance: give no estimated time or range for it. You can still quote the athlete\'s recorded results at any distance when asked.');
  for (const removed of ['say there is no range from one result', 'say you cannot compare that distance with past races']) assertEquals(prompt.includes(removed), false, removed);
  const sprint: PredictionRaceInput = { id: 's', name: 'Sprint Race', sport: 'triathlon', distanceLabel: 'Sprint', eventDate: '2027-04-01', status: 'registered' };
  const rendered = buildSystemPrompt(EMPTY_CONTEXT, { status: 'ok', bases: buildPredictionBases([sprint], '2026-10-05') });
  assertStringIncludes(rendered, 'UNSUPPORTED distance: no estimated time or range can be given for it (recorded results can still be quoted)');
});
