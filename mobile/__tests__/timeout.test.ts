import { withTimeout } from '@/lib/timeout';

jest.useFakeTimers();

describe('withTimeout', () => {
  it('resolves with the wrapped value when it settles before the deadline', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000, 'test call');
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects with the wrapped error when the promise rejects before the deadline', async () => {
    const promise = withTimeout(Promise.reject(new Error('boom')), 1000, 'test call');
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with a labeled timeout error if the promise never settles in time', async () => {
    const never = new Promise<string>(() => {});
    const promise = withTimeout(never, 1000, 'slow call');
    const assertion = expect(promise).rejects.toThrow('slow call timed out after 1000ms');
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('does not fire the timeout once the promise has already resolved', async () => {
    const promise = withTimeout(Promise.resolve('done'), 1000, 'test call');
    await expect(promise).resolves.toBe('done');
    // Advancing timers after resolution must not throw an unhandled rejection from a leftover timer.
    jest.advanceTimersByTime(2000);
  });
});
