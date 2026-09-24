import { daysUntil, formatCountdown, formatFinishTime, formatRelativeDate } from '@/lib/format';

describe('daysUntil', () => {
  const today = new Date(2026, 5, 12); // June 12, 2026 (month is 0-indexed)

  it('returns a positive count for a future date', () => {
    expect(daysUntil('2026-07-23', today)).toBe(41);
  });

  it('returns 0 for today', () => {
    expect(daysUntil('2026-06-12', today)).toBe(0);
  });

  it('returns a negative count for a past date', () => {
    expect(daysUntil('2026-06-01', today)).toBe(-11);
  });
});

describe('formatCountdown', () => {
  it('labels today and tomorrow specially', () => {
    expect(formatCountdown(0)).toBe('Today');
    expect(formatCountdown(1)).toBe('Tomorrow');
  });

  it('shows a day count further out', () => {
    expect(formatCountdown(41)).toBe('41 days');
  });

  it('labels past dates as completed', () => {
    expect(formatCountdown(-3)).toBe('Completed');
  });
});

describe('formatFinishTime', () => {
  it('formats times under an hour as M:SS', () => {
    expect(formatFinishTime(38 * 60 + 18)).toBe('38:18');
  });

  it('formats times over an hour as H:MM:SS', () => {
    expect(formatFinishTime(5 * 3600 + 41 * 60 + 18)).toBe('5:41:18');
  });

  it('pads minutes and seconds', () => {
    expect(formatFinishTime(3600 + 5 * 60 + 9)).toBe('1:05:09');
  });
});

describe('formatRelativeDate', () => {
  const now = new Date(2026, 5, 12, 12, 0, 0); // June 12, 2026, noon

  it('labels a timestamp under a minute old as "Just now"', () => {
    expect(formatRelativeDate(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('Just now');
  });

  it('shows minutes for under an hour', () => {
    expect(formatRelativeDate(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5m ago');
  });

  it('shows hours for under a day', () => {
    expect(formatRelativeDate(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
  });

  it('labels exactly one day old as "Yesterday"', () => {
    expect(formatRelativeDate(new Date(now.getTime() - 24 * 3_600_000).toISOString(), now)).toBe('Yesterday');
  });

  it('shows days for under a week', () => {
    expect(formatRelativeDate(new Date(now.getTime() - 4 * 24 * 3_600_000).toISOString(), now)).toBe('4d ago');
  });
});
