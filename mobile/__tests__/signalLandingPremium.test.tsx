import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AskScreen from '@/app/(tabs)/ask';

/**
 * The Signal tab's Premium awareness: the server-confirmed allowance near the question entry, and one Premium card for confirmed free
 * athletes only (below the entry, above Recent Signals). Premium athletes see their monthly count and reset time instead of the
 * card; unknown usage shows neither; Developer Preview never reads usage.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'athlete-1' } } }) }));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ isLoading: false, isError: false, data: [] }) }));
let mockPreview = false;
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => true, useDevPreview: () => ({ mode: mockPreview ? 'browse' : 'off' }) }));
const mockRefreshPremium = jest.fn();
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: mockRefreshPremium }) }));
const mockPaywall = jest.fn();
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: () => mockPaywall() }));
jest.mock('@/lib/db/signal', () => ({
  fetchRecentSignalConversations: jest.fn().mockResolvedValue([{ id: 'c1', title: 'Earlier chat', updated_at: new Date().toISOString() }]),
}));
jest.mock('@/lib/signalContext', () => ({ getSuggestedPrompts: () => [], hasCompletedResults: () => false }));
const mockFetchSignalUsage = jest.fn();
jest.mock('@/lib/signal', () => ({ fetchSignalUsage: () => mockFetchSignalUsage() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));

type Usage = { remaining: number; cap: number; isPremium: boolean; resetsAt: string | null } | null;
const free = (remaining: number): Usage => ({ remaining, cap: 3, isPremium: false, resetsAt: null });
const premium = (remaining: number): Usage => ({ remaining, cap: 40, isPremium: true, resetsAt: '2026-11-01T00:00:00.000Z' });
let mockUsage: Usage;

beforeEach(() => {
  mockPreview = false;
  mockUsage = null;
  mockFetchSignalUsage.mockReset().mockImplementation(async () => mockUsage);
  mockPaywall.mockReset().mockResolvedValue('cancelled');
  mockRefreshPremium.mockReset().mockResolvedValue(undefined);
  mockPush.mockReset();
});

async function open(usage: Usage) {
  mockUsage = usage;
  const ui = await render(<AskScreen />);
  await act(async () => {});
  await waitFor(() => expect(ui.getByText('Earlier chat')).toBeTruthy());
  return ui;
}
const position = (ui: Awaited<ReturnType<typeof render>>, text: string) => JSON.stringify(ui.toJSON()).indexOf(text);

describe('Signal tab: confirmed free athlete', () => {
  it('shows the server count with "don’t renew" near the question entry, and the Premium card between it and Recent Signals', async () => {
    const ui = await open(free(2));
    expect(ui.getByText('2 of 3 free asks remaining')).toBeTruthy();
    expect(ui.getByText('Your 3 free asks don’t renew.')).toBeTruthy();
    expect(ui.getByText('Keep exploring your race history')).toBeTruthy();
    expect(ui.getByText('Compare your results, revisit race details and ask follow-up questions with 40 Signal asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();

    const ask = position(ui, 'Ask Signal anything');
    const allowance = position(ui, '2 of 3 free asks remaining');
    const card = position(ui, 'Keep exploring your race history');
    const recent = position(ui, 'Recent Signals');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(allowance);
    expect(allowance).toBeLessThan(card);
    expect(card).toBeLessThan(recent);
    await act(async () => ui.unmount());
  });

  it('keeps asking Signal the primary action: one Explore Premium control, in the card only, and nothing promises unbuilt features', async () => {
    const ui = await open(free(2));
    expect(ui.getAllByLabelText('Explore Premium')).toHaveLength(1);
    const text = JSON.stringify(ui.toJSON());
    expect(text).not.toMatch(/unlimited|prediction|notification/i);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Ask Signal anything'));
    });
    expect(mockPush).toHaveBeenCalledWith('/signal');
    await act(async () => ui.unmount());
  });

  it('a free balance of zero still shows the real count and the card', async () => {
    const ui = await open(free(0));
    expect(ui.getByText('0 of 3 free asks remaining')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Explore Premium opens the existing paywall, then re-reads entitlement and usage so the tab reflects a purchase', async () => {
    mockPaywall.mockImplementation(async () => {
      mockUsage = premium(40);
      return 'purchased';
    });
    const ui = await open(free(1));
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Explore Premium'));
    });
    await waitFor(() => expect(ui.getByText('40 of 40 asks remaining this month')).toBeTruthy());
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    expect(mockRefreshPremium).toHaveBeenCalled();
    expect(ui.queryByText('Keep exploring your race history')).toBeNull();
    await act(async () => ui.unmount());
  });
});

describe('Signal tab: Premium athlete', () => {
  it('shows the monthly count and reset time instead of the promotional card', async () => {
    const ui = await open(premium(28));
    expect(ui.getByText('28 of 40 asks remaining this month')).toBeTruthy();
    expect(ui.getByText(/^Resets /)).toBeTruthy();
    expect(ui.getByLabelText(/^Resets on .*2026/)).toBeTruthy();
    expect(ui.queryByText('Keep exploring your race history')).toBeNull();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    await act(async () => ui.unmount());
  });
});

describe('Signal tab: unknown usage and Developer Preview', () => {
  it('shows neither the allowance nor the card when usage is unknown, and the tab still works', async () => {
    const ui = await open(null);
    expect(ui.queryByText(/asks remaining/)).toBeNull();
    expect(ui.queryByText('Keep exploring your race history')).toBeNull();
    expect(ui.getByLabelText('Ask Signal anything')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Developer Preview never reads usage and shows no Premium card', async () => {
    mockPreview = true;
    const ui = await open(free(2));
    expect(mockFetchSignalUsage).not.toHaveBeenCalled();
    expect(ui.queryByText('Keep exploring your race history')).toBeNull();
    await act(async () => ui.unmount());
  });
});
