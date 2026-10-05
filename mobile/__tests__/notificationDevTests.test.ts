import type { Race } from '@/fixtures/races';
import { describeError, diagnose, runDeliveryTest, withTimeout, type TestKind } from '@/lib/notifications/devTests';
import { createFakeApi } from './helpers/fakeNotificationsApi';

/** The development delivery tests: real authorization, explained prerequisites, bounded steps, and a read-back of iOS's pending list. */

const NOW = new Date(2026, 9, 7, 10, 0, 20); // Wed Oct 7 2026, 10:00:20
const race = (overrides: Partial<Race> = {}): Race =>
  ({ id: 'r1', name: 'Ironman Test', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2026-12-20', location: '', status: 'registered', isManual: true, ...overrides }) as Race;
const completed = (): Race => race({ id: 'c1', status: 'completed', eventDate: '2025-10-05' });
const ctx = (api: ReturnType<typeof createFakeApi>['api'], races: Race[] = [], extra: Record<string, unknown> = {}) => ({ api, athleteId: 'athlete-1', races, now: NOW, timeZone: 'America/Toronto', timeoutMs: 200, ...extra });

describe('the standalone test needs nothing but permission', () => {
  it('schedules a 60-second interval notification with no race, entitlement or model call, verifies it with iOS, and reports id and time', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.nowMs = NOW.getTime();
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(outcome.identifier).toMatch(/^rs-test:athlete-1:basic:\d+$/);
    expect(outcome.message).toContain(outcome.identifier!);
    expect(outcome.message).toMatch(/will deliver it at .*in about 60 seconds.*lists it as pending/);
    const scheduled = state.scheduled[0]!;
    expect(scheduled.intervalSeconds).toBe(60);
    expect(scheduled.data).toEqual({ v: 1, a: 'athlete-1', t: 'test' });
    expect(state.pending.has(outcome.identifier!)).toBe(true);
  });

  it('the calendar-trigger test uses the real trigger shape (explicit local timezone, next minute at least a minute ahead)', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    const outcome = await runDeliveryTest('calendar', ctx(api));
    expect(outcome.ok).toBe(true);
    const scheduled = state.scheduled[0]!;
    expect(scheduled.intervalSeconds).toBeUndefined();
    expect(scheduled.timeZone).toBe('America/Toronto');
    expect(scheduled.fireAt).toEqual({ year: 2026, month: 10, day: 7, hour: 10, minute: 2 }); // 10:00:20 + 60s -> next whole minute
  });
});

describe('permission', () => {
  it('reports a denied iOS permission as the blocker, with the fix, and schedules nothing', async () => {
    const { api, state } = createFakeApi({ permission: 'denied' });
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.needsSettings).toBe(true);
    expect(outcome.message).toMatch(/turned off for RaceSignal \(status: denied\).*Notifications/);
    expect(state.scheduled).toEqual([]);
  });

  it('asks iOS when permission is undetermined, and schedules once it is granted', async () => {
    const { api, state } = createFakeApi({ permission: 'undetermined' });
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(state.permissionRequests).toBe(1);
    expect(outcome.ok).toBe(true);
  });

  it('a refused prompt is reported, not ignored', async () => {
    const { api, state } = createFakeApi({ permission: 'undetermined' });
    state.nextPromptAnswer = 'denied';
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.needsSettings).toBe(true);
  });

  it('reports alerts switched off in iOS Settings (allowed overall, but nothing would be shown)', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.alertsOff = true;
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.needsSettings).toBe(true);
    expect(outcome.message).toMatch(/visible alerts are switched off/);
    expect(state.scheduled).toEqual([]);
  });

  it('says so when the notifications native module is unavailable (a rebuild would be needed)', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.nativeUnavailable = Object.assign(new Error("Cannot find native module 'ExpoNotificationScheduler'"), { code: 'ERR_UNAVAILABLE' });
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/native module is not available in this build/);
  });
});

