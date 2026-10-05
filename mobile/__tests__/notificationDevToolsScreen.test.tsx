import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { NotificationDevTools } from '@/components/notifications/NotificationDevTools';
import type { Race } from '@/fixtures/races';
import { createFakeApi } from './helpers/fakeNotificationsApi';

/** The development test screen: on-screen diagnostics, a result for every button, never stuck, and absent from the production variant. */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockVariant: 'development' | 'production' = 'development';
jest.mock('@/lib/environment', () => ({ getAppVariant: () => mockVariant }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'athlete-1' } } }) }));
let mockRaces: Race[] = [];
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ data: mockRaces }) }));
let mockFake: ReturnType<typeof createFakeApi>;
jest.mock('@/lib/notifications/NotificationsProvider', () => ({
  useNotifications: () => ({ api: mockFake.api, openSystemSettings: () => mockFake.api.openSystemSettings() }),
}));

const completed = (): Race => ({ id: 'c1', name: 'Done', sport: 'running', distanceLabel: '10K', eventDate: '2025-04-20', location: '', status: 'completed', isManual: false }) as Race;

beforeEach(() => {
  mockVariant = 'development';
  mockRaces = [completed(), completed(), completed()];
  mockFake = createFakeApi({ permission: 'granted' });
});

describe('notification test screen', () => {
  it('is not rendered in the production variant', async () => {
    mockVariant = 'production';
    const ui = await render(<NotificationDevTools />);
    expect(ui.queryByTestId('notification-dev-tools')).toBeNull();
    expect(mockFake.state.scheduled).toEqual([]);
  });

  it('shows the real iOS permission, pending counts and the races this account actually has loaded', async () => {
    const ui = await render(<NotificationDevTools />);
    await waitFor(() => expect(ui.getByText(/iOS notification permission: granted/)).toBeTruthy());
    expect(ui.getByText(/Races loaded for this account: 3 \(3 completed, 0 upcoming dated today or later\)\. Removed races are not loaded\./)).toBeTruthy();
    expect(ui.getByText(/Pending with iOS: 0/)).toBeTruthy();
  });

  it('the standalone test shows a confirmation with the identifier and delivery time, verified against iOS, with no race needed', async () => {
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Test notification in 60 seconds'));
    });
    await waitFor(() => expect(ui.getByTestId('result-basic').props.children).toMatch(/Scheduled rs-test:athlete-1:basic:\d+\. iOS will deliver it at/));
    expect(mockFake.state.scheduled).toHaveLength(1);
    expect(mockFake.state.pending.size).toBe(1);
  });

  it('a race test with no upcoming race explains why instead of doing nothing', async () => {
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Race-prep weekly in ~1 min'));
    });
    await waitFor(() => expect(ui.getByTestId('result-weekly').props.children).toMatch(/Nothing was scheduled: race-prep tests need an upcoming race.*3 races loaded \(3 completed/));
    expect(mockFake.state.scheduled).toEqual([]);
  });

  it('a denied permission is reported with an Open iOS Settings shortcut', async () => {
    mockFake = createFakeApi({ permission: 'denied' });
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Test notification in 60 seconds'));
    });
    await waitFor(() => expect(ui.getByTestId('result-basic').props.children).toMatch(/turned off for RaceSignal \(status: denied\)/));
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Open iOS Settings'));
    });
    expect(mockFake.state.settingsOpened).toBe(1);
  });

  it('shows an actionable error when iOS refuses to schedule, and the buttons work again afterwards', async () => {
    mockFake.state.scheduleError = new Error('Failed to build notification request');
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Calendar-trigger test (same trigger as real reminders)'));
    });
    await waitFor(() => expect(ui.getByTestId('result-calendar').props.children).toMatch(/iOS did not accept the notification\. Failed to build notification request/));
    mockFake.state.scheduleError = null;
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Test notification in 60 seconds'));
    });
    await waitFor(() => expect(ui.getByTestId('result-basic').props.children).toMatch(/Scheduled rs-test/));
  });

  it('cannot stay stuck: a scheduler that never answers ends with a timeout message and re-enables the buttons', async () => {
    jest.useFakeTimers();
    mockFake.state.scheduleHangs = true;
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Test notification in 60 seconds'));
    });
    await act(async () => {
      jest.advanceTimersByTime(11_000);
    });
    await waitFor(() => expect(ui.getByTestId('result-basic').props.children).toMatch(/Scheduling did not finish within 10 seconds/));
    expect(ui.getByLabelText('Test notification in 60 seconds').props.accessibilityState.disabled).toBe(false);
    jest.useRealTimers();
  });

  it('lists pending notifications and cancels only the test ones', async () => {
    await mockFake.api.schedule({ identifier: 'rs:athlete-1:weekly:a', title: 'Race prep', body: 'b', data: {}, fireAt: { year: 2026, month: 12, day: 6, hour: 16, minute: 0 } });
    const ui = await render(<NotificationDevTools />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Test notification in 60 seconds'));
    });
    await waitFor(() => expect(mockFake.state.pending.size).toBe(2));
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Cancel test notifications'));
    });
    await waitFor(() => expect(mockFake.state.pending.size).toBe(1));
    expect(mockFake.state.pending.has('rs:athlete-1:weekly:a')).toBe(true);
  });
});
