import { createFakeApi } from './helpers/fakeNotificationsApi';
import { cancelAllOurs, cancelTests, reconcileSchedule } from '@/lib/notifications/reconcile';
import type { PlannedNotification } from '@/lib/notifications/planner';

const note = (identifier: string, body = 'Body'): PlannedNotification => ({
  identifier,
  kind: 'weekly',
  fireAt: { year: 2026, month: 10, day: 11, hour: 16, minute: 0 },
  title: 'Race prep',
  body,
  data: { v: 1, a: 'athlete-1', t: 'prep-list' },
});

describe('reconcileSchedule', () => {
  it('schedules what is missing, keeps what matches, and cancels what is no longer wanted', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    await reconcileSchedule(api, [note('rs:athlete-1:a'), note('rs:athlete-1:b')]);
    expect(state.scheduled.map((s) => s.identifier)).toEqual(['rs:athlete-1:a', 'rs:athlete-1:b']);

    const summary = await reconcileSchedule(api, [note('rs:athlete-1:b'), note('rs:athlete-1:c')]);
    expect(summary).toMatchObject({ scheduled: 1, cancelled: 1, kept: 1 });
    expect([...state.pending.keys()].sort()).toEqual(['rs:athlete-1:b', 'rs:athlete-1:c']);
    // The unchanged reminder was not rescheduled.
    expect(state.scheduled.filter((s) => s.identifier === 'rs:athlete-1:b')).toHaveLength(1);
  });

  it('is idempotent: reconciling the same plan twice changes nothing the second time', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    const plan = [note('rs:athlete-1:a'), note('rs:athlete-1:b')];
    await reconcileSchedule(api, plan);
    const before = state.scheduled.length;
    const summary = await reconcileSchedule(api, plan);
    expect(summary).toMatchObject({ scheduled: 0, cancelled: 0, kept: 2 });
    expect(state.scheduled).toHaveLength(before);
  });

  it('rescheduleAll cancels and re-adds everything (a timezone change)', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    const plan = [note('rs:athlete-1:a')];
    await reconcileSchedule(api, plan);
    await reconcileSchedule(api, plan, { rescheduleAll: true });
    expect(state.cancelled).toEqual(['rs:athlete-1:a']);
    expect(state.scheduled).toHaveLength(2);
  });

  it("removes another account's reminders and leaves the development test notifications alone", async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    await api.schedule({ identifier: 'rs:someone-else:old', title: 't', body: 'b', data: {}, fireAt: note('x').fireAt });
    await api.schedule({ identifier: 'rs-test:athlete-1:weekly:1', title: 't', body: 'b', data: {}, fireAt: note('x').fireAt });
    await api.schedule({ identifier: 'other-feature:1', title: 't', body: 'b', data: {}, fireAt: note('x').fireAt });
    await reconcileSchedule(api, [note('rs:athlete-1:a')]);
    expect([...state.pending.keys()].sort()).toEqual(['other-feature:1', 'rs-test:athlete-1:weekly:1', 'rs:athlete-1:a']);
  });
});

describe('cancelAllOurs / cancelTests', () => {
  it('cancels every reminder of this feature, for any account, and nothing else', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    for (const id of ['rs:a:1', 'rs:b:2', 'rs-test:a:3', 'other:4']) await api.schedule({ identifier: id, title: 't', body: 'b', data: {}, fireAt: note('x').fireAt });
    expect(await cancelAllOurs(api)).toBe(2);
    expect([...state.pending.keys()].sort()).toEqual(['other:4', 'rs-test:a:3']);
    expect(await cancelTests(api)).toBe(1);
    expect([...state.pending.keys()]).toEqual(['other:4']);
  });
});
