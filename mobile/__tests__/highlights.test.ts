import type { Race } from '@/fixtures/races';
import {
  canonicalDistanceLabel,
  getAllHighlightsUnfiltered,
  getDistancePRStatuses,
  getFastestSplitHighlights,
  getHighlightsForRace,
} from '@/lib/highlights';

/** Minimal synthetic race — only the fields the highlight computations actually read. */
function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'distanceLabel'>): Race {
  return {
    name: overrides.id,
    sport: 'triathlon',
    location: 'Test City',
    status: 'completed',
    locked: false,
    ...overrides,
  };
}

describe('getAllHighlightsUnfiltered — ranking-dimension dedup', () => {
  it('suppresses a notable-AG-percentile highlight for a race that already has an AG podium (same dimension)', () => {
    // Bracebridge-style case: AG 2/24 is both a podium AND a Top 9% percentile — only the podium
    // (the more specific fact) should surface, not both, since they describe the same AG ranking.
    const bracebridge = race({
      id: 'bracebridge-2026',
      eventDate: '2026-07-12',
      distanceLabel: 'Olympic',
      result: {
        finishSeconds: 9000,
        splits: [],
        sourceStatus: 'imported_confirmed',
        ageGroupRank: { place: 2, field: 24 },
      },
    });

    const highlights = getHighlightsForRace([bracebridge], bracebridge.id);
    const labels = highlights.map((h) => h.label);

    expect(labels).toContain('Age-group podium');
    expect(labels).not.toContain('Notable age-group finish');
  });

  it('still surfaces a notable-AG-percentile highlight for a race with a strong AG percentile but no podium', () => {
    const toronto = race({
      id: 'toronto-half-2026',
      eventDate: '2026-05-03',
      distanceLabel: 'Half Marathon',
      result: {
        finishSeconds: 5216,
        splits: [],
        sourceStatus: 'imported_confirmed',
        ageGroupRank: { place: 17, field: 704 },
      },
    });

    const highlights = getAllHighlightsUnfiltered([toronto]);
    const labels = highlights.map((h) => h.label);

    expect(labels).not.toContain('Age-group podium');
    expect(labels).toContain('Notable age-group finish');
  });
});

describe('canonicalDistanceLabel', () => {
  it('maps category variants actually observed in real data to one canonical label', () => {
    expect(canonicalDistanceLabel('10k')).toBe('10K');
    expect(canonicalDistanceLabel('10km')).toBe('10K');
    expect(canonicalDistanceLabel('5 km')).toBe('5K');
    expect(canonicalDistanceLabel('70.3')).toBe('70.3');
    expect(canonicalDistanceLabel('70.3 Results')).toBe('70.3');
    expect(canonicalDistanceLabel('Olympic')).toBe('Olympic');
    expect(canonicalDistanceLabel('Olympic Triathlon')).toBe('Olympic');
  });

  it('matches case-insensitively', () => {
    expect(canonicalDistanceLabel('OLYMPIC TRIATHLON')).toBe('Olympic');
    expect(canonicalDistanceLabel('10KM')).toBe('10K');
  });

  it('passes an unrecognized label through unchanged rather than guessing', () => {
    // "Long Course Triathlon" is real data too, but nothing confirms it's 70.3-equivalent —
    // merging it on a guess is exactly what this function must never do.
    expect(canonicalDistanceLabel('Long Course Triathlon')).toBe('Long Course Triathlon');
    expect(canonicalDistanceLabel('Half Marathon')).toBe('Half Marathon');
  });
});

describe('getDistancePRStatuses — category alias normalization (real-data regression)', () => {
  it('never lets a "10k" entry become the PB when a faster "10km" race exists — only the true fastest wins', () => {
    // The actual reported bug: a manual "10k" race (50:40, in 2026) and a real "10km" personal
    // best (40:39, in 2025) were grouped separately by raw label, so the slower one trivially
    // "won" its own lone group whenever 2026 was the active filter.
    const fasterReal = race({
      id: 'faster-10km-2025',
      eventDate: '2025-06-01',
      distanceLabel: '10km',
      result: { finishSeconds: 2439, splits: [], sourceStatus: 'imported_confirmed' }, // 40:39
    });
    const slowerManual = race({
      id: 'slower-10k-2026',
      eventDate: '2026-01-01',
      distanceLabel: '10k',
      result: { finishSeconds: 3040, splits: [], sourceStatus: 'self_reported' }, // 50:40
    });

    const statuses = getDistancePRStatuses([fasterReal, slowerManual]);
    const faster = statuses.find((s) => s.race.id === 'faster-10km-2025')!;
    const slower = statuses.find((s) => s.race.id === 'slower-10k-2026')!;

    expect(faster.groupKey).toBe('10K');
    expect(slower.groupKey).toBe('10K');
    expect(faster.isCurrentPB).toBe(true);
    expect(slower.isCurrentPB).toBe(false);
  });

  it('groups "Olympic" and "Olympic Triathlon" races together under one canonical key', () => {
    const sportstats = race({
      id: 'olympic-triathlon',
      eventDate: '2025-07-01',
      distanceLabel: 'Olympic Triathlon',
      result: { finishSeconds: 9043, splits: [], sourceStatus: 'imported_confirmed' },
    });
    const manual = race({
      id: 'olympic-manual',
      eventDate: '2021-01-01',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 9200, splits: [], sourceStatus: 'self_reported' },
    });

    const statuses = getDistancePRStatuses([sportstats, manual]);
    expect(new Set(statuses.map((s) => s.groupKey))).toEqual(new Set(['Olympic']));
  });
});

describe('getFastestSplitHighlights — category alias normalization (real-data regression)', () => {
  it('compares "70.3" and "70.3 Results" races in one pool, so a slower run never wins the label', () => {
    // The actual reported bug: Eagleman ("70.3") and Subaru IRONMAN 70.3 Victoria ("70.3
    // Results") were compared in separate, isolated pools of one, so Victoria's much slower run
    // trivially "won" a pool that never actually contained Eagleman's real (faster) run.
    const eagleman = race({
      id: 'eagleman',
      eventDate: '2026-06-14',
      distanceLabel: '70.3',
      result: {
        finishSeconds: 17698,
        sourceStatus: 'imported_confirmed',
        splits: [{ label: 'Run', elapsedSeconds: 5854 }],
      },
    });
    const victoria = race({
      id: 'victoria',
      eventDate: '2022-06-26',
      distanceLabel: '70.3 Results',
      result: {
        finishSeconds: 20645,
        sourceStatus: 'imported_confirmed',
        splits: [{ label: 'Run', elapsedSeconds: 7200 }],
      },
    });

    // Empty currentPBRaceIds: isolates the grouping/comparison behavior itself, independent of
    // the separate "already-the-PB" suppression rule.
    const highlights = getFastestSplitHighlights([eagleman, victoria], new Set());
    const runHighlight = highlights.find((h) => h.label.endsWith('run'));

    expect(runHighlight?.label).toBe('Fastest 70.3 run');
    expect(runHighlight?.race.id).toBe('eagleman');
    expect(highlights.some((h) => h.race.id === 'victoria')).toBe(false);
  });
});
