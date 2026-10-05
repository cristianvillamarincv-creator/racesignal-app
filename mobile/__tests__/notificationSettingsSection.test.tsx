import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationSettingsSection } from '@/components/notifications/NotificationSettingsSection';

/** Settings → Notifications: separate switches (both off by default), editable schedule, and clear handling of denied iOS permission. */

jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
const mockEnable = jest.fn();
const mockDisable = jest.fn();
const mockUpdate = jest.fn();
const mockOpenSettings = jest.fn();
let mockPrefs: any;
let mockPermission: string;
let mockStatus: any = null;
jest.mock('@/lib/notifications/NotificationsProvider', () => ({
  useNotifications: () => ({ prefs: mockPrefs, permission: mockPermission, scheduleStatus: mockStatus, enable: mockEnable, disable: mockDisable, updateSchedule: mockUpdate, openSystemSettings: mockOpenSettings }),
}));

const basePrefs = () => ({
  racePrep: { enabled: false, weeklyDay: 0, weeklyHour: 16, weeklyMinute: 0, milestoneHour: 16, milestoneMinute: 0, offer: 'unseen' },
  betweenRace: { enabled: false, day: 0, hour: 16, minute: 0, invite: 'unseen' },
});

beforeEach(() => {
  mockPrefs = basePrefs();
  mockPermission = 'undetermined';
  mockStatus = null;
  mockEnable.mockReset().mockResolvedValue('enabled');
  mockDisable.mockReset().mockResolvedValue(undefined);
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockOpenSettings.mockReset();
});

describe('Notifications settings', () => {
  it('has a separate switch for each type, both off, and explains what each does (including the ask note for prompts)', async () => {
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByLabelText('Race-prep reminders').props.value).toBe(false);
    expect(ui.getByLabelText('Between-race prompts').props.value).toBe(false);
    expect(ui.getByText(/one week and two days before each race/)).toBeTruthy();
    expect(ui.getByText(/Sending it needs an available Signal ask or Premium\./)).toBeTruthy();
    expect(ui.queryByLabelText(/Weekly reminder/)).toBeNull(); // no scheduling form until a type is on
  });

  it('switching a type on asks the provider to enable it (which is when iOS asks); switching off disables only that type', async () => {
    const ui = await render(<NotificationSettingsSection />);
    await act(async () => {
      fireEvent(ui.getByLabelText('Race-prep reminders'), 'valueChange', true);
    });
    expect(mockEnable).toHaveBeenCalledWith('racePrep');
    mockPrefs = { ...basePrefs(), betweenRace: { ...basePrefs().betweenRace, enabled: true } };
    await ui.rerender(<NotificationSettingsSection />);
    await act(async () => {
      fireEvent(ui.getByLabelText('Between-race prompts'), 'valueChange', false);
    });
    expect(mockDisable).toHaveBeenCalledWith('betweenRace');
  });

  it('shows the current schedule and lets the athlete change the weekday', async () => {
    mockPrefs = { ...basePrefs(), racePrep: { ...basePrefs().racePrep, enabled: true } };
    mockPermission = 'granted';
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText('Sunday, 4:00 PM')).toBeTruthy();
    expect(ui.getByText('4:00 PM')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Weekly reminder, Sunday, 4:00 PM'));
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Wednesday'));
    });
    expect(mockUpdate).toHaveBeenCalledWith({ racePrep: { weeklyDay: 3 } });
  });

  it('the between-race prompt has its own editable weekly slot', async () => {
    mockPrefs = { ...basePrefs(), betweenRace: { ...basePrefs().betweenRace, enabled: true, day: 6, hour: 9, minute: 30 } };
    mockPermission = 'granted';
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText('Saturday, 9:30 AM')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Weekly prompt, Saturday, 9:30 AM'));
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Monday'));
    });
    expect(mockUpdate).toHaveBeenCalledWith({ betweenRace: { day: 1 } });
  });

  it('explains clearly, with an Open iOS Settings shortcut, when iOS permission is off while a type is on', async () => {
    mockPrefs = { ...basePrefs(), racePrep: { ...basePrefs().racePrep, enabled: true } };
    mockPermission = 'denied';
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText(/turned off for RaceSignal in iOS Settings/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Open iOS Settings'));
    });
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  it('shows no warning when both types are off, even if iOS permission is denied', async () => {
    mockPermission = 'denied';
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.queryByLabelText('Open iOS Settings')).toBeNull();
  });

  it('after a refused iOS prompt, says so and how to fix it', async () => {
    mockEnable.mockResolvedValue('denied');
    const ui = await render(<NotificationSettingsSection />);
    await act(async () => {
      fireEvent(ui.getByLabelText('Race-prep reminders'), 'valueChange', true);
    });
    expect(ui.getByText(/Turn them on in iOS Settings, then switch this back on here\./)).toBeTruthy();
  });
});

describe('what is actually scheduled', () => {
  it('confirms enabled reminders with the count and the next one, read back from iOS (no separate scheduling step)', async () => {
    mockPrefs = { ...basePrefs(), racePrep: { ...basePrefs().racePrep, enabled: true } };
    mockPermission = 'granted';
    mockStatus = { racePrep: { scheduled: 9, next: { year: 2026, month: 10, day: 11, hour: 16, minute: 0 }, note: null }, betweenRace: null, error: null };
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText('9 reminders scheduled. Next: Sun, Oct 11, 4:00 PM.')).toBeTruthy();
  });

  it('says why nothing is scheduled instead of leaving the switch unexplained', async () => {
    mockPrefs = { ...basePrefs(), racePrep: { ...basePrefs().racePrep, enabled: true }, betweenRace: { ...basePrefs().betweenRace, enabled: true } };
    mockPermission = 'granted';
    mockStatus = {
      racePrep: { scheduled: 0, next: null, note: 'Nothing to schedule yet. Save an upcoming race and reminders start automatically.' },
      betweenRace: { scheduled: 8, next: { year: 2026, month: 10, day: 11, hour: 16, minute: 0 }, note: null },
      error: null,
    };
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText('Nothing to schedule yet. Save an upcoming race and reminders start automatically.')).toBeTruthy();
    expect(ui.getByText('8 reminders scheduled. Next: Sun, Oct 11, 4:00 PM.')).toBeTruthy();
  });

  it('shows a scheduling problem as an alert', async () => {
    mockPrefs = { ...basePrefs(), racePrep: { ...basePrefs().racePrep, enabled: true } };
    mockPermission = 'granted';
    mockStatus = { racePrep: null, betweenRace: null, error: 'Could not schedule reminders: boom' };
    const ui = await render(<NotificationSettingsSection />);
    expect(ui.getByText('Could not schedule reminders: boom')).toBeTruthy();
  });
});
