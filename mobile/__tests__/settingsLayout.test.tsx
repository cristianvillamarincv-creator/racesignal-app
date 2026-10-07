import React from 'react';
import { Alert, Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import DeveloperToolsScreen from '@/app/settings/developer';
import SettingsScreen from '@/app/settings';
import NotificationsSettingsScreen from '@/app/settings/notifications';
import SignInMethodsScreen from '@/app/settings/sign-in-methods';
import SignalPrivacyScreen from '@/app/settings/signal-privacy';

/**
 * The reorganized Settings: a compact main list (identity header, grouped rows) whose areas open their own detail screens, with
 * Sign out and Delete account directly on the main screen and one Developer entry shown only where an existing development gate
 * allows it. Every control that moved is checked on its new screen.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/appPhase', () => ({ useAppPhase: () => ({ resetToOnboarding: jest.fn() }) }));
const mockLinkProvider = jest.fn();
let mockConnected: { provider: string }[] | null = [];
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'athlete-1', email: 'athlete@example.com', app_metadata: {} } },
    signOut: jest.fn(),
    linkProvider: (...args: unknown[]) => mockLinkProvider(...args),
    getConnectedProviders: () => Promise.resolve(mockConnected),
  }),
}));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ racingName: 'Test Athlete', data: [] }) }));
let mockPreviewAvailable = false;
const mockEnterReplay = jest.fn();
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => mockPreviewAvailable, useDevPreview: () => ({ enterOnboardingReplayFromSettings: mockEnterReplay }) }));
let mockVariant = 'production';
jest.mock('@/lib/environment', () => ({ getAppVariant: () => mockVariant }));
let mockIsPremium = false;
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: mockIsPremium, refresh: jest.fn(), restorePurchases: jest.fn() }) }));
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: jest.fn() }));
let mockConsent = false;
const mockClearConsent = jest.fn();
jest.mock('@/lib/signalConsent', () => ({
  clearSignalConsent: () => mockClearConsent(),
  hasAgreedToSignalDisclosure: () => Promise.resolve(mockConsent),
}));
jest.mock('@/lib/socialAuth', () => ({ requestAppleRevocationCode: jest.fn() }));
let mockSocial = { apple: false, google: false };
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => mockSocial }));
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
    scheduleStatus: null,
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
jest.mock('@/components/notifications/NotificationDevTools', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return { NotificationDevTools: () => <Text>Notification test tools</Text> };
});
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  mockPush.mockReset();
  mockPreviewAvailable = false;
  mockVariant = 'production';
  mockIsPremium = false;
  mockConsent = false;
  mockSocial = { apple: false, google: false };
  mockConnected = [];
  mockClearConsent.mockReset().mockResolvedValue(undefined);
  mockLinkProvider.mockReset();
  mockEnterReplay.mockReset();
});

async function main() {
  const ui = await render(<SettingsScreen />);
  await act(async () => {});
  return ui;
}

describe('main Settings screen', () => {
  it('keeps the identity header and shows the grouped rows, with no controls that moved to a detail screen', async () => {
    const ui = await main();
    expect(ui.getByText('Test Athlete')).toBeTruthy();
    expect(ui.getByText('athlete@example.com')).toBeTruthy();
    for (const header of ['Race history', 'Subscription', 'Preferences', 'Help & legal', 'Account actions']) expect(ui.getByText(header)).toBeTruthy();
    for (const row of ['Add a race manually', 'Find my races', 'Notifications', 'Signal privacy & consent', 'Support', 'Privacy', 'Terms of Use', 'Sign out', 'Delete account']) {
      expect(ui.getByLabelText(row)).toBeTruthy();
    }
    // Moved: none of these controls is on the main screen any more.
    for (const gone of ['Restore Purchases', 'Explore RaceSignal Premium', 'Withdraw Signal consent', 'Preview onboarding', 'Sign-in methods']) expect(ui.queryByLabelText(gone)).toBeNull();
    expect(ui.queryByTestId('notification-settings')).toBeNull();
    expect(ui.queryByText('Developer tools')).toBeNull();
    await act(async () => ui.unmount());
  });

  it('shows Free or Premium on the Plan row under Subscription', async () => {
    let ui = await main();
    expect(ui.getByLabelText('Plan, Free')).toBeTruthy();
    await act(async () => ui.unmount());
    mockIsPremium = true;
    ui = await main();
    expect(ui.getByLabelText('Plan, Premium')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('opens each destination', async () => {
    const ui = await main();
    const expected: [string, unknown][] = [
      ['Add a race manually', '/race/add'],
      ['Find my races', '/find-races'],
      ['Plan, Free', '/settings/subscription'],
      ['Notifications', '/settings/notifications'],
      ['Signal privacy & consent', '/settings/signal-privacy'],
    ];
    for (const [label, path] of expected) {
      mockPush.mockClear();
      await fireEvent.press(ui.getByLabelText(label));
      expect(mockPush).toHaveBeenCalledWith(path);
    }
    await act(async () => ui.unmount());
  });

  it('opens Support, Privacy and Terms directly as links, in that order', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const ui = await main();
    const labels = ['Support', 'Privacy', 'Terms of Use'];
    const positions = labels.map((label) => JSON.stringify(ui.toJSON()).indexOf(`"${label}"`));
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
    for (const label of labels) {
      await fireEvent.press(ui.getByLabelText(label));
    }
    expect(openSpy).toHaveBeenCalledTimes(3);
    openSpy.mockRestore();
    await act(async () => ui.unmount());
  });

  it('has Share feedback under Help & legal, above Support, and it opens the feedback email', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const ui = await main();
    const json = JSON.stringify(ui.toJSON());
    expect(json.indexOf('"Share feedback"')).toBeGreaterThan(json.indexOf('"Help & legal"'));
    expect(json.indexOf('"Share feedback"')).toBeLessThan(json.indexOf('"Support"'));
    await fireEvent.press(ui.getByLabelText('Share feedback'));
    expect(openSpy).toHaveBeenCalledWith('mailto:racesignal@gmail.com?subject=Feedback');
    openSpy.mockRestore();
    await act(async () => ui.unmount());
  });

  it('shows the Sign-in methods row (under Account) only when Apple or Google sign-in is available', async () => {
    let ui = await main();
    expect(ui.queryByLabelText('Sign-in methods')).toBeNull();
    expect(ui.queryByText('Account')).toBeNull();
    await act(async () => ui.unmount());
    mockSocial = { apple: true, google: false };
    ui = await main();
    expect(ui.getByText('Account')).toBeTruthy();
    await fireEvent.press(ui.getByLabelText('Sign-in methods'));
    expect(mockPush).toHaveBeenCalledWith('/settings/sign-in-methods');
    await act(async () => ui.unmount());
  });

  it('has one Developer entry, shown only where an existing development gate allows it', async () => {
    let ui = await main();
    expect(ui.queryByLabelText('Developer tools')).toBeNull();
    await act(async () => ui.unmount());
    for (const [preview, variant] of [[true, 'production'], [false, 'development']] as const) {
      mockPreviewAvailable = preview;
      mockVariant = variant;
      ui = await main();
      expect(ui.getAllByLabelText('Developer tools')).toHaveLength(1);
      await fireEvent.press(ui.getByLabelText('Developer tools'));
      expect(mockPush).toHaveBeenLastCalledWith('/settings/developer');
      await act(async () => ui.unmount());
    }
  });
});

describe('moved controls on their own screens', () => {
  it('Notifications: the switches and schedule live on their own screen, without a repeated section header', async () => {
    const ui = await render(<NotificationsSettingsScreen />);
    expect(ui.getByTestId('notification-settings')).toBeTruthy();
    expect(ui.getAllByRole('switch').length).toBe(2);
    expect(ui.queryByText('Notifications')).toBeNull();
    await act(async () => ui.unmount());
  });

  it('Signal privacy & consent: a quiet status before agreeing, and Withdraw once agreed', async () => {
    let ui = await render(<SignalPrivacyScreen />);
    await act(async () => {});
    expect(ui.getByText('Not yet agreed — you’ll be asked before your first Signal question.')).toBeTruthy();
    expect(ui.queryByLabelText('Withdraw Signal consent')).toBeNull();
    await act(async () => ui.unmount());

    mockConsent = true;
    ui = await render(<SignalPrivacyScreen />);
    await waitFor(() => expect(ui.getByLabelText('Withdraw Signal consent')).toBeTruthy());
    expect(ui.getByText('You’ve agreed to share race data with Anthropic for Signal.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(ui.getByLabelText('Withdraw Signal consent'));
    });
    expect(mockClearConsent).toHaveBeenCalledTimes(1);
    expect(ui.queryByLabelText('Withdraw Signal consent')).toBeNull();
    expect(ui.getByText('Not yet agreed — you’ll be asked before your first Signal question.')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Sign-in methods: email, connected providers, connect actions, the linking guidance and a refused connection', async () => {
    mockSocial = { apple: true, google: true };
    mockConnected = [{ provider: 'google' }];
    mockLinkProvider.mockResolvedValue({ status: 'error', message: 'x' });
    const ui = await render(<SignInMethodsScreen />);
    await act(async () => {});
    expect(ui.getByText('Email')).toBeTruthy();
    expect(ui.getByText('athlete@example.com · sign-in link or password')).toBeTruthy();
    await waitFor(() => expect(ui.getByText('CONNECTED')).toBeTruthy());
    expect(ui.getByText(/Hide My Email/)).toBeTruthy();
    await act(async () => {
      await fireEvent.press(ui.getByLabelText('Connect Apple'));
    });
    expect(mockLinkProvider).toHaveBeenCalledWith('apple');
    await act(async () => ui.unmount());
  });

  it('Developer tools: Preview onboarding only with the preview gate, the notification tools always rendered (they gate themselves)', async () => {
    let ui = await render(<DeveloperToolsScreen />);
    expect(ui.queryByLabelText('Preview onboarding')).toBeNull();
    expect(ui.getByText('Notification test tools')).toBeTruthy();
    await act(async () => ui.unmount());

    mockPreviewAvailable = true;
    ui = await render(<DeveloperToolsScreen />);
    await fireEvent.press(ui.getByLabelText('Preview onboarding'));
    expect(mockEnterReplay).toHaveBeenCalledTimes(1);
    await act(async () => ui.unmount());
  });
});

describe('presentation and touch behavior of the main screen', () => {
  const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

  it('section headings are small, uppercase, secondary and not tappable; row labels are larger, primary and normal case', async () => {
    const ui = await main();
    const heading = ui.getByText('Race history');
    const headingStyle = flat(heading);
    expect(headingStyle.textTransform).toBe('uppercase');
    expect(headingStyle.fontSize as number).toBeGreaterThanOrEqual(12);
    expect(headingStyle.fontSize as number).toBeLessThanOrEqual(13);
    expect(headingStyle.fontWeight).toBe('500');
    expect(heading.props.accessibilityRole).toBe('header');
    expect(ui.queryByLabelText('Race history')).toBeNull(); // not a button
    const labelStyle = flat(ui.getByText('Add a race manually'));
    expect(labelStyle.textTransform).toBeUndefined();
    expect(labelStyle.fontSize as number).toBeGreaterThanOrEqual(16);
    expect(labelStyle.fontSize as number).toBeLessThanOrEqual(17);
    expect(labelStyle.color).not.toBe(headingStyle.color);
    await act(async () => ui.unmount());
  });

  it('every actionable row is at least 56pt tall and spans the whole row', async () => {
    const ui = await main();
    for (const label of ['Add a race manually', 'Find my races', 'Plan, Free', 'Notifications', 'Signal privacy & consent', 'Support', 'Privacy', 'Terms of Use', 'Sign out', 'Delete account']) {
      const row = flat(ui.getByLabelText(label));
      expect(row.minHeight as number).toBeGreaterThanOrEqual(56);
      expect(row.flexDirection).toBe('row');
    }
    await act(async () => ui.unmount());
  });

  it('Sign out is neutral and only Delete account carries the destructive color', async () => {
    const ui = await main();
    const signOut = flat(ui.getByText('Sign out'));
    const deleteAccount = flat(ui.getByText('Delete account'));
    expect(['#A63B2E', '#E1786A']).toContain(deleteAccount.color);
    expect(signOut.color).not.toBe(deleteAccount.color);
    expect(['#A63B2E', '#E1786A']).not.toContain(signOut.color);
    await act(async () => ui.unmount());
  });

  it('Delete account asks for confirmation before anything happens, and Cancel changes nothing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ui = await main();
    await fireEvent.press(ui.getByLabelText('Delete account'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]![0]).toBe('Delete your account?');
    const buttons = alertSpy.mock.calls[0]![2] as { text: string; style?: string }[];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(buttons[0]!.style).toBe('cancel');
    alertSpy.mockRestore();
    await act(async () => ui.unmount());
  });

  it('a second tap on the same row right away does not push a duplicate screen; other rows still respond', async () => {
    const ui = await main();
    await fireEvent.press(ui.getByLabelText('Notifications'));
    await fireEvent.press(ui.getByLabelText('Notifications'));
    expect(mockPush.mock.calls.filter(([path]) => path === '/settings/notifications')).toHaveLength(1);
    await fireEvent.press(ui.getByLabelText('Signal privacy & consent'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings/signal-privacy');
    await act(async () => ui.unmount());
  });

  it('the Developer entry is a clearly separate group, only where a development gate allows it', async () => {
    mockVariant = 'development';
    const ui = await main();
    expect(ui.getByText('Developer')).toBeTruthy();
    expect(ui.getAllByLabelText('Developer tools')).toHaveLength(1);
    await act(async () => ui.unmount());
  });
});
