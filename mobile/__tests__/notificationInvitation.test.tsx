import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { NotificationInvitationHost } from '@/components/notifications/NotificationInvitationHost';
import { resetOverlayBlockers, setOverlayBlocked } from '@/lib/overlayBlockers';

/**
 * The root-level invitation sheet: shown only when an invitation is due and it is safe (initial paywall settled, no consent sheet or paywall up),
 * latched while presented, and never asking iOS for permission until Enable is tapped.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockSettled = true;
jest.mock('@/components/InitialPaywallGate', () => ({ useInitialPaywallSettled: () => mockSettled }));

const mockEnable = jest.fn();
const mockDismiss = jest.fn();
const mockPresented = jest.fn();
const mockOpenSettings = jest.fn();
let mockInvitation: { kind: 'racePrep'; raceId: string } | { kind: 'betweenRace' } | null = null;
jest.mock('@/lib/notifications/NotificationsProvider', () => ({
  useNotifications: () => ({
    invitation: mockInvitation,
    prefs: { racePrep: { weeklyDay: 0, weeklyHour: 16, weeklyMinute: 0 }, betweenRace: { day: 0, hour: 16, minute: 0 } },
    enable: mockEnable,
    dismissInvitation: mockDismiss,
    markInvitationPresented: mockPresented,
    openSystemSettings: mockOpenSettings,
  }),
}));

beforeEach(() => {
  resetOverlayBlockers();
  mockSettled = true;
  mockInvitation = null;
  // Like the real provider: once the athlete has enabled it or dismissed it, the invitation is no longer due.
  mockEnable.mockReset().mockImplementation(async () => {
    mockInvitation = null;
    return 'enabled';
  });
  mockDismiss.mockReset().mockImplementation(async () => {
    mockInvitation = null;
  });
  mockPresented.mockReset();
  mockOpenSettings.mockReset();
});

describe('when it appears', () => {
  it('shows nothing without an invitation', async () => {
    const ui = await render(<NotificationInvitationHost />);
    expect(ui.queryByTestId('notification-invitation')).toBeNull();
  });

  it('waits for the initial paywall to settle and for any other overlay to close', async () => {
    mockInvitation = { kind: 'betweenRace' };
    mockSettled = false;
    const ui = await render(<NotificationInvitationHost />);
    expect(ui.queryByTestId('notification-invitation')).toBeNull();
    expect(mockPresented).not.toHaveBeenCalled();

    mockSettled = true;
    await act(async () => setOverlayBlocked('signal-consent', true));
    await ui.rerender(<NotificationInvitationHost />);
    expect(ui.queryByTestId('notification-invitation')).toBeNull();

    await act(async () => setOverlayBlocked('signal-consent', false));
    await ui.rerender(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByTestId('notification-invitation')).toBeTruthy());
    expect(mockPresented).toHaveBeenCalledTimes(1);
  });

  it('stays up once presented even though presenting uses the one-time invitation up', async () => {
    mockInvitation = { kind: 'betweenRace' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByTestId('notification-invitation')).toBeTruthy());
    mockInvitation = null; // the provider has now marked it shown
    await ui.rerender(<NotificationInvitationHost />);
    expect(ui.getByTestId('notification-invitation')).toBeTruthy();
    expect(mockPresented).toHaveBeenCalledTimes(1);
  });
});

describe('copy', () => {
  it('race prep: "Stay ahead of race prep" with Enable reminders and Not now', async () => {
    mockInvitation = { kind: 'racePrep', raceId: 'r1' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByText('Stay ahead of race prep')).toBeTruthy());
    expect(ui.getByText(/Sundays at 4 p\.m\./)).toBeTruthy();
    expect(ui.getByLabelText('Enable reminders')).toBeTruthy();
    expect(ui.getByLabelText('Not now')).toBeTruthy();
    expect(mockPresented).not.toHaveBeenCalled(); // only the between-race invitation is a one-time presentation
  });

  it('between-race: "Think about what comes next", and it says sending needs an available ask or Premium', async () => {
    mockInvitation = { kind: 'betweenRace' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByText('Think about what comes next')).toBeTruthy());
    expect(ui.getByText(/Sending it needs an available Signal ask or Premium\./)).toBeTruthy();
    expect(ui.getByText(/opens a Signal draft you can edit/)).toBeTruthy();
  });
});

describe('choices', () => {
  it('asks for permission only when Enable is tapped, and closes when it is enabled', async () => {
    mockInvitation = { kind: 'racePrep', raceId: 'r1' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByLabelText('Enable reminders')).toBeTruthy());
    expect(mockEnable).not.toHaveBeenCalled(); // showing the sheet never touches the OS permission
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Enable reminders'));
    });
    expect(mockEnable).toHaveBeenCalledWith('racePrep');
    await waitFor(() => expect(ui.queryByTestId('notification-invitation')).toBeNull());
  });

  it('"Not now" dismisses it permanently and closes', async () => {
    mockInvitation = { kind: 'betweenRace' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByLabelText('Not now')).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Not now'));
    });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockEnable).not.toHaveBeenCalled();
    await waitFor(() => expect(ui.queryByTestId('notification-invitation')).toBeNull());
  });

  it('when iOS permission is refused, explains where to turn it on, offers Open iOS Settings, and does not ask again after Close', async () => {
    mockEnable.mockImplementation(async () => 'denied'); // refused: the invitation stays due until it is closed
    mockInvitation = { kind: 'betweenRace' };
    const ui = await render(<NotificationInvitationHost />);
    await waitFor(() => expect(ui.getByLabelText('Enable prompts')).toBeTruthy());
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Enable prompts'));
    });
    expect(ui.getByText('Notifications are off for RaceSignal')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Open iOS Settings'));
    });
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Close'));
    });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ui.queryByTestId('notification-invitation')).toBeNull());
  });
});
