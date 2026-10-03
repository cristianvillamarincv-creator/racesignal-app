import { runSocialSignIn, type SocialFlowDeps } from '@/lib/socialSignInFlow';

function makeDeps(overrides: Partial<SocialFlowDeps> = {}): SocialFlowDeps & Record<string, jest.Mock> {
  return {
    isReturningUserFlow: false,
    persistDraft: jest.fn().mockResolvedValue(undefined),
    signIn: jest.fn().mockResolvedValue({ status: 'success', userId: 'user-1' }),
    resumeReturningUser: jest.fn().mockResolvedValue(undefined),
    resumeFromDraftAndImport: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as SocialFlowDeps & Record<string, jest.Mock>;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('runSocialSignIn', () => {
  it('saves the pending selections BEFORE the provider sheet opens (draft recovery)', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      persistDraft: jest.fn(async () => void order.push('persist')),
      signIn: jest.fn(async () => {
        order.push('signIn');
        return { status: 'cancelled' } as const;
      }),
    });
    await runSocialSignIn('apple', deps);
    expect(order).toEqual(['persist', 'signIn']);
  });

  it('cancelling is silent: no error, no navigation, no import', async () => {
    const deps = makeDeps({ signIn: jest.fn().mockResolvedValue({ status: 'cancelled' }) });
    expect(await runSocialSignIn('google', deps)).toEqual({ kind: 'cancelled' });
    expect(deps.resumeReturningUser).not.toHaveBeenCalled();
    expect(deps.resumeFromDraftAndImport).not.toHaveBeenCalled();
  });

  it('outside the returning-user flow it resumes the saved draft (which recognises an already-completed account)', async () => {
    const deps = makeDeps();
    expect(await runSocialSignIn('apple', deps)).toEqual({ kind: 'signedIn' });
    expect(deps.resumeFromDraftAndImport).toHaveBeenCalledWith('user-1');
    expect(deps.resumeReturningUser).not.toHaveBeenCalled();
  });

  it('the "Already have an account? Sign in" flow always takes the returning-user path, without a completion lookup', async () => {
    const deps = makeDeps({ isReturningUserFlow: true });
    await runSocialSignIn('apple', deps);
    expect(deps.resumeReturningUser).toHaveBeenCalledWith('user-1');
    expect(deps.resumeFromDraftAndImport).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure message and does not navigate', async () => {
    const deps = makeDeps({ signIn: jest.fn().mockResolvedValue({ status: 'error', message: 'Apple sign-in did not complete.' }) });
    expect(await runSocialSignIn('apple', deps)).toEqual({ kind: 'error', message: 'Apple sign-in did not complete.' });
    expect(deps.resumeReturningUser).not.toHaveBeenCalled();
    expect(deps.resumeFromDraftAndImport).not.toHaveBeenCalled();
  });

  it('an unavailable provider points the athlete at email', async () => {
    const deps = makeDeps({ signIn: jest.fn().mockResolvedValue({ status: 'unavailable' }) });
    const outcome = await runSocialSignIn('google', deps);
    expect(outcome).toEqual({ kind: 'error', message: expect.stringMatching(/use your email/i) });
  });

  it('never leaves the athlete stuck if post-sign-in handling throws', async () => {
    const deps = makeDeps({ resumeFromDraftAndImport: jest.fn().mockRejectedValue(new Error('boom')) });
    expect(await runSocialSignIn('apple', deps)).toEqual({ kind: 'error', message: expect.stringMatching(/something went wrong/i) });
  });
});
