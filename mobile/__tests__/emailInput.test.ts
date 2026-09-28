import { isPlausibleEmail, normalizeEmailInput } from '@/lib/emailInput';

describe('normalizeEmailInput', () => {
  it('strips a pasted "mailto:" prefix', () => {
    expect(normalizeEmailInput('mailto:reviewer@racesignal.app')).toBe('reviewer@racesignal.app');
  });

  it('strips the prefix case-insensitively', () => {
    expect(normalizeEmailInput('MAILTO:reviewer@racesignal.app')).toBe('reviewer@racesignal.app');
  });

  it('trims surrounding whitespace from a plain paste', () => {
    expect(normalizeEmailInput('  reviewer@racesignal.app  ')).toBe('reviewer@racesignal.app');
  });

  it('trims whitespace left behind after stripping the prefix', () => {
    expect(normalizeEmailInput('mailto: reviewer@racesignal.app ')).toBe('reviewer@racesignal.app');
  });

  it('leaves an already-clean address untouched', () => {
    expect(normalizeEmailInput('reviewer@racesignal.app')).toBe('reviewer@racesignal.app');
  });
});

describe('isPlausibleEmail', () => {
  it('accepts a normal address', () => {
    expect(isPlausibleEmail('reviewer@racesignal.app')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isPlausibleEmail('')).toBe(false);
  });

  it('rejects a string with no @ or no domain', () => {
    expect(isPlausibleEmail('not-an-email')).toBe(false);
    expect(isPlausibleEmail('reviewer@')).toBe(false);
  });
});
