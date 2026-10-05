import type { Race } from '@/fixtures/races';
import type { NotificationsApi, PendingNotification, PermissionDetails, ScheduleRequest } from '@/lib/notifications/api';
import { calendarDaysBetween, fromDate, parseRaceDate, startOfLocalDay } from '@/lib/notifications/localTime';
import { PAYLOAD_VERSION, type TapPayload } from '@/lib/notifications/payload';
import { buildMilestoneContent, buildWeeklyContent, eligibleUpcomingRaces, IDENTIFIER_PREFIX, TEST_IDENTIFIER_PREFIX } from '@/lib/notifications/planner';
import { BETWEEN_RACE_PROMPTS } from '@/lib/notifications/prompts';

/**
 * The development-only delivery tests, as plain functions over the notifications API so they can be unit-tested. Each test: checks the real iOS
 * authorization, explains any missing prerequisite instead of doing nothing, asks iOS when it will fire, schedules (bounded, never hangs), READS
 * THE PENDING LIST BACK to confirm the identifier exists, and reports either an actionable error or the identifier and expected delivery time.
 */

export type TestKind = 'basic' | 'calendar' | 'weekly' | 'seven' | 'two' | 'between';

export const TEST_LABELS: Record<TestKind, string> = {
  basic: 'Test notification in 60 seconds',
  calendar: 'Calendar-trigger test (same trigger as real reminders)',
  weekly: 'Race-prep weekly in ~1 min',
  seven: 'Seven-day milestone in ~1 min',
  two: 'Two-day milestone in ~1 min',
  between: 'Between-race prompt in ~1 min (Signal)',
};

export interface TestContext {
  api: NotificationsApi;
  athleteId: string | null;
  /** The races the app has loaded for this account (removed races are not among them). */
  races: Race[];
  now: Date;
  timeZone: string | null;
  /** Per-step limit; defaults to 10 seconds. */
  timeoutMs?: number;
}

