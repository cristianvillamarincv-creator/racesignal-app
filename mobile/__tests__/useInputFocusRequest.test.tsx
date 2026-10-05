import React, { useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useInputFocusRequest, type FocusableInput, type FocusStatus } from '@/lib/useInputFocusRequest';

/**
 * Focus after a navigation must wait for the screen to be focused, the transition to finish and the app to be ACTIVE (iOS ignores a focus
 * otherwise), then verify with the input itself and retry a bounded number of times. Nothing here counts a timer as proof.
 */

let appState: string = 'active';
let appStateListener: ((state: string) => void) | null = null;
let interactionCallbacks: (() => void)[] = [];
const cancelInteraction = jest.fn();

function makeInput(focusesOnAttempt: number | null) {
  let attempts = 0;
  let focused = false;
  const input: FocusableInput & { attempts: () => number } = {
    focus: jest.fn(() => {
      attempts += 1;
      if (focusesOnAttempt !== null && attempts >= focusesOnAttempt) focused = true;
    }),
    isFocused: () => focused,
    attempts: () => attempts,
  };
  return input;
}

let latest: { requestFocus: () => void; status: FocusStatus };
function Probe({ input, screenFocused }: { input: FocusableInput; screenFocused: boolean }) {
  const ref = useRef<FocusableInput | null>(input);
  ref.current = input;
  latest = useInputFocusRequest(ref, screenFocused);
  return null;
}

const runInteractions = () => act(async () => interactionCallbacks.splice(0).forEach((cb) => cb()));
const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

beforeEach(() => {
  jest.useFakeTimers();
  appState = 'active';
  appStateListener = null;
  interactionCallbacks = [];
  cancelInteraction.mockReset();
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (state: string) => void) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((task: () => void) => {
    interactionCallbacks.push(task);
    return { then: jest.fn(), done: jest.fn(), cancel: cancelInteraction };
  }) as never);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useInputFocusRequest', () => {
  it('does nothing until focus is requested', async () => {
    const input = makeInput(1);
    await render(<Probe input={input} screenFocused />);
    await runInteractions();
    await advance(5000);
    expect(input.focus).not.toHaveBeenCalled();
    expect(latest.status).toEqual({ attempts: 0, focused: null });
  });

  it('waits for the navigation transition to finish before focusing', async () => {
    const input = makeInput(1);
    await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await advance(1000);
    expect(input.focus).not.toHaveBeenCalled(); // the transition (interactions) is still running
    await runInteractions();
    expect(input.focus).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(latest.status).toEqual({ attempts: 1, focused: true });
  });

  it('waits for the screen to be focused, then focuses', async () => {
    const input = makeInput(1);
    const view = await render(<Probe input={input} screenFocused={false} />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    await advance(3000);
    expect(input.focus).not.toHaveBeenCalled();
    await view.rerender(<Probe input={input} screenFocused />);
    await runInteractions();
    expect(input.focus).toHaveBeenCalled();
  });

  it('does not try while the app is not active (iOS would ignore it), and focuses when the app becomes active', async () => {
    appState = 'inactive';
    const input = makeInput(1);
    await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    await advance(4000);
    expect(input.focus).not.toHaveBeenCalled();
    appState = 'active';
    await act(async () => appStateListener!('active'));
    expect(input.focus).toHaveBeenCalled();
    await advance(200);
    expect(latest.status.focused).toBe(true);
  });

  it('verifies with the input and retries until it really holds focus, then stops', async () => {
    const input = makeInput(3); // the first two attempts do not take
    await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    await advance(200);
    expect(latest.status).toEqual({ attempts: 1, focused: false });
    await advance(5000);
    expect(input.attempts()).toBe(3);
    expect(latest.status.focused).toBe(true);
    await advance(10_000);
    expect(input.attempts()).toBe(3); // no more attempts once focused
  });

  it('gives up after a bounded number of attempts and reports that it never focused', async () => {
    const input = makeInput(null);
    await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    await advance(10_000);
    expect(input.attempts()).toBe(5); // the first try plus four retries
    expect(latest.status).toEqual({ attempts: 5, focused: false });
    await advance(30_000);
    expect(input.attempts()).toBe(5);
  });

  it('does not focus an input that already has focus', async () => {
    const input = makeInput(1);
    (input.focus as jest.Mock).mockClear();
    input.focus();
    (input.focus as jest.Mock).mockClear();
    await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    expect(input.focus).not.toHaveBeenCalled();
    expect(latest.status.focused).toBe(true);
  });

  it('cancels pending work when the screen goes away', async () => {
    const input = makeInput(null);
    const view = await render(<Probe input={input} screenFocused />);
    await act(async () => latest.requestFocus());
    await runInteractions();
    await view.unmount();
    expect(cancelInteraction).toHaveBeenCalled();
    const before = input.attempts();
    await advance(10_000);
    expect(input.attempts()).toBe(before);
  });
});
