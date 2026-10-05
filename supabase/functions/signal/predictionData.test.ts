// Synthetic fixtures and a fake query client; no network, no database. Run with `deno test --allow-read=.`
// (the last test reads index.ts to pin the trust boundary).

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { loadPredictionSection, rowToPredictionRace, utcToday, type PredictionQueryClient, type PredictionRaceRow } from './predictionData.ts';
import { buildSystemPrompt } from './systemPrompt.ts';

const row = (overrides: Partial<PredictionRaceRow>): PredictionRaceRow => ({
  id: 'r',
  event_name: 'Race',
  sport: 'triathlon',
  category: 'Olympic',
  race_status: 'completed',
  event_date: '2026-06-01',
  event_year: 2026,
  date_precision: 'day',
  finish_seconds: 9000,
  ...overrides,
});

function fakeClient(result: { data: unknown[] | null; error: { message: string } | null } | 'throw') {
  const calls: { table?: string; columns?: string; filters: [string, string][] } = { filters: [] };
  const client: PredictionQueryClient = {
    from(table) {
      calls.table = table;
      return {
        select(columns) {
          calls.columns = columns;
          return {
            eq(column, value) {
              calls.filters.push([column, value]);
              return {
                eq(column2, value2) {
                  calls.filters.push([column2, value2]);
                  if (result === 'throw') throw new Error('boom');
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

Deno.test('rows map onto the shared shape: day precision keeps the day, year-only keeps just the year, nulls become safe defaults', () => {
  assertEquals(rowToPredictionRace(row({})).eventDate, '2026-06-01');
  assertEquals(rowToPredictionRace(row({ date_precision: 'year', event_date: null, event_year: 2018 })).eventDate, '2018');
  const blank = rowToPredictionRace(row({ sport: null, category: null, finish_seconds: null }));
  assertEquals([blank.sport, blank.distanceLabel, blank.finishSeconds], ['other', '', null]);
});

Deno.test('the loader reads only the signed-in athlete\'s confirmed races and only the columns it needs', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  await loadPredictionSection(client, 'athlete-1', undefined, '2026-10-05');
  assertEquals(calls.table, 'races');
  assertEquals(calls.filters, [['athlete_id', 'athlete-1'], ['import_status', 'confirmed']]);
  for (const sensitive of ['splits', 'bib', 'source_notes', 'overall_rank', 'provider_athlete_name']) assertEquals(calls.columns?.includes(sensitive), false, sensitive);
});

Deno.test('stored races become bases from the shared calculation, with the seed race kept beyond the cap', async () => {
  const rows = [
    row({ id: 'a', event_name: 'Riverside', event_date: '2026-08-17', finish_seconds: 9715 }),
    row({ id: 'b', event_name: 'Harbor', event_date: '2025-07-06', finish_seconds: 10100 }),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `t${index}`, event_name: `Target ${index}`, race_status: 'registered', event_date: `2027-0${index + 1}-01`, finish_seconds: null })),
  ];
  const { client } = fakeClient({ data: rows, error: null });
  const section = await loadPredictionSection(client, 'athlete-1', 't5', '2026-10-05');
  if (section.status !== 'ok') throw new Error('expected ok');
  assertEquals(section.bases.length, 6);
  assertEquals(section.bases[0]?.kind, 'range');
  assertEquals(section.bases.at(-1)?.raceId, 't5');
});

Deno.test('a failed or thrown race load is "unavailable", never an empty history, and it never produces a range', async () => {
  for (const result of [{ data: null, error: { message: 'timeout' } }, { data: null, error: null }, 'throw' as const]) {
    const { client } = fakeClient(result);
    const section = await loadPredictionSection(client, 'athlete-1', undefined, '2026-10-05');
    assertEquals(section, { status: 'unavailable' });
    const prompt = buildSystemPrompt({ sameSportDetailed: [], otherSportsCompact: [], upcoming: [], bestPerDistance: [] }, section);
    assertStringIncludes(prompt, 'race history could not be checked');
    assertEquals(prompt.includes('NO comparable result on file'), false);
    assertEquals(prompt.includes('RANGE from'), false);
  }
});

Deno.test('a successful load with no upcoming races is a different message from an unavailable load', async () => {
  const { client } = fakeClient({ data: [row({})], error: null });
  const section = await loadPredictionSection(client, 'athlete-1', undefined, '2026-10-05');
  assertEquals(section, { status: 'ok', bases: [] });
  const prompt = buildSystemPrompt({ sameSportDetailed: [], otherSportsCompact: [], upcoming: [], bestPerDistance: [] }, section);
  assertStringIncludes(prompt, 'no upcoming race with a date of today or later is on file to check');
});

Deno.test('utcToday is the UTC calendar date', () => {
  assertEquals(utcToday(new Date('2026-10-05T23:59:59Z')), '2026-10-05');
  assertEquals(utcToday(new Date('2026-10-06T00:00:00Z')), '2026-10-06');
});

Deno.test('index.ts derives the section on the server and never reads a client-supplied range', async () => {
  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertStringIncludes(source, 'loadPredictionSection(client, user.id, context.seedRace?.id)');
  assertStringIncludes(source, 'buildSystemPrompt(context, prediction)');
  for (const forbidden of ['body.prediction', 'context.prediction', 'body.range', 'predictionBasis']) assertEquals(source.includes(forbidden), false, forbidden);
});
