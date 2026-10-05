// Synthetic fixtures only. Run with `deno test supabase/functions/signal/`.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  buildPredictionBasisFor,
  buildPredictionBases,
  describePredictionSpread,
  formatPredictionDuration,
  isPredictionSuggestionEligible,
  predictionDistanceKey,
  type PredictionRaceInput,
} from './racePrediction.ts';

const TODAY = '2026-10-05'; // window starts 2024-10-05 (inclusive)

let nextId = 0;
function done(name: string, date: string, seconds: number | null | undefined, distanceLabel = 'Olympic', sport = 'triathlon', id?: string): PredictionRaceInput {
  nextId += 1;
  return { id: id ?? `r${nextId}`, name, sport, distanceLabel, eventDate: date, status: 'completed', finishSeconds: seconds };
}
function upcoming(status: 'registered' | 'considering', date = '2027-06-14', distanceLabel = 'Olympic', sport = 'triathlon', id = 'target'): PredictionRaceInput {
  return { id, name: 'Target Race', sport, distanceLabel, eventDate: date, status };
}
const h = (hours: number, minutes: number, seconds: number) => hours * 3600 + minutes * 60 + seconds;
function basis(races: PredictionRaceInput[], target = upcoming('registered')) {
  const result = buildPredictionBasisFor([...races, target], target.id, TODAY);
  if (!result) throw new Error('no basis');
  return result;
}

Deno.test('range: two recent results give fastest, slowest and a precomputed spread; nothing else', () => {
  const b = basis([done('Riverside', '2026-08-17', h(2, 41, 55)), done('Harbor', '2025-07-06', h(2, 48, 20))]);
  assertEquals(b.kind, 'range');
  assertEquals(b.distance, 'Olympic');
  assertEquals([b.fastest?.name, b.fastest?.finishText], ['Riverside', '2:41:55']);
  assertEquals([b.slowest?.name, b.slowest?.finishText], ['Harbor', '2:48:20']);
  assertEquals(b.spreadSeconds, 385);
  assertEquals(b.spreadText, '6 minutes 25 seconds');
  assertEquals(b.recent.map((r) => r.name), ['Riverside', 'Harbor']); // most recent first
  assertEquals(Object.keys(b).sort(), ['distance', 'fastest', 'kind', 'olderReferences', 'raceDate', 'raceId', 'raceName', 'raceStatus', 'recent', 'slowest', 'spreadSeconds', 'spreadText']);
});

Deno.test('range: nearly identical and exactly identical results', () => {
  const near = basis([done('Spring Half', '2026-04-12', h(1, 44, 9), 'Half Marathon', 'running'), done('Harbor Half', '2025-11-09', h(1, 44, 31), 'half marathon', 'running')], upcoming('registered', '2027-04-01', 'Half Marathon', 'running'));
  assertEquals([near.kind, near.fastest?.finishText, near.slowest?.finishText, near.spreadText], ['range', '1:44:09', '1:44:31', '22 seconds']);
  const same = basis([done('A', '2026-04-12', 6000), done('B', '2025-11-09', 6000)]);
  assertEquals([same.kind, same.spreadSeconds, same.spreadText], ['range', 0, 'no difference']);
});

