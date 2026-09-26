import { shouldAutoSubmitInitialPrompt } from '@/lib/signalInitialPrompt';

describe('shouldAutoSubmitInitialPrompt', () => {
  it('submits when a prompt is present and nothing else is going on', () => {
    expect(
      shouldAutoSubmitInitialPrompt({
        initialPrompt: 'Have I been improving year over year?',
        conversationIdParam: undefined,
        alreadySubmitted: false,
      }),
    ).toBe(true);
  });

  it('does not submit when there is no prompt (the generic "Ask Signal anything" / next-race entry points)', () => {
    expect(
      shouldAutoSubmitInitialPrompt({ initialPrompt: undefined, conversationIdParam: undefined, alreadySubmitted: false }),
    ).toBe(false);
  });

  it('does not submit when a conversationId is also present (reopening an existing conversation, never combined with a fresh prompt in practice, but checked defensively)', () => {
    expect(
      shouldAutoSubmitInitialPrompt({
        initialPrompt: 'Have I been improving year over year?',
        conversationIdParam: 'conv-123',
        alreadySubmitted: false,
      }),
    ).toBe(false);
  });

  it('does not submit a second time once it has already fired for this mounted instance — this is the exact guard preventing a re-render/navigation from double-submitting', () => {
    expect(
      shouldAutoSubmitInitialPrompt({
        initialPrompt: 'Have I been improving year over year?',
        conversationIdParam: undefined,
        alreadySubmitted: true,
      }),
    ).toBe(false);
  });
});
