/**
 * Decides whether signal.tsx should auto-submit a suggestion tapped on the Signal landing screen
 * ((tabs)/ask.tsx's openSignalWithPrompt, arriving here as the `initialPrompt` route param).
 * Extracted into its own pure predicate (rather than left as an inline condition inside the
 * effect) specifically so the three things that must hold — a prompt actually exists, this isn't
 * also a reopened-conversation navigation (mutually exclusive by construction, but checked
 * defensively), and it hasn't already fired once for this mounted screen instance — have direct
 * regression coverage. See __tests__/signalInitialPrompt.test.ts.
 */
export function shouldAutoSubmitInitialPrompt({
  initialPrompt,
  conversationIdParam,
  alreadySubmitted,
}: {
  initialPrompt: string | undefined;
  conversationIdParam: string | undefined;
  alreadySubmitted: boolean;
}): boolean {
  return Boolean(initialPrompt) && !conversationIdParam && !alreadySubmitted;
}
