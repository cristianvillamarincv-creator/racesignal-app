import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';

/**
 * Sign-out and account deletion clean up this feature: notifications are cancelled BEFORE sign-out, and deletion also clears the account's
 * notification preferences and rotation and its unsent Signal draft.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const order: string[] = [];
const mockResetToOnboarding = jest.fn();
jest.mock('@/lib/appPhase', () => ({ useAppPhase: () => ({ resetToOnboarding: () => mockResetToOnboarding() }) }));
const mockSignOut = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'athlete-1', email: 'a@example.com', app_metadata: {} } },
    signOut: () => {
      order.push('signOut');
      return mockSignOut();
    },
    linkProvider: jest.fn(),
    getConnectedProviders: jest.fn().mockResolvedValue([]),
  }),
}));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ racingName: 'Test' }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ enterOnboardingReplayFromSettings: jest.fn() }) }));
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: jest.fn(), restorePurchases: jest.fn() }) }));
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: jest.fn() }));
jest.mock('@/lib/signalConsent', () => ({ clearSignalConsent: jest.fn().mockResolvedValue(undefined), hasAgreedToSignalDisclosure: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/socialAuth', () => ({ requestAppleRevocationCode: jest.fn() }));
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => ({ apple: false, google: false }) }));
const mockDeleteAccount = jest.fn();
jest.mock('@/lib/deleteAccount', () => ({ deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args) }));
jest.mock('@/lib/findRacesRetryDraft', () => ({ clearFindRacesRetryDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/onboardingDraft', () => ({ clearOnboardingDraft: jest.fn().mockResolvedValue(undefined) }));
const mockCancelAll = jest.fn();
jest.mock('@/lib/notifications/NotificationsProvider', () => ({
  useNotifications: () => ({
    prefs: {
      racePrep: { enabled: false, weeklyDay: 0, weeklyHour: 16, weeklyMinute: 0, milestoneHour: 16, milestoneMinute: 0, offer: 'unseen' },
      betweenRace: { enabled: false, day: 0, hour: 16, minute: 0, invite: 'unseen' },
    },
    permission: 'granted',
    enable: jest.fn(),
    disable: jest.fn(),
    updateSchedule: jest.fn(),
    openSystemSettings: jest.fn(),
    cancelAllForSignOut: () => {
      order.push('cancelNotifications');
      return mockCancelAll();
    },
    api: {},
  }),
}));
const mockClearState = jest.fn();
jest.mock('@/lib/notifications/prefsStorage', () => ({ clearNotificationState: (...args: unknown[]) => mockClearState(...args) }));
const mockClearDraft = jest.fn();
jest.mock('@/lib/signalDraft', () => ({ clearSignalDraft: (...args: unknown[]) => mockClearDraft(...args) }));
jest.mock('@/components/notifications/NotificationDevTools', () => ({ NotificationDevTools: () => null }));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  order.length = 0;
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockCancelAll.mockReset().mockResolvedValue(undefined);
  mockClearState.mockReset().mockResolvedValue(undefined);
  mockClearDraft.mockReset().mockResolvedValue(undefined);
  mockDeleteAccount.mockReset().mockResolvedValue({ available: true });
  mockResetToOnboarding.mockReset();
});

describe('sign-out and account deletion', () => {
  it('cancels this account’s notifications before signing out', async () => {
    const ui = await render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign out'));
    });
    await waitFor(() => expect(mockResetToOnboarding).toHaveBeenCalled());
    expect(order).toEqual(['cancelNotifications', 'signOut']);
    expect(mockClearState).not.toHaveBeenCalled(); // sign-out keeps the athlete's preferences on this device
    expect(mockClearDraft).not.toHaveBeenCalled(); // and their unsent draft
  });

  it('still signs out if cancelling fails', async () => {
    mockCancelAll.mockRejectedValue(new Error('no scheduler'));
    const ui = await render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign out'));
    });
    await waitFor(() => expect(mockResetToOnboarding).toHaveBeenCalled());
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('on account deletion, cancels notifications and clears this athlete’s notification state and Signal draft', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ui = await render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Delete account'));
    });
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Delete')!.onPress!();
    });
    await waitFor(() => expect(mockResetToOnboarding).toHaveBeenCalled());
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockCancelAll).toHaveBeenCalled();
    expect(mockClearState).toHaveBeenCalledWith('athlete-1');
    expect(mockClearDraft).toHaveBeenCalledWith('athlete-1');
    alertSpy.mockRestore();
  });

  it('keeps everything when the deletion itself fails', async () => {
    mockDeleteAccount.mockResolvedValue({ available: false, reason: 'service_unavailable' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ui = await render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Delete account'));
    });
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Delete')!.onPress!();
    });
    expect(mockClearState).not.toHaveBeenCalled();
    expect(mockClearDraft).not.toHaveBeenCalled();
    expect(mockCancelAll).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
