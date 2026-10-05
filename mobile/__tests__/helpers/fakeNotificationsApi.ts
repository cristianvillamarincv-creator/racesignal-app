import type { NotificationsApi, PendingNotification, PermissionState, ScheduleRequest } from '@/lib/notifications/api';

/** An in-memory stand-in for the OS notification scheduler, recording every call. */
export function createFakeApi(initial: { permission?: PermissionState } = {}) {
  const state = {
    permission: (initial.permission ?? 'undetermined') as PermissionState,
    /** What the OS will answer when asked for permission. */
    nextPromptAnswer: 'granted' as PermissionState,
    pending: new Map<string, ScheduleRequest>(),
    permissionRequests: 0,
    scheduled: [] as ScheduleRequest[],
    cancelled: [] as string[],
    settingsOpened: 0,
  };
  const api: NotificationsApi = {
    async getPermission() {
      return state.permission;
    },
    async requestPermission() {
      state.permissionRequests += 1;
      if (state.permission === 'undetermined') state.permission = state.nextPromptAnswer;
      return state.permission;
    },
    async listPending(): Promise<PendingNotification[]> {
      return [...state.pending.values()].map((r) => ({
        identifier: r.identifier,
        title: r.title,
        body: r.body,
        data: r.data,
        trigger: { year: r.fireAt.year, month: r.fireAt.month, day: r.fireAt.day, hour: r.fireAt.hour, minute: r.fireAt.minute },
      }));
    },
    async schedule(request) {
      state.scheduled.push(request);
      state.pending.set(request.identifier, request);
    },
    async cancel(identifier) {
      state.cancelled.push(identifier);
      state.pending.delete(identifier);
    },
    async openSystemSettings() {
      state.settingsOpened += 1;
    },
  };
  return { api, state };
}
