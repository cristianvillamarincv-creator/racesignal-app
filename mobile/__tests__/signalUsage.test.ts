import { formatSignalUsageLabel } from '@/lib/signalUsage';

describe('formatSignalUsageLabel', () => {
  it('labels a free-tier remaining count with "Free plan ·"', () => {
    expect(formatSignalUsageLabel(2, 3, false)).toBe('Free plan · 2 of 3 Signal asks left');
  });

  it('labels a premium remaining count with "Premium ·"', () => {
    expect(formatSignalUsageLabel(27, 40, true)).toBe('Premium · 27 of 40 Signal asks left');
  });

  it('handles zero remaining (the exhausted state that triggers the paywall)', () => {
    expect(formatSignalUsageLabel(0, 3, false)).toBe('Free plan · 0 of 3 Signal asks left');
  });
});
