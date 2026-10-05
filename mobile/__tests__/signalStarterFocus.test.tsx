import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { SIGNAL_CONSENT_DISCLOSURE_VERSION, saveSignalConsent } from '@/lib/signalConsent';
import { SIGNAL_DRAFT_KEY_PREFIX } from '@/lib/signalDraft';

/**
 * When the keyboard focus is requested for the composer: when a starter fills an EMPTY composer, and when the athlete chooses "Add starter" (and the
 * screen is focused). Never when a draft is preserved and only the choice is shown, never on "Keep my draft", and a notification never sends anything.
 * (The hook that performs the focus is covered in useInputFocusRequest.test.tsx; whether iOS shows the keyboard needs a device.)
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
const mockSend = jest.fn();
jest.mock('@/lib/signal', () => ({
  generateSignalRequestId: () => 'req-1',
  sendSignalMessage: (...args: unknown[]) => mockSend(...args),
  fetchSignalUsage: () => Promise.resolve(null),
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
const mockRequestFocus = jest.fn();
jest.mock('@/lib/useInputFocusRequest', () => ({ useInputFocusRequest: () => ({ requestFocus: mockRequestFocus, status: { attempts: 0, focused: null } }) }));

const STARTER = 'Next season, I want to focus on…';
const input = (ui: Awaited<ReturnType<typeof render>>) => ui.getByLabelText('Message');

beforeEach(async () => {
  await AsyncStorage.clear();
  mockParams = { starter: 'next-season-focus' };
  mockRequestFocus.mockReset();
  mockSend.mockReset();
  await saveSignalConsent({ athleteId: 'athlete-1', version: SIGNAL_CONSENT_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() });
});

describe('requesting keyboard focus for a starter', () => {
  it('requests focus once when the starter fills an empty composer, and sends nothing', async () => {
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(input(ui).props.value).toBe(STARTER));
    expect(mockRequestFocus).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not request focus (or touch the draft) when an existing draft is preserved and the choice is shown', async () => {
    await AsyncStorage.setItem(SIGNAL_DRAFT_KEY_PREFIX + 'athlete-1', 'My swimming notes');
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    expect(input(ui).props.value).toBe('My swimming notes');
    expect(mockRequestFocus).not.toHaveBeenCalled();
  });

  it('"Add starter" appends the starter after the draft and requests focus', async () => {
    await AsyncStorage.setItem(SIGNAL_DRAFT_KEY_PREFIX + 'athlete-1', 'My swimming notes');
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Add starter'));
    });
    expect(input(ui).props.value).toBe(`My swimming notes\n\n${STARTER}`);
    expect(ui.queryByTestId('starter-offer')).toBeNull();
    expect(mockRequestFocus).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('"Keep my draft" dismisses the choice, leaves the draft exactly as it was, and does not request focus', async () => {
    await AsyncStorage.setItem(SIGNAL_DRAFT_KEY_PREFIX + 'athlete-1', 'My swimming notes');
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Keep my draft'));
    });
    expect(ui.queryByTestId('starter-offer')).toBeNull();
    expect(input(ui).props.value).toBe('My swimming notes');
    expect(mockRequestFocus).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SIGNAL_DRAFT_KEY_PREFIX + 'athlete-1')).toBe('My swimming notes');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('offers "Add starter", not "Use starter"', async () => {
    await AsyncStorage.setItem(SIGNAL_DRAFT_KEY_PREFIX + 'athlete-1', 'Existing');
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByTestId('starter-offer')).toBeTruthy());
    expect(ui.getByLabelText('Add starter')).toBeTruthy();
    expect(ui.queryByLabelText('Use starter')).toBeNull();
  });
});
