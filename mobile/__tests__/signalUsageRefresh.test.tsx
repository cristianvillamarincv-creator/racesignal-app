import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { SIGNAL_CONSENT_DISCLOSURE_VERSION, saveSignalConsent } from '@/lib/signalConsent';

/**
 * The allowance strip is refreshed from the server's read-only usage lookup: when Signal opens, when it regains focus (a
 * focus event or the app returning to the foreground), and after a send settles. A lookup that fails shows no count and
 * never blocks the conversation; a slow lookup can never overwrite a fresher count; reading never calls the model.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'athlete-1' } } }) }));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ isLoading: false, isError: false, data: [] }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ mode: 'off' }) }));
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: jest.fn() }) }));
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: jest.fn(), PAYWALL_RESULT: {} }));
jest.mock('@/lib/db/signal', () => ({
  createSignalConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
  appendSignalTurn: jest.fn().mockResolvedValue(undefined),
  fetchSignalConversationWithMessages: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/signalContext', () => ({ buildSignalContext: () => ({}), buildConversationTitle: () => 'Signal chat', getSuggestedPrompts: () => [] }));

const mockSendSignalMessage = jest.fn();
const mockFetchSignalUsage = jest.fn();
jest.mock('@/lib/signal', () => ({
  generateSignalRequestId: () => 'req-1',
  sendSignalMessage: (...args: unknown[]) => mockSendSignalMessage(...args),
  fetchSignalUsage: () => mockFetchSignalUsage(),
}));

// A test double for focus: remembers the screen's focus callback so a test can fire it again (the screen regaining focus).
let mockFocusCallback: (() => void | (() => void)) | null = null;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(() => {
      mockFocusCallback = callback;
      return callback();
    }, [callback]);
  },
}));

const usage = (remaining: number, isPremium = false) => ({ remaining, cap: isPremium ? 40 : 3, isPremium });
const FREE = (n: number) => `Free plan · ${n} of 3 Signal asks left`;
let appStateHandler: ((state: string) => void) | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  await saveSignalConsent({ athleteId: 'athlete-1', version: SIGNAL_CONSENT_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() });
  mockSendSignalMessage.mockReset();
  mockFetchSignalUsage.mockReset();
  mockFocusCallback = null;
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (state: string) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

async function send(ui: Awaited<ReturnType<typeof render>>, text: string) {
  await act(async () => {
    fireEvent.changeText(ui.getByLabelText('Message'), text);
  });
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Send'));
  });
}

describe('Signal allowance refresh', () => {
  it('shows the server count when Signal opens, without sending anything or calling the model', async () => {
    mockFetchSignalUsage.mockResolvedValue(usage(3));
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(FREE(3))).toBeTruthy());
    expect(mockFetchSignalUsage).toHaveBeenCalledTimes(1);
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });

  it('refreshes when Signal regains focus and when the app returns to the foreground (the out-of-band change case)', async () => {
    mockFetchSignalUsage.mockResolvedValueOnce(usage(0)).mockResolvedValueOnce(usage(3)).mockResolvedValueOnce(usage(2));
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(FREE(0))).toBeTruthy());

    await act(async () => {
      mockFocusCallback!();
    });
    await waitFor(() => expect(ui.getByText(FREE(3))).toBeTruthy());

    await act(async () => {
      appStateHandler!('background');
    });
    expect(mockFetchSignalUsage).toHaveBeenCalledTimes(2); // only 'active' refreshes
    await act(async () => {
      appStateHandler!('active');
    });
    await waitFor(() => expect(ui.getByText(FREE(2))).toBeTruthy());
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });

  it('shows no count when the lookup fails, hides a previously shown count that can no longer be confirmed, and never blocks the conversation', async () => {
    mockFetchSignalUsage.mockResolvedValueOnce(usage(1)).mockResolvedValue(null);
    mockSendSignalMessage.mockResolvedValue({ available: true, data: { reply: 'Hello.', remaining: 0, cap: 3, isPremium: false } });
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(FREE(1))).toBeTruthy());

    await act(async () => {
      mockFocusCallback!();
    });
    await waitFor(() => expect(ui.queryByText(/Signal asks left/)).toBeNull());

    // The conversation still works while the allowance is unknown.
    await send(ui, 'What is my 10K personal best?');
    await waitFor(() => expect(ui.getByText('Hello.')).toBeTruthy());
    expect(mockSendSignalMessage).toHaveBeenCalledTimes(1);
    await act(async () => ui.unmount());
  });

  it('refreshes after a send settles, and a failed refresh right after a reply keeps the reply\'s own count', async () => {
    mockFetchSignalUsage.mockResolvedValueOnce(usage(3)).mockResolvedValue(null);
    mockSendSignalMessage.mockResolvedValue({ available: true, data: { reply: 'Answer.', remaining: 2, cap: 3, isPremium: false } });
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(FREE(3))).toBeTruthy());

    await send(ui, 'Question');
    await waitFor(() => expect(ui.getByText('Answer.')).toBeTruthy());
    await waitFor(() => expect(mockFetchSignalUsage).toHaveBeenCalledTimes(2)); // open + after the send settled
    expect(ui.getByText(FREE(2))).toBeTruthy(); // the failed lookup did not wipe the reply's confirmed count
    await act(async () => ui.unmount());
  });

  it('after a failed send, shows the server count when it can be read and none when it cannot', async () => {
    mockFetchSignalUsage.mockResolvedValueOnce(usage(3)).mockResolvedValueOnce(usage(3)).mockResolvedValue(null);
    mockSendSignalMessage.mockResolvedValue({ available: false, reason: 'model_error' });
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(FREE(3))).toBeTruthy());

    await send(ui, 'Question');
    await waitFor(() => expect(mockFetchSignalUsage).toHaveBeenCalledTimes(2));
    expect(ui.getByText(FREE(3))).toBeTruthy(); // nothing was consumed by the failed send, and the server says so

    await act(async () => {
      mockFocusCallback!();
    });
    await waitFor(() => expect(ui.queryByText(/Signal asks left/)).toBeNull());
    await act(async () => ui.unmount());
  });

  it('a slow lookup never overwrites a fresher count from a reply', async () => {
    let resolveSlow: (value: ReturnType<typeof usage>) => void = () => {};
    mockFetchSignalUsage.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve))).mockResolvedValue(null);
    mockSendSignalMessage.mockResolvedValue({ available: true, data: { reply: 'Answer.', remaining: 2, cap: 3, isPremium: false } });
    const ui = await render(<SignalScreen />);

    await send(ui, 'Question'); // the open-time lookup is still in flight when the reply arrives
    await waitFor(() => expect(ui.getByText(FREE(2))).toBeTruthy());
    await act(async () => resolveSlow(usage(3))); // the stale, pre-send count arrives late
    expect(ui.getByText(FREE(2))).toBeTruthy();
    expect(ui.queryByText(FREE(3))).toBeNull();
    await act(async () => ui.unmount());
  });
});
