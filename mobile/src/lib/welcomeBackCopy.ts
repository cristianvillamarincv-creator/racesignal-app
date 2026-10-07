/** The line on the "Welcome back." screen shown when an existing account signs in with race selections still pending from onboarding. */
export function welcomeBackPendingCopy(pendingCount: number): string {
  if (pendingCount === 1) {
    return 'You selected 1 race that isn’t in your history yet. Review it and choose whether to add it, or skip to keep your race history unchanged. Your profile won’t change.';
  }
  return `You selected ${pendingCount} races that aren’t in your history yet. Review them and choose which to add, or skip to keep your race history unchanged. Your profile won’t change.`;
}