export interface TestOutcome {
  ok: boolean;
  message: string;
  identifier?: string;
  /** When iOS says it will fire (or, if it could not say, when we asked for it). */
  deliversAt?: Date;
  /** The identifier was found in iOS's pending list after scheduling. */
  verified?: boolean;
  /** The fix is in iOS Settings: the screen offers a shortcut. */
  needsSettings?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${Math.round(ms / 1000)} seconds`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A readable reason for an error, with a hint when the native module itself is the problem. */
export function describeError(error: unknown): string {
  const err = error as { message?: string; code?: string; name?: string };
  const text = err?.message ?? String(error);
  const code = err?.code ? ` [${err.code}]` : '';
  if (/native module|UnavailabilityError|ExpoNotification|is not available/i.test(`${err?.name ?? ''} ${text}`)) {
    return `${text}${code}. The notifications native module is not available in this build; it would need a development build that includes expo-notifications.`;
  }
  return `${text}${code}`;
}

const time = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function summarizeRaces(races: Race[], now: Date) {
  const completed = races.filter((race) => race.status === 'completed').length;
  const notCompleted = races.length - completed;
  const eligible = eligibleUpcomingRaces(races, now).length;
  return { total: races.length, completed, notCompleted, eligible };
}

export interface Diagnostics {
  lines: string[];
  permission: PermissionDetails | null;
  error?: string;
}

export async function diagnose(ctx: Pick<TestContext, 'api' | 'races' | 'now' | 'timeZone' | 'timeoutMs'>): Promise<Diagnostics> {
  const timeout = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lines: string[] = [];
  let permission: PermissionDetails | null = null;
  let error: string | undefined;
  try {
    permission = await withTimeout(ctx.api.getPermissionDetails(), timeout, 'Reading the iOS permission');
    const details = Object.entries(permission.settings).map(([key, value]) => `${key}: ${value}`).join(', ');
    lines.push(`iOS notification permission: ${permission.state}${permission.canAskAgain ? '' : ' (iOS will not ask again; change it in iOS Settings)'}${details ? ` (${details})` : ''}`);
  } catch (err) {
    error = describeError(err);
    lines.push(`iOS notification permission: could not be read. ${error}`);
  }
  try {
    const pending = await withTimeout(ctx.api.listPending(), timeout, 'Reading pending notifications');
    const ours = pending.filter((p) => p.identifier.startsWith(IDENTIFIER_PREFIX)).length;
    const tests = pending.filter((p) => p.identifier.startsWith(TEST_IDENTIFIER_PREFIX)).length;
    lines.push(`Pending with iOS: ${pending.length} (${ours} reminders, ${tests} tests, ${pending.length - ours - tests} other)`);
  } catch (err) {
    lines.push(`Pending with iOS: could not be read. ${describeError(err)}`);
  }
  const r = summarizeRaces(ctx.races, ctx.now);
  lines.push(`Races loaded for this account: ${r.total} (${r.completed} completed, ${r.eligible} upcoming dated today or later). Removed races are not loaded.`);
  lines.push(`Device clock: ${ctx.now.toString()}${ctx.timeZone ? ` (${ctx.timeZone})` : ''}`);
  return { lines, permission, error };
}

function ceilToMinute(date: Date): Date {
  const d = new Date(date);
  if (d.getSeconds() > 0 || d.getMilliseconds() > 0) d.setMinutes(d.getMinutes() + 1);
  d.setSeconds(0, 0);
  return d;
}

function buildRequest(kind: TestKind, ctx: TestContext): { request: ScheduleRequest; note?: string } | { fail: TestOutcome } {
  const athleteId = ctx.athleteId!;
  const stamp = ctx.now.getTime();
  const id = `${TEST_IDENTIFIER_PREFIX}${athleteId}:${kind}:${stamp}`;
  const base = { identifier: id, ...(ctx.timeZone ? { timeZone: ctx.timeZone } : {}) };
  const minuteAhead = ceilToMinute(new Date(stamp + 60_000));

  if (kind === 'basic') {
    const data: TapPayload = { v: PAYLOAD_VERSION, a: athleteId, t: 'test' };
    return {
      request: {
        ...base,
        title: 'RaceSignal test',
        body: 'If you can read this, local notifications are being delivered. Tap it to check tap handling.',
        data: data as unknown as Record<string, unknown>,
        fireAt: fromDate(new Date(stamp + 60_000)),
        intervalSeconds: 60,
      },
    };
  }
  if (kind === 'calendar') {
    const data: TapPayload = { v: PAYLOAD_VERSION, a: athleteId, t: 'test' };
    return {
      request: { ...base, title: 'RaceSignal calendar test', body: 'Scheduled with the same calendar trigger real reminders use. Tap it to check tap handling.', data: data as unknown as Record<string, unknown>, fireAt: fromDate(minuteAhead) },
    };
  }
  if (kind === 'between') {
    const prompt = BETWEEN_RACE_PROMPTS[Math.floor(Math.random() * BETWEEN_RACE_PROMPTS.length)]!;
    const data: TapPayload = { v: PAYLOAD_VERSION, a: athleteId, t: 'between', p: prompt.id };
    return { request: { ...base, title: 'Think about what comes next', body: prompt.question, data: data as unknown as Record<string, unknown>, fireAt: fromDate(minuteAhead) } };
  }
  // Race tests need a real upcoming race.
  const r = summarizeRaces(ctx.races, ctx.now);
  const race = eligibleUpcomingRaces(ctx.races, ctx.now)[0]?.race;
  if (!race) {
    return {
      fail: {
        ok: false,
        message: `Nothing was scheduled: race-prep tests need an upcoming race dated today or later, and none is loaded for this account. It has ${r.total} race${r.total === 1 ? '' : 's'} loaded (${r.completed} completed, ${r.notCompleted} not completed, ${r.eligible} upcoming dated today or later). A race you removed is not loaded. Save an upcoming race, or use the standalone "${TEST_LABELS.basic}".`,
      },
    };
  }
  const raceDate = parseRaceDate(race.eventDate)!;
  let content: { body: string; itemId?: string };
  let note: string | undefined;
  if (kind === 'weekly') {
    // The countdown is for the day this notification will be DELIVERED, exactly as a real weekly reminder computes it for its own slot.
    const days = calendarDaysBetween(startOfLocalDay(minuteAhead), raceDate);
    if (days < 1) {
      return { fail: { ok: false, message: `Nothing was scheduled: ${race.name} is ${days === 0 ? 'today' : 'in the past'} on the day this test would be delivered, and real weekly reminders are never sent on or after race day.` } };
    }
    content = buildWeeklyContent(race, days);
    note = `The countdown is ${days} day${days === 1 ? '' : 's'}: the days from this notification's delivery date to ${race.name}.`;
  } else {
    const which = kind === 'seven' ? 7 : 2;
    content = buildMilestoneContent(race, which);
    const firesOn = fromDate(new Date(raceDate.getFullYear(), raceDate.getMonth(), raceDate.getDate() - which, 12));
    const daysAway = calendarDaysBetween(startOfLocalDay(ctx.now), raceDate);
    note = `This previews the wording of the real ${which === 7 ? 'seven-day' : 'two-day'} reminder, which is delivered ${which} days before the race (${firesOn.month}/${firesOn.day}/${firesOn.year}); ${race.name} is ${daysAway} day${daysAway === 1 ? '' : 's'} away today.`;
  }
  const data: TapPayload = { v: PAYLOAD_VERSION, a: athleteId, t: 'prep', r: race.id, ...(content.itemId ? { i: content.itemId } : {}) };
  return { request: { ...base, title: 'Race prep', body: content.body, data: data as unknown as Record<string, unknown>, fireAt: fromDate(minuteAhead) }, note };
}

