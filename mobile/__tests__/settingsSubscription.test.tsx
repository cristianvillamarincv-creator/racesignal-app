import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';

/**
 * Settings → Subscription. Free: the plan, "3 free Signal asks total. They don't renew.", and "Explore RaceSignal Premium" with what
 * Premium includes (it never says "3 included" as if that meant 3 remain). Premium: the ACTIVE plan and its monthly asks. Restore
 * Purchases stays in both. Returning from the paywall re-reads entitlement. No live balance is shown here.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/appPhase', () => ({ useAppPhase: () => ({ resetToOnboarding: jest.fn() }) }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'athlete-1', email: 'athlete@example.com' } },
    signOut: jest.fn(),
    linkProvider: jest.fn(),
    getConnectedProviders: jest.fn().mockResolvedValue([]),
  }),
}));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ racingName: 'Test Athlete' }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ enterOnboardingReplayFromSettings: jest.fn() }) }));
let mockIsPremium = false;
const mockRefreshPremium = jest.fn();
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: mockIsPremium, refresh: mockRefreshPremium, restorePurchases: jest.fn() }) }));
const mockPaywall = jest.fn();
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: () => mockPaywall() }));
jest.mock('@/lib/signalConsent', () => ({ clearSignalConsent: jest.fn(), hasAgreedToSignalDisclosure: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/socialAuth', () => ({ requestAppleRevocationCode: jest.fn() }));
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => ({ apple: false, google: false }) }));
jest.mock('@/lib/deleteAccount', () => ({ deleteAccount: jest.fn() }));
jest.mock('@/lib/findRacesRetryDraft', () => ({ clearFindRacesRetryDraft: jest.fn() }));
jest.mock('@/lib/onboardingDraft', () => ({ clearOnboardingDraft: jest.fn() }));
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
    cancelAllForSignOut: jest.fn().mockResolvedValue(undefined),
    api: {},
  }),
}));
jest.mock('@/lib/notifications/prefsStorage', () => ({ clearNotificationState: jest.fn() }));
jest.mock('@/lib/signalDraft', () => ({ clearSignalDraft: jest.fn() }));
jest.mock('@/components/notifications/NotificationDevTools', () => ({ NotificationDevTools: () => null }));

beforeEach(() => {
  mockIsPremium = false;
  mockPaywall.mockReset().mockResolvedValue('cancelled');
  mockRefreshPremium.mockReset().mockResolvedValue(undefined);
});

describe('Settings subscription section', () => {
  it('free: states the 3 asks are a non-renewing total, offers Explore RaceSignal Premium with its 40 monthly asks, and keeps Restore', async () => {
    const ui = await render(<SettingsScreen />);
    await act(async () => {});
    expect(ui.getByText('RaceSignal Free')).toBeTruthy();
    expect(ui.getByText('3 free Signal asks total. They don’t renew.')).toBeTruthy();
    expect(ui.getByText('Explore RaceSignal Premium')).toBeTruthy();
    expect(ui.getByText('40 Signal asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Restore Purchases')).toBeTruthy();
    expect(ui.queryByText(/included/i)).toBeNull();
    expect(ui.queryByText(/Upgrade to RaceSignal Premium/)).toBeNull();
    await act(async () => ui.unmount());
  });

  it('Premium: the ACTIVE plan with its monthly asks, no upgrade row, and Restore still available', async () => {
    mockIsPremium = true;
    const ui = await render(<SettingsScreen />);
    await act(async () => {});
    expect(ui.getByText('RaceSignal Premium')).toBeTruthy();
    expect(ui.getByText('ACTIVE')).toBeTruthy();
    expect(ui.getByText('40 Signal asks each month.')).toBeTruthy();
    expect(ui.queryByText('Explore RaceSignal Premium')).toBeNull();
    expect(ui.queryByText('RaceSignal Free')).toBeNull();
    expect(ui.getByLabelText('Restore Purchases')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Explore RaceSignal Premium opens the existing paywall and re-reads entitlement when it returns', async () => {
    const ui = await render(<SettingsScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Explore RaceSignal Premium, 40 Signal asks each month.'));
    });
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    expect(mockRefreshPremium).toHaveBeenCalledTimes(1);
    await act(async () => ui.unmount());
  });
});
