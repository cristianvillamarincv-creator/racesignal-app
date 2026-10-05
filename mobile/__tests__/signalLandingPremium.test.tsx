import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AskScreen from '@/app/(tabs)/ask';

/**
 * The Signal tab's single allowance card (below the ask row, above Recent Signals): the server-confirmed count and Premium for free
 * athletes, the monthly count and reset time for Premium, nothing while usage is unknown; Developer Preview never reads usage.
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

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('Signal tab: one allowance card for a confirmed free athlete', () => {
  it('asks remaining: heading, count, no-renewal plus what Premium includes, and the action; one card between the ask row and Recent Signals', async () => {
    const ui = await open(free(2));
    expect(ui.getByText('Keep exploring your race history')).toBeTruthy();
    expect(ui.getByText('2 of 3 free asks remaining')).toBeTruthy();
    expect(ui.getByText('Your free asks don\u2019t renew. Premium includes 40 asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();

    // The separate allowance block and the long promotional paragraph are gone: one card, one action.
    expect(ui.getAllByTestId('signal-allowance-card')).toHaveLength(1);
    expect(ui.queryByTestId('signal-allowance-summary')).toBeNull();
    expect(ui.queryByText(/Compare your results/)).toBeNull();
    expect(ui.queryByText(/Your 3 free asks don/)).toBeNull();
    expect(ui.getAllByLabelText('Explore Premium')).toHaveLength(1);

    const ask = position(ui, 'Ask Signal anything');
    const card = position(ui, 'Keep exploring your race history');
    const recent = position(ui, 'Recent Signals');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(card);
    expect(card).toBeLessThan(recent);
    await act(async () => ui.unmount());
  });

  it('uses the actual count with correct wording (one ask left is still "1 of 3 free asks")', async () => {
    const ui = await open(free(1));
    expect(ui.getByText('1 of 3 free asks remaining')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('exhausted: the used-up message and the Premium line under the same heading, with the action', async () => {
    const ui = await open(free(0));
    expect(ui.getByText('Keep exploring your race history')).toBeTruthy();
    expect(ui.getByText('You\u2019ve used your 3 free asks.')).toBeTruthy();
    expect(ui.getByText('Get 40 Signal asks each month with Premium.')).toBeTruthy();
    expect(ui.getByLabelText('Explore Premium')).toBeTruthy();
    expect(ui.queryByText(/free asks remaining/)).toBeNull();
    await act(async () => ui.unmount());
  });

  it('follows the locked metrics: padding, corners, type sizes, spacing, 44pt action, and content-driven height', async () => {
    const ui = await open(free(2));
    const card = flat(ui.getByTestId('signal-allowance-card'));
    expect(card).toMatchObject({ padding: 16, borderRadius: 16, borderWidth: 1 });
    expect(card.height).toBeUndefined();
    expect(card.maxHeight).toBeUndefined();
    expect(flat(ui.getByText('Keep exploring your race history'))).toMatchObject({ fontSize: 18, fontWeight: '600' });
    for (const line of ['2 of 3 free asks remaining', 'Your free asks don\u2019t renew. Premium includes 40 asks each month.']) {
      expect(flat(ui.getByText(line))).toMatchObject({ fontSize: 14, fontWeight: '400', lineHeight: 20 });
    }
    // 8pt from heading to body (the body wrapper), 12pt before the action, 44pt minimum touch target.
    expect(flat(ui.getByText('2 of 3 free asks remaining').parent!)).toMatchObject({ marginTop: 8 });
    expect(flat(ui.getByLabelText('Explore Premium'))).toMatchObject({ marginTop: 12, minHeight: 44 });
    // 16pt below the ask row and 24pt above Recent Signals, against the screen's 32pt section gap.
    expect(flat(ui.getByTestId('signal-allowance-card').parent!)).toMatchObject({ marginTop: 16 - 32, marginBottom: 24 - 32 });
    await act(async () => ui.unmount());
  });

  it('keeps asking Signal the primary action and promises nothing unbuilt', async () => {
    const ui = await open(free(2));
    expect(JSON.stringify(ui.toJSON())).not.toMatch(/unlimited|prediction|notification/i);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Ask Signal anything'));
    });
    expect(mockPush).toHaveBeenCalledWith('/signal');
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
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    await act(async () => ui.unmount());
  });
});

describe('Signal tab: Premium athlete uses the same card without promotion', () => {
  it('shows only the monthly count: no heading, no action, and no reset date or hidden reset text', async () => {
    const ui = await open(premium(28));
    expect(ui.getAllByTestId('signal-allowance-card')).toHaveLength(1);
    expect(ui.getByText('28 of 40 asks remaining this month')).toBeTruthy();
    expect(ui.queryByText(/Resets/)).toBeNull();
    expect(ui.queryByLabelText(/Resets/)).toBeNull();
    expect(JSON.stringify(ui.toJSON())).not.toMatch(/Resets/);
    expect(ui.queryByText('Keep exploring your race history')).toBeNull();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    await act(async () => ui.unmount());
  });

  it('at its monthly limit: the used-up message and that more become available next month, with no action', async () => {
    const ui = await open(premium(0));
    expect(ui.getByText('You\u2019ve used your 40 asks this month.')).toBeTruthy();
    expect(ui.getByText('More become available next month.')).toBeTruthy();
    expect(ui.queryByLabelText('Explore Premium')).toBeNull();
    expect(ui.queryByText(/free asks/)).toBeNull();
    await act(async () => ui.unmount());
  });
});

describe('Signal tab: unknown usage and Developer Preview', () => {
  it('shows no card when usage is unknown (the plan and count are not guessed), and the tab still works', async () => {
    const ui = await open(null);
    expect(ui.queryByTestId('signal-allowance-card')).toBeNull();
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