function findPending(pending: PendingNotification[], identifier: string) {
  return pending.find((entry) => entry.identifier === identifier);
}

export async function runDeliveryTest(kind: TestKind, ctx: TestContext): Promise<TestOutcome> {
  const timeout = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!ctx.athleteId) return { ok: false, message: 'Nothing was scheduled: you are not signed in.' };

  // 1. Real iOS authorization.
  let details: PermissionDetails;
  try {
    details = await withTimeout(ctx.api.getPermissionDetails(), timeout, 'Reading the iOS permission');
    if (details.state === 'undetermined') {
      const answer = await withTimeout(ctx.api.requestPermission(), 60_000, 'The iOS permission prompt');
      details = { ...details, state: answer, canAskAgain: answer !== 'denied' };
    }
  } catch (err) {
    return { ok: false, message: `Nothing was scheduled: could not check iOS notification permission. ${describeError(err)}` };
  }
  if (details.state !== 'granted') {
    return {
      ok: false,
      needsSettings: true,
      message: `Nothing was scheduled: iOS notifications are ${details.state === 'denied' ? 'turned off' : 'not allowed'} for RaceSignal (status: ${details.state}). Open iOS Settings, then RaceSignal (or RaceSignal Dev), then Notifications, and turn on Allow Notifications.`,
    };
  }

  // Authorized overall, but alerts (the visible banner) switched off: nothing would be shown.
  if (details.settings.alerts === 'off' || details.settings.bannerStyle === 'none') {
    return {
      ok: false,
      needsSettings: true,
      message: `Nothing was scheduled: notifications are allowed but visible alerts are switched off for RaceSignal (alerts: ${details.settings.alerts ?? 'unknown'}, banner style: ${details.settings.bannerStyle ?? 'unknown'}). Open iOS Settings, then RaceSignal, then Notifications, and turn on Banners or Alerts.`,
    };
  }

  // 2. Prerequisites and the request itself.
  const built = buildRequest(kind, ctx);
  if ('fail' in built) return built.fail;
  const { request, note } = built;

  // 3. Ask iOS when it will fire: this also proves the trigger shape is valid before relying on it.
  let nextFire: number | null;
  try {
    nextFire = await withTimeout(ctx.api.nextTriggerTime(request), timeout, 'Asking iOS for the trigger time');
  } catch (err) {
    return { ok: false, message: `Nothing was scheduled: iOS rejected the trigger. ${describeError(err)}` };
  }
  if (nextFire === null) {
    return { ok: false, message: 'Nothing was scheduled: iOS reports no future fire time for this trigger (it is in the past or malformed).' };
  }

  // 4. Schedule, bounded.
  try {
    await withTimeout(ctx.api.schedule(request), timeout, 'Scheduling');
  } catch (err) {
    return { ok: false, identifier: request.identifier, message: `iOS did not accept the notification. ${describeError(err)}` };
  }

  // 5. Read it back.
  let pending: PendingNotification[];
  try {
    pending = await withTimeout(ctx.api.listPending(), timeout, 'Reading pending notifications');
  } catch (err) {
    return { ok: false, identifier: request.identifier, message: `Scheduled ${request.identifier}, but could not read iOS's pending list to confirm it. ${describeError(err)}` };
  }
  const deliversAt = new Date(nextFire);
  if (!findPending(pending, request.identifier)) {
    return {
      ok: false,
      identifier: request.identifier,
      deliversAt,
      verified: false,
      message: `iOS accepted ${request.identifier} but it is NOT in the pending list afterwards (${pending.length} pending), so it will not be delivered. Something removed it or iOS dropped it.`,
    };
  }
  const seconds = Math.max(0, Math.round((deliversAt.getTime() - ctx.now.getTime()) / 1000));
  return {
    ok: true,
    identifier: request.identifier,
    deliversAt,
    verified: true,
    message: `Scheduled ${request.identifier}. iOS will deliver it at ${time(deliversAt)} (in about ${seconds} seconds) and lists it as pending. Lock the phone or leave the app and wait.${note ? ` ${note}` : ''}`,
  };
}

