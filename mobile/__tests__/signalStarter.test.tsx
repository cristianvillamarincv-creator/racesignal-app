import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { SIGNAL_CONSENT_DISCLOSURE_VERSION, saveSignalConsent } from '@/lib/signalConsent';
import { SIGNAL_DRAFT_KEY_PREFIX } from '@/lib/signalDraft';

/**
 * A between-race notification opens Signal with an editable starter. It fills an empty composer; it never overwrites an existing draft (it offers an
 * explicit choice instead); it is never sent and never uses an ask; and the composer text survives leaving the screen and cold starts, per athlete.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockAthlete = 'athlete-1';
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: mockAthlete } } }) }));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ isLoading: false, isError: false, data: [] }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ mode: 'off' }) }));
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: jest.fn() }) }));
const mockPaywall = jest.fn();
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: () => mockPaywall(), PAYWALL_RESULT: {} }));
jest.mock('@/lib/db/signal', () => ({
  createSignalConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
  appendSignalTurn: jest.fn().mockResolvedValue(undefined),
  fetchSignalConversationWithMessages: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/signalContext', () => ({ buildSignalContext: () => ({}), buildConversationTitle: () => 'Signal chat', getSuggestedPrompts: () => [] }));
const mockSend = jest.fn();
let mockUsage: any = null;
jest.mock('@/lib/signal', () => ({
  generateSignalRequestId: () => 'req-1',
  sendSignalMessage: (...args: unknown[]) => mockSend(...args),
  fetchSignalUsage: () => Promise.resolve(mockUsage),
}));
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));

const STARTER = 'Next season, I want to focus on…';
const draftKey = (athlete: string) => SIGNAL_DRAFT_KEY_PREFIX + athlete;
const settle = async (ms = 500) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const input = (ui: Awaited<ReturnType<typeof render>>) => ui.getByLabelText('Message');

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAthlete = 'athlete-1';
  mockParams = {};
  mockUsage = null;
  mockSend.mockReset().mockResolvedValue({ available: true, data: { reply: 'Reply.', remaining: 1, cap: 3, isPremium: false } });
  mockPaywall.mockReset().mockResolvedValue('cancelled');
  await saveSignalConsent({ athleteId: 'athlete-1', version: SIGNAL_CONSENT_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() });
});

describe('a starter from a notification', () => {
  it('fills an empty composer with the editable starter, focuses it, and sends nothing', async () => {
    mockParams = { starter: 'next-season-focus' };
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(input(ui).props.value).toBe(STARTER));
    expect(mockSend).not.toHaveBeenCalled();
    expect(ui.queryByTestId('starter-offer')).toBeNull();
    // Editable: the athlete can continue the sentence.
    await act(async () => {
      fireEvent.changeText(input(ui), `${STARTER} sprint distance`);
    });
    expect(input(ui).props.value).toBe(`${STARTER} sprint distance`);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('never overwrites an existing draft: it is kept, and the starter is offered as an explicit choice', async () => {
    await AsyncStorage.setItem(draftKey('athlete-1'), 'My own half-written question');
    mockParams = { starter: 'next-season-focus' };
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    expect(input(ui).props.value).toBe('My own half-written question');
    expect(ui.getByText(`“${STARTER}”`)).toBeTruthy();
    expect(mockSend).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Use starter'));
    });
    expect(input(ui).props.value).toBe(`My own half-written question\n\n${STARTER}`);
    expect(ui.queryByTestId('starter-offer')).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('"Keep my draft" dismisses the offer and leaves the draft exactly as it was', async () => {
    await AsyncStorage.setItem(draftKey('athlete-1'), 'Existing');
    mockParams = { starter: 'went-well' };
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Keep my draft'));
    });
    expect(ui.queryByTestId('starter-offer')).toBeNull();
    expect(input(ui).props.value).toBe('Existing');
  });

  it('ignores an unknown starter and handles the starter only once', async () => {
    mockParams = { starter: 'not-a-prompt' };
    const ui = await render(<SignalScreen />);
    await settle(100);
    expect(input(ui).props.value).toBe('');
    expect(ui.queryByTestId('starter-offer')).toBeNull();
  });

  it('does not use an ask: opening and editing a starter makes no model call and no usage change, and an exhausted free balance still intercepts Send', async () => {
    mockUsage = { remaining: 0, cap: 3, isPremium: false, resetsAt: null };
    mockParams = { starter: 'try-next-distance' };
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(input(ui).props.value).toBe('I’m thinking about trying…'));
    expect(mockSend).not.toHaveBeenCalled();
    // The existing exhausted-allowance behavior is untouched: Send opens the paywall and sends nothing.
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    expect(input(ui).props.value).toBe('I’m thinking about trying…'); // the draft is still there
  });
});

describe('draft persistence', () => {
  it('saves typed text per athlete and restores it after a cold start', async () => {
    const first = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(input(first), 'A question I am still writing');
    });
    await settle();
    expect(await AsyncStorage.getItem(draftKey('athlete-1'))).toBe('A question I am still writing');
    await first.unmount();

    const second = await render(<SignalScreen />); // a new process: nothing in memory
    await waitFor(() => expect(input(second).props.value).toBe('A question I am still writing'));
  });

  it('does not show one athlete’s draft to another', async () => {
    await AsyncStorage.setItem(draftKey('athlete-1'), 'Private to athlete one');
    mockAthlete = 'athlete-2';
    const ui = await render(<SignalScreen />);
    await settle(100);
    expect(input(ui).props.value).toBe('');
  });

  it('clears the saved draft when the message is sent, and when the composer is emptied', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(input(ui), 'Send this one');
    });
    await settle();
    expect(await AsyncStorage.getItem(draftKey('athlete-1'))).toBe('Send this one');
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    await settle();
    expect(await AsyncStorage.getItem(draftKey('athlete-1'))).toBeNull();
  });

  it('never replaces what the athlete has already started typing with a saved draft', async () => {
    await AsyncStorage.setItem(draftKey('athlete-1'), 'Saved earlier');
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(input(ui), 'Typed right now');
    });
    await settle(100);
    expect(input(ui).props.value).toBe('Typed right now');
  });
});
