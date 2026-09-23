import type { Race } from '@/fixtures/races';
import { getAllHighlightsUnfiltered, getHighlightsForRace } from '@/lib/highlights';

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
