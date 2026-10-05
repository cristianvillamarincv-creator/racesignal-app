import type { NotificationsApi, PendingNotification, PermissionDetails, PermissionState, ScheduleRequest } from '@/lib/notifications/api';

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
    /** Failure injection for the diagnostic tests. */
    scheduleError: null as Error | null,
    scheduleHangs: false,
    /** The OS accepts the request but never lists it as pending. */
    dropScheduled: false,
    /** Added to the time the OS "computes" for a trigger (epoch ms offset). */
    nextTriggerSkewMs: 0,
    nextTriggerNull: false,
    nativeUnavailable: null as Error | null,
    /** Authorized, but the visible alert is switched off in iOS Settings. */
    alertsOff: false,
    /** The clock the "OS" uses for interval triggers (defaults to the real one). */
    nowMs: null as number | null,
  };
  const api: NotificationsApi = {
    async getPermission() {
      if (state.nativeUnavailable) throw state.nativeUnavailable;
      return state.permission;
    },
    async getPermissionDetails(): Promise<PermissionDetails> {
      if (state.nativeUnavailable) throw state.nativeUnavailable;
      return { state: state.permission, canAskAgain: state.permission !== 'denied', settings: { authorization: state.permission, alerts: state.alertsOff ? 'off' : 'on', bannerStyle: 'banner' } };
    },
    async nextTriggerTime(request) {
      if (state.nextTriggerNull) return null;
      if (request.intervalSeconds !== undefined) return (state.nowMs ?? Date.now()) + request.intervalSeconds * 1000 + state.nextTriggerSkewMs;
      const f = request.fireAt;
      return new Date(f.year, f.month - 1, f.day, f.hour, f.minute, 0, 0).getTime() + state.nextTriggerSkewMs;
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
        trigger: r.intervalSeconds !== undefined ? null : { year: r.fireAt.year, month: r.fireAt.month, day: r.fireAt.day, hour: r.fireAt.hour, minute: r.fireAt.minute },
      }));
    },
    async schedule(request) {
      if (state.scheduleHangs) return new Promise<void>(() => {});
      if (state.scheduleError) throw state.scheduleError;
      state.scheduled.push(request);
      if (!state.dropScheduled) state.pending.set(request.identifier, request);
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
