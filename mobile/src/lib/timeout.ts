/**
 * Bounds an otherwise-unbounded network call (Supabase's client has no built-in request timeout)
 * so a stalled connection surfaces as a normal rejected promise within a predictable window,
 * instead of leaving a caller `await`ing indefinitely — the direct cause of the onboarding
 * "Saving your race history…" spinner observed hanging with no recovery path. This does NOT abort
 * the underlying request (supabase-js gives no cancellation hook for a plain query), it just stops
 * the caller from waiting on it past `ms`; the original promise may still resolve later, so any
 * caller must guard against acting on a result that arrives after it already gave up (see
 * OnboardingFlow's attempt-generation guards).
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
