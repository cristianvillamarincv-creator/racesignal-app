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
  /** The calendar components the trigger was scheduled with, when the OS reports them. */
  trigger: { year?: number; month?: number; day?: number; hour?: number; minute?: number } | null;
}

export interface ScheduleRequest {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  fireAt: LocalDateTime;
}

export interface TapResponse {
  /** Identifies this exact tap, to deduplicate cold-start and warm delivery of the same response. */
  key: string;
  data: unknown;
}

export interface NotificationsApi {
  getPermission(): Promise<PermissionState>;
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

export const notificationsApi: NotificationsApi = {
  async getPermission() {
    return toState((await Notifications.getPermissionsAsync()).status);
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
      // Calendar COMPONENTS with no timezone: iOS evaluates them in the device's current timezone when they fire, so "4 p.m." stays 4 p.m.
      // after a timezone change. This is the intended behavior and still needs device verification (see docs/notifications.md).
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        year: request.fireAt.year,
        month: request.fireAt.month,
        day: request.fireAt.day,
        hour: request.fireAt.hour,
        minute: request.fireAt.minute,
        second: 0,
        repeats: false,
      },
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
