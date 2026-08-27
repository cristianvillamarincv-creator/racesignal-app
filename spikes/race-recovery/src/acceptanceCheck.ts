import type { RaceCandidate } from './types.js';

/**
 * The manual benchmark from live browser testing (see B.0 conversation) — used only to check this
 * spike reproduces the same numbers programmatically. Not part of the reusable adapter; this file
 * exists purely as the one-time proof harness B.0 asked for.
 */
export const ANCHOR_BENCHMARKS = {
  torontoHalf2026: {
    eventQuery: 'Toronto Marathon',
    approximateYear: 2026,
    finishTime: '1:31:47',
    overallRank: { place: 330, field: 10576 },
    genderRank: { place: 26, field: 4700 },
    ageGroupRank: { place: 5, field: 467 },
  },
  barrelman2025: {
    eventQuery: 'Barrelman',
    approximateYear: 2025,
    finishTime: '2:47:34',
    ageGroupRank: { place: 2, field: 9 },
    splits: {
      swim: '0:33:18',
      bike: '1:25:06',
      run: '0:43:48',
    },
  },
} as const;

interface CheckResult {
  field: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/** Loose equality that tolerates a leading "0:" a benchmark string may or may not carry
 *  (e.g. "0:33:18" vs "33:18" would be a false mismatch otherwise). */
function timesMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const normalize = (t: string) => t.replace(/^0:/, '');
  return normalize(expected) === normalize(actual);
}

export function checkTorontoHalf(candidate: RaceCandidate): CheckResult[] {
  const b = ANCHOR_BENCHMARKS.torontoHalf2026;
  const d = candidate.detail;
  return [
    { field: 'finishTime', expected: b.finishTime, actual: d?.finishTime ?? '(missing)', pass: timesMatch(b.finishTime, d?.finishTime) },
    {
      field: 'overallRank',
      expected: `${b.overallRank.place}/${b.overallRank.field}`,
      actual: d?.overallRank ? `${d.overallRank.place}/${d.overallRank.field}` : '(missing)',
      pass: d?.overallRank?.place === b.overallRank.place && d?.overallRank?.field === b.overallRank.field,
    },
    {
      field: 'genderRank',
      expected: `${b.genderRank.place}/${b.genderRank.field}`,
      actual: d?.genderRank ? `${d.genderRank.place}/${d.genderRank.field}` : '(missing)',
      pass: d?.genderRank?.place === b.genderRank.place && d?.genderRank?.field === b.genderRank.field,
    },
    {
      field: 'ageGroupRank',
      expected: `${b.ageGroupRank.place}/${b.ageGroupRank.field}`,
      actual: d?.ageGroupRank ? `${d.ageGroupRank.place}/${d.ageGroupRank.field}` : '(missing)',
      pass: d?.ageGroupRank?.place === b.ageGroupRank.place && d?.ageGroupRank?.field === b.ageGroupRank.field,
    },
  ];
}

export function checkBarrelman(candidate: RaceCandidate): CheckResult[] {
  const b = ANCHOR_BENCHMARKS.barrelman2025;
  const d = candidate.detail;
  const swim = d?.splits.find((s) => s.label === 'Swim');
  const bike = d?.splits.find((s) => s.label === 'Bike');
  const run = d?.splits.find((s) => s.label === 'Run');

  return [
    { field: 'finishTime', expected: b.finishTime, actual: d?.finishTime ?? '(missing)', pass: timesMatch(b.finishTime, d?.finishTime) },
    {
      field: 'ageGroupRank',
      expected: `${b.ageGroupRank.place}/${b.ageGroupRank.field}`,
      actual: d?.ageGroupRank ? `${d.ageGroupRank.place}/${d.ageGroupRank.field}` : '(missing)',
      pass: d?.ageGroupRank?.place === b.ageGroupRank.place && d?.ageGroupRank?.field === b.ageGroupRank.field,
    },
    { field: 'swim split', expected: b.splits.swim, actual: swim?.splitTime ?? '(missing)', pass: timesMatch(b.splits.swim, swim?.splitTime) },
    { field: 'bike split', expected: b.splits.bike, actual: bike?.splitTime ?? '(missing)', pass: timesMatch(b.splits.bike, bike?.splitTime) },
    { field: 'run split', expected: b.splits.run, actual: run?.splitTime ?? '(missing)', pass: timesMatch(b.splits.run, run?.splitTime) },
  ];
}
