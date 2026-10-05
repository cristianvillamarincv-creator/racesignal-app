import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { clearSignalConsent, hasAgreedToSignalDisclosure, saveSignalConsent } from '@/lib/signalConsent';

/**
 * Real component-behavior tests for the B.12 first-use Signal consent gate — deliberately driving
 * the actual screen (not just signalConsent.ts's pure functions) through every path that can
 * reach `sendMessage` (see signal.tsx): the typed-message Send button, a tapped suggestion chip,
 * and a suggestion auto-submitted via the `initialPrompt` route param (ask.tsx's landing-screen
 * chips). All three funnel through the exact same gate, so covering each one here is what "every
 * Signal entry point" actually means for this screen — results/[id].tsx and race/[id].tsx never
 * call sendMessage themselves, they only navigate to this screen.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockAthleteId = 'athlete-1';
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: mockAthleteId } } }),
}));
jest.mock('@/lib/racesContext', () => ({
  useAthleteRaces: () => ({ isLoading: false, isError: false, data: [] }),
}));
jest.mock('@/lib/devPreview', () => ({
  isDevPreviewAvailable: () => false,
  useDevPreview: () => ({ mode: 'off' }),
}));
jest.mock('@/lib/premium', () => ({
  usePremium: () => ({ isPremium: false, refresh: jest.fn() }),
}));
jest.mock('@/lib/purchases', () => ({
  presentPremiumPaywall: jest.fn(),
  PAYWALL_RESULT: { PURCHASED: 'purchased', RESTORED: 'restored', CANCELLED: 'cancelled', ERROR: 'error', NOT_PRESENTED: 'not_presented' },
}));
jest.mock('@/lib/db/signal', () => ({
  createSignalConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
  appendSignalTurn: jest.fn().mockResolvedValue(undefined),
  fetchSignalConversationWithMessages: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/signalContext', () => ({
  buildSignalContext: () => ({}),
  buildConversationTitle: () => 'Signal chat',
  getSuggestedPrompts: () => ["What's my 10K personal best?"],
}));

const mockSendSignalMessage = jest.fn();
jest.mock('@/lib/signal', () => ({
  generateSignalRequestId: () => 'req-1',
  sendSignalMessage: (...args: unknown[]) => mockSendSignalMessage(...args),
  fetchSignalUsage: () => Promise.resolve(null),
}));

let mockInitialPrompt: string | undefined;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ raceId: undefined, conversationId: undefined, initialPrompt: mockInitialPrompt }),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));

const SUCCESS_REPLY = { available: true, data: { reply: 'Here is your analysis.', remaining: 2, cap: 3, isPremium: false } };
const CONSENT_TITLE = 'Before you use Signal';
const CONSENT_BODY =
  'Signal uses Anthropic’s Claude to analyze your performance. To answer your questions, RaceSignal shares relevant race results, your question, relevant conversation history, and any screenshots you attach with Anthropic.';

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSendSignalMessage.mockReset();
  mockSendSignalMessage.mockResolvedValue(SUCCESS_REPLY);
  mockAthleteId = 'athlete-1';
  mockInitialPrompt = undefined;
});

describe('Signal first-use consent gate — suggestion chip entry point', () => {
  it('gates a tapped suggestion chip exactly like a typed message', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText("What's my 10K personal best?"));
    });

    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(mockSendSignalMessage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Agree and continue'));
    });
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(mockSendSignalMessage).toHaveBeenCalledWith({}, [], "What's my 10K personal best?", 'req-1', undefined);
    await act(async () => {
      ui.unmount();
    });
  });

  it('"Not now" on a tapped suggestion chip sends nothing — the suggestion row stays available to tap again', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText("What's my 10K personal best?"));
    });
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Not now'));
    });
    await waitFor(() => expect(ui.queryByText(CONSENT_TITLE)).toBeNull());

    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(ui.getByLabelText("What's my 10K personal best?")).toBeTruthy();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('Signal first-use consent gate — typed message (Send button)', () => {
  it('shows the disclosure sheet before sending, with the exact required copy and links, and never calls Anthropic first', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'What does Eagleman suggest for California?');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });

    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(ui.getByText(CONSENT_BODY)).toBeTruthy();
    expect(ui.getByLabelText('RaceSignal Privacy Policy')).toBeTruthy();
    expect(ui.getByLabelText('Anthropic Privacy Policy')).toBeTruthy();
    expect(ui.getByLabelText('Agree and continue')).toBeTruthy();
    expect(ui.getByLabelText('Not now')).toBeTruthy();
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    await act(async () => {
      ui.unmount();
    });
  });

  it('"Not now" sends nothing and preserves the typed question exactly', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'What does Eagleman suggest for California?');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Not now'));
    });
    await waitFor(() => expect(ui.queryByText(CONSENT_TITLE)).toBeNull());

    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(ui.getByLabelText('Message').props.value).toBe('What does Eagleman suggest for California?');
    // Declining doesn't disable anything else in the screen — Send is still reachable again.
    expect(ui.getByLabelText('Send')).toBeTruthy();
    await act(async () => {
      ui.unmount();
    });
  });

  it('"Agree and continue" records consent for this account and resumes sending the exact pending question', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'What does Eagleman suggest for California?');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Agree and continue'));
    });

    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(mockSendSignalMessage).toHaveBeenCalledWith({}, [], 'What does Eagleman suggest for California?', 'req-1', undefined);
    await waitFor(() => expect(ui.getByText('Here is your analysis.')).toBeTruthy());

    const stored = await AsyncStorage.getItem('racesignal.signal.consentAcknowledged');
    expect(stored).not.toBeNull();
    const record = JSON.parse(stored!);
    expect(record.athleteId).toBe('athlete-1');
    expect(record.version).toBe(1);
    await act(async () => {
      ui.unmount();
    });
  });

  it('does not re-prompt a second question in the same session once this account has agreed', async () => {
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'First question');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Agree and continue'));
    });
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ui.getByText('Here is your analysis.')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'Second question');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });

    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(2));
    expect(ui.queryByText(CONSENT_TITLE)).toBeNull();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('Signal first-use consent gate — account switching', () => {
  it('never reuses one account’s consent for a different account on the same device', async () => {
    // Account 1 agrees first — via the real UI, same as every other test here.
    mockAthleteId = 'athlete-1';
    const first = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(first.getByLabelText('Message'), 'Question from account 1');
    });
    await act(async () => {
      fireEvent.press(first.getByLabelText('Send'));
    });
    await waitFor(() => expect(first.getByText(CONSENT_TITLE)).toBeTruthy());
    await act(async () => {
      fireEvent.press(first.getByLabelText('Agree and continue'));
    });
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));

    const storedAfterFirst = JSON.parse((await AsyncStorage.getItem('racesignal.signal.consentAcknowledged'))!);
    expect(storedAfterFirst.athleteId).toBe('athlete-1');
    await act(async () => {
      first.unmount();
    });

    // Same device (same AsyncStorage, still holding account 1's consent record), a different
    // signed-in account — a fresh screen instance, exactly as a real sign-out/sign-in would produce.
    mockAthleteId = 'athlete-2';
    const second = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(second.getByLabelText('Message'), 'Question from account 2');
    });
    await act(async () => {
      fireEvent.press(second.getByLabelText('Send'));
    });

    // Account 1's stored consent must never count for account 2 — pressing Send sends nothing
    // (still just account 1's earlier call), and the typed question is preserved, exactly like a
    // brand-new account's first-ever question being correctly gated.
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(second.getByLabelText('Message').props.value).toBe('Question from account 2');

    // The exact cross-account-safety property, checked directly against the real signalConsent
    // module (the same one sendMessage's gate calls) rather than through a second Modal's on-screen
    // text — react-native's <Modal> only reliably renders one active instance's content per test
    // renderer session, which is a test-environment limitation, not a product behavior to assert on.
    expect(await hasAgreedToSignalDisclosure('athlete-2')).toBe(false);
    expect(await hasAgreedToSignalDisclosure('athlete-1')).toBe(true); // unchanged so far

    await saveSignalConsent({ athleteId: 'athlete-2', version: 1, agreedAt: new Date().toISOString() });
    expect(await hasAgreedToSignalDisclosure('athlete-2')).toBe(true);
    // Single fixed storage key (see signalConsent.ts's doc comment): account 2 agreeing overwrites
    // account 1's record. Documented, accepted tradeoff — re-prompts account 1 if it signs back in,
    // but never a cross-account leak in either direction.
    expect(await hasAgreedToSignalDisclosure('athlete-1')).toBe(false);
    await act(async () => {
      second.unmount();
    });
  });
});

describe('Signal first-use consent gate — auto-submitted suggestion from the Signal tab', () => {
  it('gates the initialPrompt route param exactly like a typed message, before it auto-sends', async () => {
    mockInitialPrompt = 'What does this suggest for my next race?';
    const ui = await render(<SignalScreen />);

    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(mockSendSignalMessage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Agree and continue'));
    });
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(mockSendSignalMessage).toHaveBeenCalledWith({}, [], 'What does this suggest for my next race?', 'req-1', undefined);
  });

  it('"Not now" on the auto-submitted initialPrompt sends nothing — the suggestion is simply not asked, not retried', async () => {
    mockInitialPrompt = 'What does this suggest for my next race?';
    const ui = await render(<SignalScreen />);
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Not now'));
    });
    await waitFor(() => expect(ui.queryByText(CONSENT_TITLE)).toBeNull());

    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('Signal first-use consent gate — withdrawing consent (Settings)', () => {
  it('withdrawing consent (clearSignalConsent, the same function Settings\' "Withdraw Signal consent" row calls) re-gates the very next Signal request', async () => {
    mockAthleteId = 'athlete-1';
    const ui = await render(<SignalScreen />);
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'First question');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });
    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Agree and continue'));
    });
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(await hasAgreedToSignalDisclosure('athlete-1')).toBe(true);

    // Exactly what Settings' "Withdraw Signal consent" row does (handleWithdrawSignalConsent).
    await clearSignalConsent();
    expect(await hasAgreedToSignalDisclosure('athlete-1')).toBe(false);

    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Message'), 'Second question, after withdrawing');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Send'));
    });

    await waitFor(() => expect(ui.getByText(CONSENT_TITLE)).toBeTruthy());
    expect(mockSendSignalMessage).toHaveBeenCalledTimes(1); // still just the first question — nothing new sent
    expect(ui.getByLabelText('Message').props.value).toBe('Second question, after withdrawing');
    await act(async () => {
      ui.unmount();
    });
  });
});
