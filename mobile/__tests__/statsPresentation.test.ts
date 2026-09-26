import type { Race } from '@/fixtures/races';
import type { Highlight } from '@/lib/highlights';
import { isDistanceCanonicalForStats, isHighlightCanonicalForStats } from '@/lib/statsPresentation';

// isHighlightCanonicalForStats only reads `highlight.label` — the race/icon/value fields are
// irrelevant to the logic under test, so a minimal stand-in is enough and keeps these synthetic
// fixtures focused on exactly the malformed/noncanonical labels this rule needs to prove against.
function highlight(label: string): Highlight {
  return { race: {} as Race, icon: 'trophy', label };
}

describe('isDistanceCanonicalForStats', () => {
  it('accepts every recognized standard distance', () => {
    for (const label of ['5K', '10K', '15K', 'Half Marathon', 'Marathon', 'Sprint', 'Olympic', '70.3', '140.6']) {
      expect(isDistanceCanonicalForStats(label)).toBe(true);
    }
  });

  it('rejects synthetic malformed/noncanonical distance labels, proving the rule works even though today\'s real fixture data never surfaces one', () => {
    expect(isDistanceCanonicalForStats('Infinite Mile')).toBe(false);
    expect(isDistanceCanonicalForStats('Overall Results')).toBe(false);
    expect(isDistanceCanonicalForStats('Custom — 2K/55K/15K')).toBe(false);
  });
});

describe('isHighlightCanonicalForStats', () => {
  it('excludes a PR highlight tied to a synthetic malformed/noncanonical category', () => {
    expect(isHighlightCanonicalForStats(highlight('Infinite Mile PR'))).toBe(false);
    expect(isHighlightCanonicalForStats(highlight('Overall Results PR'))).toBe(false);
  });

  it('excludes a "PR Performance" highlight tied to a noncanonical category', () => {
    expect(isHighlightCanonicalForStats(highlight('Infinite Mile PR Performance'))).toBe(false);
  });

  it('excludes a "First recorded" highlight tied to a noncanonical category', () => {
    expect(isHighlightCanonicalForStats(highlight('First recorded Infinite Mile'))).toBe(false);
  });

  it('keeps a PR highlight tied to a canonical category', () => {
    expect(isHighlightCanonicalForStats(highlight('70.3 PR'))).toBe(true);
    expect(isHighlightCanonicalForStats(highlight('10K PR Performance'))).toBe(true);
    expect(isHighlightCanonicalForStats(highlight('First recorded Olympic'))).toBe(true);
  });

  it('never touches a legitimate non-distance highlight, even one that happens to reference a noncanonical race', () => {
    // These are the highlight types the product owner explicitly wants preserved — none of them
    // match the PR/PR Performance/First recorded label shapes, so the distance-allowlist check
    // must never run against them at all.
    expect(isHighlightCanonicalForStats(highlight('Age-group podium'))).toBe(true);
    expect(isHighlightCanonicalForStats(highlight('Notable age-group finish'))).toBe(true);
    expect(isHighlightCanonicalForStats(highlight('Course best — Some Race'))).toBe(true);
    expect(isHighlightCanonicalForStats(highlight('Fastest Infinite Mile bike'))).toBe(true);
  });
});
