import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { SIGNAL_CONSENT_DISCLOSURE_VERSION, saveSignalConsent } from '@/lib/signalConsent';

/**
 * The conversation layout, driven through the real screen: question bubbles (right-aligned, muted blue-grey, 85% max,
 * 16pt regular, 14pt padding, 16pt radius), answers on the canvas (17pt regular, 25pt line height) under a SIGNAL label with
 * the mark, 12pt between a question and its answer, 28pt before the next question, no rules between messages, no bold
 * lede, and screen-reader labels that identify who is speaking. Message order and the chat flow itself are exercised by
 * the consent-gate tests.
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
jest.mock('@/lib/signal', () => ({ generateSignalRequestId: () => 'req-1', sendSignalMessage: (...args: unknown[]) => mockSendSignalMessage(...args) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));

const REPLIES = [
  '44:30, set at the Link Test 10K on April 20, 2025.',
  'The Link Test 10K.\n\nIt was April 20, 2025.',
];

beforeEach(async () => {
  await AsyncStorage.clear();
  await saveSignalConsent({ athleteId: 'athlete-1', version: SIGNAL_CONSENT_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() });
  mockSendSignalMessage.mockReset();
  REPLIES.forEach((reply, i) => mockSendSignalMessage.mockResolvedValueOnce({ available: true, data: { reply, remaining: 2 - i, cap: 3, isPremium: false } }));
});

async function ask(ui: Awaited<ReturnType<typeof render>>, text: string) {
  await act(async () => {
    fireEvent.changeText(ui.getByLabelText('Message'), text);
  });
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Send'));
  });
}

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('Signal conversation layout', () => {
  it('lays out questions as bubbles and answers as plain text under a SIGNAL label, in order, with the specified spacing', async () => {
    const ui = await render(<SignalScreen />);
    await ask(ui, "What is my 10K personal best?");
    await waitFor(() => expect(ui.getByText(REPLIES[0]!)).toBeTruthy());
    await ask(ui, 'Which race was that and what year?');
    await waitFor(() => expect(ui.getByText('The Link Test 10K.')).toBeTruthy());

    // Question bubble: muted fill, 85% max width, 14pt padding, 16pt corners; its text is 16pt regular.
    const questionText = ui.getByText('What is my 10K personal best?');
    expect(flat(questionText)).toMatchObject({ fontSize: 16, fontWeight: '400' });
    const bubble = ui.getByLabelText('Your question. What is my 10K personal best?');
    expect(flat(bubble)).toMatchObject({ maxWidth: '85%', padding: 14, borderRadius: 16 });
    expect(typeof flat(bubble).backgroundColor).toBe('string');
    expect(flat(bubble.parent as never)).toMatchObject({ alignItems: 'flex-end' });

    // Answer text: 17pt regular, 25pt line height, and EVERY paragraph has the same weight (no bold first paragraph).
    for (const paragraph of [REPLIES[0]!, 'The Link Test 10K.', 'It was April 20, 2025.']) {
      expect(flat(ui.getByText(paragraph))).toMatchObject({ fontSize: 17, fontWeight: '400', lineHeight: 25 });
    }

    // A SIGNAL label above every answer (two answers, two labels), and no "Analysis" kicker anywhere.
    expect(ui.getAllByText('Signal')).toHaveLength(2);
    expect(flat(ui.getAllByText('Signal')[0]!)).toMatchObject({ textTransform: 'uppercase' });
    expect(ui.queryByText(/analysis/i)).toBeNull();
    expect(ui.getAllByLabelText("Signal's answer")).toHaveLength(2);

    // Spacing: answer blocks sit 12pt below their question, the second question 28pt below the first answer.
    const answerBlock = ui.getAllByLabelText("Signal's answer")[0]!.parent!;
    expect(flat(answerBlock as never)).toMatchObject({ marginTop: 12 });
    const secondQuestionRow = ui.getByLabelText('Your question. Which race was that and what year?').parent!;
    expect(flat(secondQuestionRow as never)).toMatchObject({ marginTop: 28 });
    const firstQuestionRow = bubble.parent!;
    expect(flat(firstQuestionRow as never).marginTop).toBe(0);

    // Order and context are preserved: the second request carries the first exchange as history.
    expect(mockSendSignalMessage).toHaveBeenNthCalledWith(2, {}, [
      { role: 'user', text: 'What is my 10K personal best?' },
      { role: 'assistant', text: REPLIES[0] },
    ], 'Which race was that and what year?', 'req-1', undefined);

    await act(async () => {
      ui.unmount();
    });
  });

  it('shows no suggestion list when no question is supported by the data (nothing fills the slots)', async () => {
    const ui = await render(<SignalScreen />);
    expect(ui.queryByRole('button', { name: /personal best|strongest|improving/i })).toBeNull();
    expect(ui.getByLabelText('Message')).toBeTruthy();
    await act(async () => {
      ui.unmount();
    });
  });
});
