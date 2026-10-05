import { toDate } from '@/lib/notifications/localTime';
import type { NotificationsApi, PendingNotification } from '@/lib/notifications/api';
import { IDENTIFIER_PREFIX, TEST_IDENTIFIER_PREFIX, type PlannedNotification } from '@/lib/notifications/planner';

/**
 * Makes the OS's pending notifications match the plan: cancel ours that are no longer wanted (a different identifier means different
 * content or time), schedule the missing ones. Identifiers starting with "rs:" are this feature's; "rs-test:" ones (the development
 * test tools) are never touched here.
 */

const isOurs = (identifier: string) => identifier.startsWith(IDENTIFIER_PREFIX);

export interface ReconcileSummary {
  scheduled: number;
  cancelled: number;
  kept: number;
  failed: number;
}

export async function reconcileSchedule(api: NotificationsApi, desired: PlannedNotification[], options: { rescheduleAll?: boolean } = {}): Promise<ReconcileSummary> {
  const pending = await api.listPending();
  const ours = pending.filter((p) => isOurs(p.identifier));
  const wanted = new Set(options.rescheduleAll ? [] : desired.map((n) => n.identifier));
  const summary: ReconcileSummary = { scheduled: 0, cancelled: 0, kept: 0, failed: 0 };

  for (const entry of ours) {
    if (wanted.has(entry.identifier)) continue;
    try {
      await api.cancel(entry.identifier);
      summary.cancelled += 1;
    } catch {
      summary.failed += 1;
    }
  }
  const stillPending = new Set(ours.filter((p) => wanted.has(p.identifier)).map((p) => p.identifier));
  summary.kept = stillPending.size;

  for (const notification of desired) {
    if (stillPending.has(notification.identifier)) continue;
    try {
      await api.schedule({ identifier: notification.identifier, title: notification.title, body: notification.body, data: notification.data as unknown as Record<string, unknown>, fireAt: notification.fireAt });
      summary.scheduled += 1;
    } catch (err) {
      summary.failed += 1;
      console.warn('[notifications] failed to schedule a reminder:', err);
    }
  }
  return summary;
}

/** Cancels every pending notification this feature scheduled (for any account), leaving the development test notifications alone. */
export async function cancelAllOurs(api: NotificationsApi): Promise<number> {
  const pending = await api.listPending();
  let cancelled = 0;
  for (const entry of pending) {
    if (!isOurs(entry.identifier)) continue;
    try {
      await api.cancel(entry.identifier);
      cancelled += 1;
    } catch (err) {
      console.warn('[notifications] failed to cancel a reminder:', err);
    }
  }
  return cancelled;
}

/** Cancels the development test notifications. */
export async function cancelTests(api: NotificationsApi): Promise<number> {
  const pending = await api.listPending();
  let cancelled = 0;
  for (const entry of pending) {
    if (!entry.identifier.startsWith(TEST_IDENTIFIER_PREFIX)) continue;
    await api.cancel(entry.identifier).catch(() => {});
    cancelled += 1;
  }
  return cancelled;
}

/** For the development tools and tests: a readable one-line description of each pending notification. */
export function describePending(pending: PendingNotification[]): string[] {
  return pending
    .map((p) => ({ p, at: p.trigger?.year ? toDate({ year: p.trigger.year!, month: p.trigger.month!, day: p.trigger.day!, hour: p.trigger.hour ?? 0, minute: p.trigger.minute ?? 0 }).getTime() : 0 }))
    .sort((a, b) => a.at - b.at)
    .map(({ p }) => {
      const t = p.trigger;
      const when = t?.year ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${String(t.hour ?? 0).padStart(2, '0')}:${String(t.minute ?? 0).padStart(2, '0')}` : 'unknown time';
      return `${when}  ${p.title ?? ''}: ${p.body ?? ''}`;
    });
}
