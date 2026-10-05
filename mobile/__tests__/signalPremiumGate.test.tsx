import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SignalScreen from '@/app/signal';
import { SIGNAL_CONSENT_DISCLOSURE_VERSION, saveSignalConsent } from '@/lib/signalConsent';

/**
 * Premium awareness inside the conversation: the allowance area for free and Premium, the exhausted free state, and the
 * hand-off from a blocked Send to the existing paywall. A balance the server has confirmed is used up never reaches the model or
 * the thread; a dismissed paywall leaves the draft and attachment alone; a purchase or restore re-reads entitlement AND usage and
 * the pending question is sent once, with its original request id, only if the server confirms an available allowance.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'athlete-1' } } }) }));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ isLoading: false, isError: false, data: [] }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ mode: 'off' }) }));
const mockRefreshPremium = jest.fn();
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: mockRefreshPremium }) }));
const mockPaywall = jest.fn();
jest.mock('@/lib/purchases', () => ({
  presentPremiumPaywall: () => mockPaywall(),
  PAYWALL_RESULT: { PURCHASED: 'purchased', RESTORED: 'restored', CANCELLED: 'cancelled', ERROR: 'error', NOT_PRESENTED: 'not_presented' },
}));
jest.mock('@/lib/db/signal', () => ({
  createSignalConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
  appendSignalTurn: jest.fn().mockResolvedValue(undefined),
  fetchSignalConversationWithMessages: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/signalContext', () => ({ buildSignalContext: () => ({}), buildConversationTitle: () => 'Signal chat', getSuggestedPrompts: () => [] }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ base64: 'AAAA', uri: 'file:///shot.jpg', mimeType: 'image/jpeg' }] }),
  MediaTypeOptions: { Images: 'Images' },
}));

const mockSendSignalMessage = jest.fn();
const mockFetchSignalUsage = jest.fn();
let mockRequestIdCounter = 0;
jest.mock('@/lib/signal', () => ({
  generateSignalRequestId: () => `req-${++mockRequestIdCounter}`,
  sendSignalMessage: (...args: unknown[]) => mockSendSignalMessage(...args),
  fetchSignalUsage: () => mockFetchSignalUsage(),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));

type Usage = { remaining: number; cap: number; isPremium: boolean; resetsAt: string | null } | null;
const free = (remaining: number): Usage => ({ remaining, cap: 3, isPremium: false, resetsAt: null });
const premium = (remaining: number): Usage => ({ remaining, cap: 40, isPremium: true, resetsAt: '2026-11-01T00:00:00.000Z' });
let mockUsage: Usage = free(3);
const REPLY = { available: true, data: { reply: 'Here you go.', remaining: 39, cap: 40, isPremium: true } };
const DRAFT = 'What changed between these two races?';

beforeEach(async () => {
  await AsyncStorage.clear();
  await saveSignalConsent({ athleteId: 'athlete-1', version: SIGNAL_CONSENT_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() });
  mockRequestIdCounter = 0;
  mockSendSignalMessage.mockReset().mockResolvedValue(REPLY);
  mockPaywall.mockReset().mockResolvedValue('cancelled');
  mockRefreshPremium.mockReset().mockResolvedValue(undefined);
  mockFetchSignalUsage.mockReset().mockImplementation(async () => mockUsage);
  mockUsage = free(3);
});

async function open(usage: Usage) {
  mockUsage = usage;
  const ui = await render(<SignalScreen />);
  await act(async () => {});
  return ui;
}
async function typeDraft(ui: Awaited<ReturnType<typeof render>>, text = DRAFT) {
  await act(async () => {
    fireEvent.changeText(ui.getByLabelText('Message'), text);
  });
}
async function attach(ui: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Attach a screenshot'));
  });
  await waitFor(() => expect(ui.getByText('Screenshot ready to send')).toBeTruthy());
}
async function pressSend(ui: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Send'));
  });
}
const draftOf = (ui: Awaited<ReturnType<typeof render>>) => ui.getByLabelText('Message').props.value;

describe('allowance area', () => {
  it('free: remaining count, what Premium includes, and Explore Premium', async () => {
    const ui = await open(free(2));
    expect(ui.getByText('2 of 3 free asks remaining')).toBeTruthy();
    expect(ui.getByText('Premium includes 40 asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('exhausted free: the exhausted message and Explore Premium, while the composer stays usable', async () => {
    const ui = await open(free(0));
    expect(ui.getByText('You’ve used your 3 free asks.')).toBeTruthy();
    expect(ui.getByText('Keep the conversation going with 40 asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();
    await typeDraft(ui);
    expect(draftOf(ui)).toBe(DRAFT);
    expect(ui.getByLabelText('Attach a screenshot')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Premium: the monthly count only (no reset date or hidden reset text), and no upgrade action', async () => {
    const ui = await open(premium(28));
    expect(ui.getByText('28 of 40 asks remaining this month')).toBeTruthy();
    expect(ui.queryByText(/Resets/)).toBeNull();
    expect(ui.queryByLabelText(/Resets/)).toBeNull();
    expect(JSON.stringify(ui.toJSON())).not.toMatch(/Resets/);
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    await act(async () => ui.unmount());
  });

  it('unknown usage shows nothing (never a guessed count)', async () => {
    const ui = await open(null);
    expect(ui.queryByText(/asks remaining/)).toBeNull();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    await act(async () => ui.unmount());
  });

  it('has no fixed-height containers, so larger text can wrap without clipping', async () => {
    const ui = await open(free(2));
    const area = ui.getByTestId('signal-allowance-conversation');
    const flat = Object.assign({}, ...[area.props.style].flat(Infinity).filter(Boolean));
    expect(flat.height).toBeUndefined();
    expect(flat.maxHeight).toBeUndefined();
    expect(flat.flexWrap).toBe('wrap');
    await act(async () => ui.unmount());
  });
});

describe('a confirmed-exhausted free balance intercepts Send', () => {
  it('opens the paywall, appends nothing and calls no model; a dismissed paywall keeps the draft and the attachment', async () => {
    const ui = await open(free(0));
    await typeDraft(ui);
    await attach(ui);
    await pressSend(ui);

    expect(mockPaywall).toHaveBeenCalledTimes(1);
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(ui.queryByLabelText(/^Your question/)).toBeNull();
    expect(draftOf(ui)).toBe(DRAFT);
    expect(ui.getByText('Screenshot ready to send')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('after a purchase or restore, re-reads entitlement AND usage, then sends the pending question exactly once with its original request id', async () => {
    mockPaywall.mockImplementation(async () => {
      mockUsage = premium(40); // the purchase: the server now reports an available monthly allowance
      return 'purchased';
    });
    const ui = await open(free(0));
    await typeDraft(ui);
    await attach(ui);
    await pressSend(ui);

    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(mockRefreshPremium).toHaveBeenCalled();
    const [, history, message, requestId, image] = mockSendSignalMessage.mock.calls[0]!;
    expect(history).toEqual([]);
    expect(message).toBe(DRAFT);
    expect(requestId).toBe('req-1'); // the id generated when Send was first pressed, reused (so server dedup still applies)
    expect(image).toEqual({ base64: 'AAAA', mediaType: 'image/jpeg' });
    expect(mockRequestIdCounter).toBe(1);
    await waitFor(() => expect(ui.getByText('Here you go.')).toBeTruthy());
    expect(ui.getAllByLabelText(/^Your question/)).toHaveLength(1);
    await act(async () => ui.unmount());
  });

  it('does not send if usage still shows exhausted after the paywall (the real counter decides, not the purchase)', async () => {
    mockPaywall.mockResolvedValue('purchased'); // entitlement changed, but the server's free counter is still 0 and no Premium yet
    const ui = await open(free(0));
    await typeDraft(ui);
    await pressSend(ui);
    await act(async () => {});
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(draftOf(ui)).toBe(DRAFT);
    await act(async () => ui.unmount());
  });

  it('does not send if usage cannot be confirmed after the paywall, and says so', async () => {
    mockPaywall.mockImplementation(async () => {
      mockUsage = null; // the lookup now fails
      return 'purchased';
    });
    const ui = await open(free(0));
    await typeDraft(ui);
    await pressSend(ui);
    await act(async () => {});
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(ui.getByText("Signal couldn't check your subscription status just now. Please try again.")).toBeTruthy();
    expect(draftOf(ui)).toBe(DRAFT);
    await act(async () => ui.unmount());
  });

  it('opens the paywall only once even if Send is pressed again while it is showing', async () => {
    let release: (value: string) => void = () => {};
    mockPaywall.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const ui = await open(free(0));
    await typeDraft(ui);
    await pressSend(ui);
    await pressSend(ui);
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    await act(async () => release('cancelled'));
    await act(async () => ui.unmount());
  });
});

describe('Premium at the monthly limit', () => {
  it('blocks Send without the paywall or the model, says more become available next month, and keeps the draft', async () => {
    const ui = await open(premium(0));
    await typeDraft(ui);
    await pressSend(ui);
    expect(mockPaywall).not.toHaveBeenCalled();
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    expect(ui.getByText('You’ve used your 40 asks this month. More become available next month.')).toBeTruthy(); // the blocked-Send message
    expect(ui.getByText('You’ve used your 40 asks this month.')).toBeTruthy(); // the allowance area
    expect(ui.getByText('More become available next month.')).toBeTruthy();
    expect(ui.queryByText(/Resets/)).toBeNull();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    expect(draftOf(ui)).toBe(DRAFT);
    await act(async () => ui.unmount());
  });
});

describe('unknown usage never blocks, and the server stays authoritative', () => {
  it('sends normally when usage is unknown (not treated as zero)', async () => {
    const ui = await open(null);
    await typeDraft(ui);
    await pressSend(ui);
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(1));
    expect(mockPaywall).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });

  it('a server rate-limit on a send the app thought was allowed removes the unanswered question, restores the draft, and offers the paywall once', async () => {
    mockSendSignalMessage.mockResolvedValue({ available: false, reason: 'rate_limited' });
    const ui = await open(free(1)); // stale: the server says there is nothing left
    await typeDraft(ui);
    mockUsage = free(0);
    await pressSend(ui);
    await waitFor(() => expect(mockPaywall).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockSendSignalMessage).toHaveBeenCalledTimes(1);
    expect(ui.queryByLabelText(/^Your question/)).toBeNull(); // no unanswered question left in the thread
    expect(draftOf(ui)).toBe(DRAFT);
    await act(async () => ui.unmount());
  });

  it('after that rate-limit, a purchase resumes the same question once with the same request id', async () => {
    mockSendSignalMessage.mockResolvedValueOnce({ available: false, reason: 'rate_limited' }).mockResolvedValue(REPLY);
    mockPaywall.mockImplementation(async () => {
      mockUsage = premium(40);
      return 'purchased';
    });
    const ui = await open(free(1));
    await typeDraft(ui);
    mockUsage = free(0);
    await pressSend(ui);
    await waitFor(() => expect(mockSendSignalMessage).toHaveBeenCalledTimes(2));
    expect(mockSendSignalMessage.mock.calls[0]![3]).toBe('req-1');
    expect(mockSendSignalMessage.mock.calls[1]![3]).toBe('req-1');
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ui.getByText('Here you go.')).toBeTruthy());
    expect(ui.getAllByLabelText(/^Your question/)).toHaveLength(1);
    await act(async () => ui.unmount());
  });
});

describe('purchase and restore update the allowance area', () => {
  it('Explore Premium re-reads entitlement and usage when the paywall returns, so the area becomes Premium', async () => {
    mockPaywall.mockImplementation(async () => {
      mockUsage = premium(40);
      return 'purchased';
    });
    const ui = await open(free(2));
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Explore Premium'));
    });
    await waitFor(() => expect(ui.getByText('40 of 40 asks remaining this month')).toBeTruthy());
    expect(mockRefreshPremium).toHaveBeenCalled();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    expect(mockSendSignalMessage).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });
});
