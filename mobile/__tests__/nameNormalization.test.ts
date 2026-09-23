import { namesAreEquivalent, normalizeNameForComparison, normalizeNameForQuery } from '@/lib/nameNormalization';

describe('normalizeNameForComparison', () => {
  it('treats case, leading/trailing, and doubled internal whitespace as equivalent', () => {
    const variants = ['Cristian Villamarin', 'cristian villamarin', 'CRISTIAN VILLAMARIN', '  Cristian   Villamarin  '];
    const normalized = variants.map(normalizeNameForComparison);
    expect(new Set(normalized).size).toBe(1);
  });

  it('does not treat genuinely different names as equivalent', () => {
    expect(namesAreEquivalent('Cristian Villamarin', 'Cristian Andres Villamarin')).toBe(false);
  });
});

describe('normalizeNameForQuery', () => {
  it('trims and collapses whitespace but preserves the original casing for display/search', () => {
    expect(normalizeNameForQuery('  Cristian   Villamarin  ')).toBe('Cristian Villamarin');
    expect(normalizeNameForQuery('CRISTIAN VILLAMARIN')).toBe('CRISTIAN VILLAMARIN');
  });
});
