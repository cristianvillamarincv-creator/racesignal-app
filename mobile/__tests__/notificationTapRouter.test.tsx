import React from 'react';
import { act, render } from '@testing-library/react-native';

import { NotificationTapRouter, resetHandledTaps } from '@/components/notifications/NotificationTapRouter';
import type { Race } from '@/fixtures/races';
import { resetOverlayBlockers, setOverlayBlocked } from '@/lib/overlayBlockers';
import { Alert } from 'react-native';

/**
 * Tapping a notification: validated against the signed-in account and current data, handled exactly once (cold start and warm taps arrive the same
 * way), cleared afterwards, held until it is safe, and dropped in onboarding or when signed out.
 */

let mockVariant: 'development' | 'production' = 'development';
jest.mock('@/lib/environment', () => ({ getAppVariant: () => mockVariant }));
const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, navigate: mockNavigate }) }));
let mockTap: { key: string; data: unknown } | null | undefined = null;
const mockClear = jest.fn();
jest.mock('@/lib/notifications/api', () => ({ useLastTap: () => mockTap, clearLastResponse: () => mockClear() }));
let mockSession: { user: { id: string } } | null = { user: { id: 'athlete-1' } };
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: mockSession }) }));
let mockRaces: { isLoading: boolean; data: Race[] } = { isLoading: false, data: [] };
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => mockRaces }));
let mockSettled = true;
jest.mock('@/components/InitialPaywallGate', () => ({ useInitialPaywallSettled: () => mockSettled }));

const race = (overrides: Partial<Race> = {}): Race =>
  ({ id: 'r1', name: 'Test Tri', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2027-01-01', location: '', status: 'registered', isManual: true, ...overrides }) as Race;
const tap = (data: unknown, key = 'tap-1') => ({ key, data });

beforeEach(() => {
  resetHandledTaps();
  resetOverlayBlockers();
  mockPush.mockReset();
  mockNavigate.mockReset();
  mockClear.mockReset();
  mockTap = null;
  mockSession = { user: { id: 'athlete-1' } };
  mockRaces = { isLoading: false, data: [race()] };
  mockSettled = true;
  mockVariant = 'development';
});

const mountRouter = async (phase: 'app' | 'onboarding' = 'app') => render(<NotificationTapRouter phase={phase} />);

describe('routing a tap', () => {
  it('opens the race checklist with the item to highlight, once, and clears the response', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1', i: 'travel-hotel' });
    const view = await mountRouter();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/race/[id]', params: { id: 'r1', prep: 'travel-hotel' } });
    expect(mockClear).toHaveBeenCalledTimes(1);
    // The same response delivered again (cold start then a live event) does nothing more.
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('a different tap is handled separately', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1' }, 'tap-1');
    const view = await mountRouter();
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1', i: 'travel-hotel' }, 'tap-2');
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('opens the Races list for a combined reminder, a deleted race and a completed race', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep-list' });
    await mountRouter();
    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();

    resetHandledTaps();
    mockNavigate.mockReset();
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'gone', i: 'travel-hotel' }, 'tap-2');
    await mountRouter();
    expect(mockNavigate).toHaveBeenCalledWith('/');

    resetHandledTaps();
    mockNavigate.mockReset();
    mockRaces = { isLoading: false, data: [race({ status: 'completed' })] };
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1' }, 'tap-3');
    await mountRouter();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('opens Signal with the starter for a between-race prompt', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'between', p: 'went-well' });
    await mountRouter();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/signal', params: { starter: 'went-well' } });
  });

  it('opens the checklist without a highlight when the item was checked after the notification was scheduled', async () => {
    mockRaces = { isLoading: false, data: [race({ checklistCompleted: ['travel-hotel'] })] };
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1', i: 'travel-hotel' });
    await mountRouter();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/race/[id]', params: { id: 'r1', prep: '1' } });
  });
});

describe('account and state validation', () => {
  it('ignores (and clears) a notification that belongs to another account', async () => {
    mockTap = tap({ v: 1, a: 'someone-else', t: 'prep', r: 'r1' });
    await mountRouter();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();
  });

  it('ignores malformed data', async () => {
    mockTap = tap({ nonsense: true });
    await mountRouter();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('drops a tap that arrives during onboarding or while signed out instead of holding it for later', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1' });
    const view = await mountRouter('onboarding');
    expect(mockClear).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    // Even if the app reaches the app phase later, that old tap is not replayed.
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('waits while races are loading, a paywall or consent sheet is showing, or the initial paywall has not settled', async () => {
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1' });
    mockRaces = { isLoading: true, data: [] };
    const view = await mountRouter();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled(); // still pending, not lost

    mockRaces = { isLoading: false, data: [race()] };
    mockSettled = false;
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).not.toHaveBeenCalled();

    mockSettled = true;
    await act(async () => setOverlayBlocked('signal-consent', true));
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => setOverlayBlocked('signal-consent', false));
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no tap, or the OS has not answered yet', async () => {
    mockTap = null;
    await mountRouter();
    mockTap = undefined;
    await mountRouter();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('the development test notification', () => {
  it('confirms the tap in the development variant, once, and navigates nowhere', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'test' });
    const view = await mountRouter();
    expect(alertSpy).toHaveBeenCalledWith('Test notification tapped', expect.stringMatching(/Tap handling works/));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await view.rerender(<NotificationTapRouter phase="app" />);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  it('shows nothing in the production variant, and ignores a test notification for another account', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockVariant = 'production';
    mockTap = tap({ v: 1, a: 'athlete-1', t: 'test' });
    await mountRouter();
    expect(alertSpy).not.toHaveBeenCalled();
    resetHandledTaps();
    mockVariant = 'development';
    mockTap = tap({ v: 1, a: 'someone-else', t: 'test' }, 'tap-2');
    await mountRouter();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