describe('prerequisites are explained, not silent', () => {
  const raceKinds: TestKind[] = ['weekly', 'seven', 'two'];
  it.each(raceKinds)('the %s test explains exactly why no race is available, with this account’s counts', async (kind) => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    const outcome = await runDeliveryTest(kind, ctx(api, [completed(), completed()]));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Nothing was scheduled: race-prep tests need an upcoming race dated today or later/);
    expect(outcome.message).toContain('2 races loaded (2 completed, 0 not completed, 0 upcoming dated today or later)');
    expect(outcome.message).toContain('A race you removed is not loaded');
    expect(outcome.message).toContain('Test notification in 60 seconds');
    expect(state.scheduled).toEqual([]);
  });

  it('a race dated in the past does not count as upcoming', async () => {
    const { api } = createFakeApi({ permission: 'granted' });
    const outcome = await runDeliveryTest('weekly', ctx(api, [race({ eventDate: '2026-10-01' })]));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('1 race loaded (0 completed, 1 not completed, 0 upcoming dated today or later)');
  });

  it('with an upcoming race the race tests schedule real content and the real tap payload', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    for (const kind of ['weekly', 'seven', 'two'] as TestKind[]) expect((await runDeliveryTest(kind, ctx(api, [race()]))).ok).toBe(true);
    expect(state.scheduled).toHaveLength(3);
    for (const request of state.scheduled) {
      expect(request.title).toBe('Race prep');
      expect(request.data).toMatchObject({ v: 1, a: 'athlete-1', t: 'prep', r: 'r1' });
      expect(request.identifier.startsWith('rs-test:athlete-1:')).toBe(true);
    }
    expect(state.scheduled[0]!.body).toMatch(/^21 days until Ironman Test\./);
    expect(state.scheduled[1]!.body).toMatch(/^One week until Ironman Test\./);
    expect(state.scheduled[2]!.body).toMatch(/^Two days until Ironman Test\./);
  });

  it('the Signal (between-race) test needs no race and carries a prompt payload', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    const outcome = await runDeliveryTest('between', ctx(api));
    expect(outcome.ok).toBe(true);
    expect(state.scheduled[0]!.data).toMatchObject({ v: 1, a: 'athlete-1', t: 'between' });
    expect(state.scheduled[0]!.title).toBe('Think about what comes next');
  });

  it('requires a signed-in athlete', async () => {
    const { api } = createFakeApi({ permission: 'granted' });
    expect((await runDeliveryTest('basic', { ...ctx(api), athleteId: null })).message).toMatch(/not signed in/);
  });
});

describe('errors are actionable and bounded', () => {
  it('reports a scheduling failure with the reason and the identifier', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.scheduleError = Object.assign(new Error('Failed to build notification request'), { code: 'ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE' });
    const outcome = await runDeliveryTest('calendar', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('iOS did not accept the notification. Failed to build notification request [ERR_NOTIFICATIONS_FAILED_TO_SCHEDULE]');
    expect(outcome.identifier).toBeDefined();
  });

  it('never hangs: a stuck scheduler times out with a clear message', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.scheduleHangs = true;
    const outcome = await runDeliveryTest('calendar', ctx(api, [], { timeoutMs: 30 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Scheduling did not finish within/);
  });

  it('fails when iOS accepts the notification but does not list it as pending afterwards', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.dropScheduled = true;
    const outcome = await runDeliveryTest('basic', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.verified).toBe(false);
    expect(outcome.message).toMatch(/NOT in the pending list afterwards/);
  });

  it('fails when iOS reports no future fire time for the trigger', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.nextTriggerNull = true;
    const outcome = await runDeliveryTest('calendar', ctx(api));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/no future fire time/);
    expect(state.scheduled).toEqual([]);
  });

  it('uses the time iOS reports, not just the time it asked for', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    state.nextTriggerSkewMs = 3 * 60_000;
    const outcome = await runDeliveryTest('calendar', ctx(api));
    expect(outcome.deliversAt!.getTime()).toBe(new Date(2026, 9, 7, 10, 2).getTime() + 3 * 60_000);
  });

  it('withTimeout and describeError behave', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'Thing')).rejects.toThrow('Thing did not finish within');
    await expect(withTimeout(Promise.resolve(5), 20, 'Thing')).resolves.toBe(5);
    expect(describeError(Object.assign(new Error('boom'), { code: 'E_X' }))).toBe('boom [E_X]');
  });
});

describe('diagnostics', () => {
  it('reports the real permission state, pending counts, the races loaded, and the clock', async () => {
    const { api } = createFakeApi({ permission: 'granted' });
    await api.schedule({ identifier: 'rs:athlete-1:weekly:a', title: 't', body: 'b', data: {}, fireAt: { year: 2026, month: 12, day: 1, hour: 16, minute: 0 } });
    await api.schedule({ identifier: 'rs-test:athlete-1:basic:1', title: 't', body: 'b', data: {}, fireAt: { year: 2026, month: 12, day: 1, hour: 16, minute: 0 } });
    const result = await diagnose({ api, races: [completed(), race()], now: NOW, timeZone: 'America/Toronto' });
    const text = result.lines.join('\n');
    expect(text).toContain('iOS notification permission: granted');
    expect(text).toContain('Pending with iOS: 2 (1 reminders, 1 tests, 0 other)');
    expect(text).toContain('Races loaded for this account: 2 (1 completed, 1 upcoming dated today or later). Removed races are not loaded.');
    expect(text).toContain('America/Toronto');
  });

  it('says plainly when the permission cannot be read, and when iOS will not ask again', async () => {
    const { api, state } = createFakeApi({ permission: 'denied' });
    expect((await diagnose({ api, races: [], now: NOW, timeZone: null })).lines.join('\n')).toMatch(/iOS will not ask again; change it in iOS Settings/);
    state.nativeUnavailable = new Error('Cannot find native module');
    const broken = await diagnose({ api, races: [], now: NOW, timeZone: null });
    expect(broken.error).toMatch(/native module/);
  });
});
