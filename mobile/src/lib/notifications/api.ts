import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import type { LocalDateTime } from '@/lib/notifications/localTime';

/**
 * The only module that talks to expo-notifications, so everything else (planner, reconcile, tap routing) is testable with a fake.
 * Local scheduling only: no push token, no remote notification, no background mode.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface PendingNotification {
  identifier: string;
  title: string | null;
  body: string | null;
  data: unknown;
  /** The calendar components the trigger was scheduled with, when the OS reports them (an interval trigger reports none). */
  trigger: { year?: number; month?: number; day?: number; hour?: number; minute?: number } | null;
}

/** What iOS actually says about notification authorization (not just whether we think we have it). */
export interface PermissionDetails {
  state: PermissionState;
  /** False once the athlete has denied: iOS will not show the prompt again, only Settings can change it. */
  canAskAgain: boolean;
  /** iOS's per-setting answers when available, for example { authorization: 'authorized', alerts: 'on', lockScreen: 'on', bannerStyle: 'banner' }. */
  settings: Record<string, string>;
}

export interface ScheduleRequest {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  fireAt: LocalDateTime;
  /** The IANA timezone the calendar components are in (explicit, so the trigger's meaning does not depend on the OS default). */
  timeZone?: string;
  /** Development tools only: deliver this many seconds from now with a time-interval trigger instead of a calendar trigger. */
  intervalSeconds?: number;
}

export interface TapResponse {
  /** Identifies this exact tap, to deduplicate cold-start and warm delivery of the same response. */
  key: string;
  data: unknown;
}

export interface NotificationsApi {
  getPermission(): Promise<PermissionState>;
  getPermissionDetails(): Promise<PermissionDetails>;
  /** When iOS itself says this request will next fire (epoch ms), or null; proves the trigger shape is valid before anything is relied on. */
  nextTriggerTime(request: ScheduleRequest): Promise<number | null>;
  /** Shows the iOS permission prompt (once; afterwards it returns the existing decision). */
  requestPermission(): Promise<PermissionState>;
  listPending(): Promise<PendingNotification[]>;
  schedule(request: ScheduleRequest): Promise<void>;
  cancel(identifier: string): Promise<void>;
  openSystemSettings(): Promise<void>;
}

function toState(status: string | undefined): PermissionState {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

let handlerInstalled = false;

/** Foreground presentation: show the banner and list entry, no sound and no badge. Installed once. */
export function installForegroundHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

function triggerFor(request: ScheduleRequest): Notifications.SchedulableNotificationTriggerInput {
  if (request.intervalSeconds !== undefined) {
    return { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: request.intervalSeconds, repeats: false };
  }
  // Calendar COMPONENTS with an explicit timezone. (expo-notifications 0.32 builds the iOS trigger from a DateComponents whose calendar is
  // ISO8601 and applies the timezone only if one is given, so the meaning is fixed at scheduling time; the schedule is rebuilt when the device
  // timezone changes.) One-shot, so no repeats.
  return {
    type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    year: request.fireAt.year,
    month: request.fireAt.month,
    day: request.fireAt.day,
    hour: request.fireAt.hour,
    minute: request.fireAt.minute,
    second: 0,
    repeats: false,
    ...(request.timeZone ? { timezone: request.timeZone } : {}),
  };
}

export const notificationsApi: NotificationsApi = {
  async getPermission() {
    return toState((await Notifications.getPermissionsAsync()).status);
  },
  async getPermissionDetails() {
    const result = await Notifications.getPermissionsAsync();
    const ios = result.ios;
    const settings: Record<string, string> = {};
    if (ios) {
      const names: Record<number, string> = { 0: 'notDetermined', 1: 'denied', 2: 'authorized', 3: 'provisional', 4: 'ephemeral' };
      settings.authorization = names[ios.status] ?? String(ios.status);
      const flag = (value: boolean | null | undefined) => (value === null || value === undefined ? undefined : value ? 'on' : 'off');
      const entries: [string, string | undefined][] = [
        ['alerts', flag(ios.allowsAlert)],
        ['lockScreen', flag(ios.allowsDisplayOnLockScreen)],
        ['notificationCenter', flag(ios.allowsDisplayInNotificationCenter)],
        ['bannerStyle', ios.alertStyle === 0 ? 'none' : ios.alertStyle === 1 ? 'banner' : ios.alertStyle === 2 ? 'alert' : undefined],
      ];
      for (const [key, value] of entries) if (value) settings[key] = value;
    }
    return { state: toState(result.status), canAskAgain: result.canAskAgain !== false, settings };
  },
  async nextTriggerTime(request) {
    return Notifications.getNextTriggerDateAsync(triggerFor(request));
  },
  async requestPermission() {
    const result = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
    return toState(result.status);
  },
  async listPending() {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    return pending.map((request) => {
      const trigger = request.trigger as { dateComponents?: Record<string, number>; year?: number; month?: number; day?: number; hour?: number; minute?: number } | null;
      const parts = trigger?.dateComponents ?? trigger ?? null;
      return {
        identifier: request.identifier,
        title: request.content.title ?? null,
        body: request.content.body ?? null,
        data: request.content.data,
        trigger: parts ? { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute } : null,
      };
    });
  },
  async schedule(request) {
    await Notifications.scheduleNotificationAsync({
      identifier: request.identifier,
      content: { title: request.title, body: request.body, data: request.data, sound: false },
      trigger: triggerFor(request),
    });
  },
  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },
  async openSystemSettings() {
    await Linking.openSettings();
  },
};

/** The most recent tap (including the one that launched the app), as a stable key plus its data. Used with clearLastResponse(). */
export function toTapResponse(response: Notifications.NotificationResponse | null | undefined): TapResponse | null {
  if (!response) return null;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  return { key: `${response.notification.request.identifier}|${response.notification.date}`, data: response.notification.request.content.data };
}

export function clearLastResponse(): void {
  Notifications.clearLastNotificationResponse();
}

export function useLastTap(): TapResponse | null | undefined {
  const response = Notifications.useLastNotificationResponse();
  // undefined until the OS has answered; null when there is no (default-action) tap.
  if (response === undefined) return undefined;
  return toTapResponse(response);
}
