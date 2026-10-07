import { welcomeBackPendingCopy } from '@/lib/welcomeBackCopy';

describe('Welcome back screen copy', () => {
  it('uses the approved wording with a dynamic race count', () => {
    expect(welcomeBackPendingCopy(2)).toBe(
      'You selected 2 races that aren’t in your history yet. Review them and choose which to add, or skip to keep your race history unchanged. Your profile won’t change.',
    );
    expect(welcomeBackPendingCopy(5)).toContain('You selected 5 races that aren’t in your history yet.');
  });

  it('reads correctly for a single race', () => {
    expect(welcomeBackPendingCopy(1)).toBe(
      'You selected 1 race that isn’t in your history yet. Review it and choose whether to add it, or skip to keep your race history unchanged. Your profile won’t change.',
    );
  });
});
