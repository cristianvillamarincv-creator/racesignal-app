import { formatSignalUsageLabel } from '@/lib/signalUsage';

describe('formatSignalUsageLabel', () => {
  it('labels a free-tier remaining count as "free Signal asks"', () => {
    expect(formatSignalUsageLabel(2, 3, false)).toBe('2 of 3 free Signal asks remaining this month');
  });

  it('labels a premium remaining count without the word "free"', () => {
    expect(formatSignalUsageLabel(27, 40, true)).toBe('27 of 40 Signal asks remaining this month');
  });

  it('handles zero remaining (the exhausted state that triggers the paywall)', () => {
    expect(formatSignalUsageLabel(0, 3, false)).toBe('0 of 3 free Signal asks remaining this month');
  });
});