Deno.test('range: at most the five most recent recent results are used; a slower older-but-recent one is dropped', () => {
  const races = [
    done('r1', '2026-09-01', 9000), done('r2', '2026-07-01', 9100), done('r3', '2026-05-01', 9200), done('r4', '2026-03-01', 9300), done('r5', '2026-01-01', 9400),
    done('fastest-but-sixth', '2025-01-01', 8000),
  ];
  const b = basis(races);
  assertEquals(b.recent.length, 5);
  assertEquals(b.recent.map((r) => r.name), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assertEquals([b.fastest?.finishSeconds, b.slowest?.finishSeconds], [9000, 9400]);
});

Deno.test('window: 24 calendar months inclusive; one day outside is older', () => {
  const inside = basis([done('edge', '2024-10-05', 9000), done('other', '2026-06-01', 9100)]);
  assertEquals(inside.kind, 'range');
  const outside = basis([done('just-old', '2024-10-04', 9000), done('other', '2026-06-01', 9100)]);
  assertEquals(outside.kind, 'single');
  assertEquals(outside.olderReferences.map((r) => r.name), ['just-old']);
});

Deno.test('single: one recent result is a dated reference with older ones listed separately as older', () => {
  const b = basis([done('Recent', '2026-03-08', 9000), done('Old A', '2023-08-17', 9500), done('Old B', '2022-05-01', 9600)]);
  assertEquals(b.kind, 'single');
  assertEquals(b.recent.map((r) => r.name), ['Recent']);
  assertEquals(b.olderReferences.map((r) => [r.name, r.ageText]), [['Old A', 'over 3 years ago'], ['Old B', 'over 4 years ago']]);
  assertEquals(b.fastest, undefined);
  assertEquals(b.spreadSeconds, undefined);
});

Deno.test('older_only and none', () => {
  const older = basis([done('Old', '2023-08-17', 9500)]);
  assertEquals(older.kind, 'older_only');
  assertEquals(older.recent, []);
  assertEquals(older.olderReferences[0]?.monthsAgo, 37);
  assertEquals(basis([]).kind, 'none');
  // Other sport, other distance and no-time results are not comparable.
  const none = basis([done('Run', '2026-06-01', 9000, 'Half Marathon', 'running'), done('Sprint', '2026-06-01', 5000, 'Olympic', 'running'), done('NoTime', '2026-06-01', null)]);
  assertEquals(none.kind, 'none');
});

Deno.test('older results never enter a range, and older references are capped at three', () => {
  const races = [done('r1', '2026-06-01', 9000), done('r2', '2026-05-01', 9100), done('o1', '2023-01-01', 5000), done('o2', '2022-01-01', 5000), done('o3', '2021-01-01', 5000), done('o4', '2020-01-01', 5000)];
  const range = basis(races);
  assertEquals([range.kind, range.fastest?.finishSeconds, range.olderReferences], ['range', 9000, []]);
  const single = basis([done('r1', '2026-06-01', 9000), done('o1', '2023-01-01', 5000), done('o2', '2022-01-01', 5000), done('o3', '2021-01-01', 5000), done('o4', '2020-01-01', 5000)]);
  assertEquals(single.olderReferences.map((r) => r.name), ['o1', 'o2', 'o3']);
});

Deno.test('unusable data is excluded: no time, zero, negative, fractional, future, malformed date, not completed, other sport/distance', () => {
  const unusable: PredictionRaceInput[] = [
    done('null', '2026-06-01', null), done('undefined', '2026-06-01', undefined), done('zero', '2026-06-01', 0), done('negative', '2026-06-01', -5), done('fraction', '2026-06-01', 5400.5),
    done('future', '2026-10-06', 9000), done('future-year', '2027', 9000), done('bad-date', '2026-13-40', 9000), done('garbage', 'June', 9000),
    { ...done('registered', '2026-06-01', 9000), status: 'registered' }, { ...done('considering', '2026-06-01', 9000), status: 'considering' },
    done('running', '2026-06-01', 9000, 'Olympic', 'running'), done('70.3', '2026-06-01', 9000, '70.3'),
  ];
  assertEquals(basis(unusable).kind, 'none');
  // A usable one alongside them is the single reference; the unusable ones change nothing.
  assertEquals(basis([...unusable, done('good', '2026-06-01', 9000)]).recent.map((r) => r.name), ['good']);
  // Today itself is not in the future.
  assertEquals(basis([done('today', TODAY, 9000)]).kind, 'single');
});

Deno.test('year-only dates: recent only when the whole year is inside the window; described by year when older', () => {
  const twentyTwentyFive = basis([done('Y25', '2025', 9000), done('Day', '2026-01-01', 9100)]);
  assertEquals(twentyTwentyFive.kind, 'range'); // Jan 1 2025 is inside the window
  assertEquals(twentyTwentyFive.recent.find((r) => r.name === 'Y25')?.dateIsYearOnly, true);
  const twentyTwentyFour = basis([done('Y24', '2024', 9000)]);
  assertEquals(twentyTwentyFour.kind, 'older_only'); // Jan 1 2024 is before 2024-10-05
  assertEquals(twentyTwentyFour.olderReferences[0]?.ageText, 'recorded as 2024 only');
  assertEquals(twentyTwentyFour.olderReferences[0]?.monthsAgo, undefined);
});

Deno.test('duplicates: only identical name, date and time collapse; different events on the same date and time never do', () => {
  const collapsed = basis([done('Riverside Olympic', '2026-08-17', 9000), done('  riverside   olympic ', '2026-08-17', 9000)]);
  assertEquals(collapsed.kind, 'single'); // two records, one result
  assertEquals(collapsed.recent[0]?.recordCount, 2);
  const different = basis([done('Riverside Olympic', '2026-08-17', 9000), done('Harbor Olympic', '2026-08-17', 9000)]);
  assertEquals(different.kind, 'range');
  assertEquals(different.recent.map((r) => r.recordCount), [1, 1]);
  // Same event name and date but a different time might be two races: both kept.
  assertEquals(basis([done('Riverside Olympic', '2026-08-17', 9000), done('Riverside Olympic', '2026-08-17', 9100)]).kind, 'range');
});

Deno.test('targets: registered and considering get the same range; completed, past-dated and year-only targets get none', () => {
  const history = [done('a', '2026-06-01', 9000), done('b', '2026-03-01', 9100)];
  const registered = basis(history, upcoming('registered'));
  const considering = basis(history, upcoming('considering', '2027-06-14', 'Olympic', 'triathlon', 'c'));
  assertEquals([registered.kind, considering.kind], ['range', 'range']);
  assertEquals([registered.fastest?.finishSeconds, considering.slowest?.finishSeconds], [9000, 9100]);
  assertEquals(buildPredictionBasisFor([...history, upcoming('registered', '2026-10-04')], 'target', TODAY), null);
  assertEquals(buildPredictionBasisFor([...history, upcoming('registered', '2027')], 'target', TODAY), null);
  assertEquals(buildPredictionBases([...history, upcoming('registered', '2026-10-05')], TODAY).length, 1); // today counts
  assertEquals(buildPredictionBases([...history, { ...upcoming('registered'), status: 'completed' }], TODAY).length, 0);
  assertEquals(buildPredictionBases(history, 'not a date'), []);
});

Deno.test('targets: nearest five by date with a stable tie-break, plus an included seed beyond the cap', () => {
  const targets = ['2027-01-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01'].map((date, index) => upcoming('registered', date, 'Olympic', 'triathlon', `t${index}`));
  const ids = buildPredictionBases(targets, TODAY).map((b) => b.raceId);
  assertEquals(ids, ['t0', 't1', 't2', 't3', 't4']);
  assertEquals(buildPredictionBases(targets, TODAY, 't6').map((b) => b.raceId), ['t0', 't1', 't2', 't3', 't4', 't6']);
  assertEquals(buildPredictionBases(targets, TODAY, 'unknown').length, 5);
});

Deno.test('unsupported distances: no estimate, and never inferred from the event name', () => {
  for (const label of ['Sprint', 'Ironman', 'ironman', 'Custom — 2K/55K/15K', '', 'Standard']) {
    const history = [done('a', '2026-06-01', 9000, label), done('b', '2026-03-01', 9100, label)];
    const b = basis(history, upcoming('registered', '2027-06-14', label));
    assertEquals([label, b.kind, b.distance], [label, 'unsupported_distance', null]);
  }
  // A comparable-looking event name does not matter; only the label does.
  const named: PredictionRaceInput = { id: 'x', name: 'Half Marathon Classic', sport: 'running', distanceLabel: 'Fun Run', eventDate: '2027-03-01', status: 'registered' };
  assertEquals(buildPredictionBases([named, done('Half', '2026-03-01', 6000, 'Half Marathon', 'running')], TODAY)[0]?.kind, 'unsupported_distance');
  // An unrecognized past label never matches a recognized target either.
  assertEquals(basis([done('x', '2026-06-01', 9000, 'Sprint')], upcoming('registered')).kind, 'none');
});

Deno.test('distance table: standard distances, scoped by sport, whole-label matching only', () => {
  const cases: [string, string, string | null][] = [
    ['running', '5K', '5K'], ['running', ' 5 KM ', '5K'], ['running', '10km', '10K'], ['running', 'Half  Marathon', 'Half Marathon'], ['running', 'HALF-MARATHON', 'Half Marathon'],
    ['running', '21.1K', 'Half Marathon'], ['running', '13.1', 'Half Marathon'], ['running', 'Marathon', 'Marathon'], ['running', 'full marathon', 'Marathon'], ['running', '42.2 km', 'Marathon'], ['running', '26.2 miles', 'Marathon'],
    ['triathlon', 'Olympic', 'Olympic'], ['triathlon', 'Olympic Triathlon', 'Olympic'], ['triathlon', '70.3', '70.3'], ['triathlon', '70.3 Results', '70.3'], ['triathlon', 'Half Ironman', '70.3'],
    ['triathlon', '140.6', '140.6'], ['triathlon', 'Full Distance Triathlon', '140.6'], ['triathlon', 'full-distance triathlon', '140.6'], ['triathlon', 'Ironman 140.6', '140.6'],
    // not matched
    ['triathlon', 'Ironman', null], ['triathlon', 'Sprint', null], ['triathlon', 'Sprint Triathlon', null], ['triathlon', 'Long Course Triathlon', null],
    ['running', 'Half', null], ['running', 'Marathon Relay', null], ['running', 'Half Marathon - Men 40-44', null], ['running', 'Olympic', null], ['triathlon', 'Marathon', null], ['triathlon', '10K', null],
    ['cycling', '100K', null], ['duathlon', 'Standard', null], ['other', '5K', null], ['swimming', '5K', null], ['constructor', 'constructor', null],
  ];
  for (const [sport, label, expected] of cases) assertEquals([sport, label, predictionDistanceKey(sport, label)], [sport, label, expected]);
  // Marathon and half marathon are different groups.
  const half = basis([done('h1', '2026-06-01', 6000, 'Half Marathon', 'running'), done('h2', '2026-03-01', 6100, 'Half Marathon', 'running')], upcoming('registered', '2027-03-01', 'Marathon', 'running'));
  assertEquals(half.kind, 'none');
});

Deno.test('suggestion eligibility: registered upcoming race with at least two recent comparable results only', () => {
  const two = [done('a', '2026-06-01', 9000), done('b', '2026-03-01', 9100)];
  assertEquals(isPredictionSuggestionEligible([...two, upcoming('registered')], 'target', TODAY), true);
  assertEquals(isPredictionSuggestionEligible([...two, upcoming('considering')], 'target', TODAY), false);
  assertEquals(isPredictionSuggestionEligible([two[0]!, upcoming('registered')], 'target', TODAY), false);
  assertEquals(isPredictionSuggestionEligible([done('a', '2026-06-01', 9000), done('old', '2023-03-01', 9100), upcoming('registered')], 'target', TODAY), false);
  assertEquals(isPredictionSuggestionEligible([...two, upcoming('registered', '2026-10-04')], 'target', TODAY), false);
  assertEquals(isPredictionSuggestionEligible([...two, upcoming('registered', '2027-06-14', 'Sprint')], 'target', TODAY), false);
  assertEquals(isPredictionSuggestionEligible(two, 'missing', TODAY), false);
});

Deno.test('formatting helpers', () => {
  assertEquals([formatPredictionDuration(9715), formatPredictionDuration(2832), formatPredictionDuration(59)], ['2:41:55', '47:12', '0:59']);
  assertEquals([describePredictionSpread(1), describePredictionSpread(60), describePredictionSpread(3723), describePredictionSpread(7200), describePredictionSpread(0)], ['1 second', '1 minute', '1 hour 2 minutes 3 seconds', '2 hours', 'no difference']);
});

Deno.test('ordering is stable: equal dates break ties by id, and a leap-day today clamps the window', () => {
  const b = basis([done('B', '2026-06-01', 9000, 'Olympic', 'triathlon', 'idb'), done('A', '2026-06-01', 9100, 'Olympic', 'triathlon', 'ida')]);
  assertEquals(b.recent.map((r) => r.raceId), ['ida', 'idb']);
  // Window start for 2028-02-29 is 2026-02-28 (clamped), inclusive.
  const leap = buildPredictionBasisFor([upcoming('registered', '2028-06-01'), done('edge', '2026-02-28', 9000), done('before', '2026-02-27', 9100)], 'target', '2028-02-29');
  assertEquals([leap?.kind, leap?.recent.map((r) => r.name), leap?.olderReferences.map((r) => r.name)], ['single', ['edge'], ['before']]);
});
