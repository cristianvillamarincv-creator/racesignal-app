import { sendSignalMessage } from '@/lib/signal';
import type { SignalContext } from '@/lib/signalContext';

// jest.mock calls are hoisted above these imports by babel-jest, so `lib/signal.ts` picks up the
// mocked `supabase` client regardless of source order.
const mockInvoke = jest.fn();

jest.mock('@/lib/supabaseClient', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

const EMPTY_CONTEXT: SignalContext = {
  sameSportDetailed: [],
  otherSportsCompact: [],
  upcoming: [],
  bestPerDistance: [],
};

/** Mirrors the exact shape supabase-js's FunctionsClient throws for a `fetch()` that never
 *  completed a connection — the one signature confirmed (via backend log inspection) to never
 *  reach Supabase at all. */
function transientTimeoutError() {
  return {
    name: 'FunctionsFetchError',
    message: 'Failed to send a request to the Edge Function',
    context: { name: 'TypeError', message: 'Network request timed out' },
  };
}

/** A real, non-2xx HTTP response — already reached the server, must never be retried. */
function httpError(status: number, bodyText: string) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { name: 'Response', status, text: async () => bodyText },
  };
}

/** Mirrors the exact shape supabase-js's FunctionsClient throws when ITS OWN `timeout` option (see
 *  lib/signal.ts's SIGNAL_CALL_TIMEOUT_MS) fires and aborts the in-flight fetch — an internally
 *  created AbortController, not the platform's own implicit timeout (contrast with
 *  transientTimeoutError() above, which is a `TypeError`, not an `AbortError`). */
function clientTimeoutError() {
  return {
    name: 'FunctionsFetchError',
    message: 'Failed to send a request to the Edge Function',
    context: { name: 'AbortError', message: 'Aborted' },
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function sendAndFlushRetryDelay() {
  const resultPromise = sendSignalMessage(EMPTY_CONTEXT, [], 'Analyze this race', 'test-request-id');
  // The retry backoff is 300-700ms — advance past the max so a pending retry (if any) fires.
  await jest.advanceTimersByTimeAsync(700);
  return resultPromise;
}

describe('sendSignalMessage — transient transport timeout retry', () => {
  it('does not retry an ordinary successful request', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { available: true, data: { reply: 'ok' } }, error: null });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: true, data: { reply: 'ok' } });
  });

  it('retries exactly once on the exact transient transport timeout signature, then succeeds', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: transientTimeoutError() })
      .mockResolvedValueOnce({ data: { available: true, data: { reply: 'second try worked' } }, error: null });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ available: true, data: { reply: 'second try worked' } });
  });

  it('re-sends the identical request body on retry', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: transientTimeoutError() })
      .mockResolvedValueOnce({ data: { available: true, data: { reply: 'ok' } }, error: null });

    await sendAndFlushRetryDelay();

    const [, firstOptions] = mockInvoke.mock.calls[0]!;
    const [, secondOptions] = mockInvoke.mock.calls[1]!;
    expect(secondOptions).toEqual(firstOptions);
  });

  it('surfaces the friendly network error when both the original attempt and the retry fail', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: transientTimeoutError() })
      .mockResolvedValueOnce({ data: null, error: transientTimeoutError() });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ available: false, reason: 'network_error', detail: expect.any(String) });
  });

  it('never retries a real HTTP/function error response', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(500, 'boom') });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, reason: 'network_error', detail: 'boom' });
  });

  it('never retries a rate-limit/auth/model-error response (returned as data, not a functions.invoke error)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { available: false, reason: 'rate_limited' }, error: null });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, reason: 'rate_limited' });
  });

  it('passes SIGNAL_CALL_TIMEOUT_MS through to functions.invoke on every call', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { available: true, data: { reply: 'ok' } }, error: null });

    await sendAndFlushRetryDelay();

    const [, options] = mockInvoke.mock.calls[0]!;
    expect((options as { timeout?: number }).timeout).toBeGreaterThan(0);
  });
});

describe('sendSignalMessage — client-side timeout (B.1 Task 1)', () => {
  it('reports a distinct "timeout" reason, never the generic network_error, when our own call times out', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: clientTimeoutError() });

    const result = await sendAndFlushRetryDelay();

    // Never auto-retried — see the 'timeout' reason's doc comment in lib/signal.ts: a client
    // give-up must never silently fire a second request behind the athlete's back.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, reason: 'timeout', detail: expect.any(String) });
  });

  it('does not confuse an AbortError timeout with the transient-network-timeout retry path', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: clientTimeoutError() })
      .mockResolvedValueOnce({ data: { available: true, data: { reply: 'should never be reached' } }, error: null });

    const result = await sendAndFlushRetryDelay();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, reason: 'timeout', detail: expect.any(String) });
  });
});
