import type { Race } from '@/fixtures/races';
import { CHECKLIST_TEMPLATE } from '@/lib/checklistTemplate';
import { toDate } from '@/lib/notifications/localTime';
import { DEFAULT_PREFS, type NotificationPrefs } from '@/lib/notifications/prefs';
import { MAX_PENDING, planNotifications, type PlannedNotification } from '@/lib/notifications/planner';
import { EMPTY_ROTATION } from '@/lib/notifications/rotation';

/**
 * The planner decides what should be scheduled. All dates are local wall-clock; 2026-10-04 is a Sunday.
 */

const ATHLETE = 'athlete-1';
const NOW = new Date(2026, 9, 7, 10, 0); // Wed Oct 7 2026, 10:00 local

const prefsWith = (overrides: { racePrep?: Partial<NotificationPrefs['racePrep']>; betweenRace?: Partial<NotificationPrefs['betweenRace']> } = {}): NotificationPrefs => ({
  ...DEFAULT_PREFS,
  racePrep: { ...DEFAULT_PREFS.racePrep, enabled: true, ...overrides.racePrep },
  betweenRace: { ...DEFAULT_PREFS.betweenRace, ...overrides.betweenRace },
});

let counter = 0;
function race(overrides: Partial<Race> & { eventDate: string }): Race {
  counter += 1;
  return { id: `race-${counter}`, name: `Test Race ${counter}`, sport: 'triathlon', distanceLabel: '70.3', location: 'Somewhere', status: 'registered', isManual: true, ...overrides } as Race;
}
const ALL_ITEMS = CHECKLIST_TEMPLATE.map((item) => item.id);
const completed = (eventDate: string): Race => race({ eventDate, status: 'completed', result: { finishSeconds: 100, splits: [], sourceStatus: 'imported_confirmed' } });

const plan = (races: Race[], prefs = prefsWith(), now = NOW, rotation = EMPTY_ROTATION) =>
  planNotifications({ now, athleteId: ATHLETE, prefs, races, rotation, rng: () => 0.3 });
const at = (n: PlannedNotification) => toDate(n.fireAt);
const stamp = (n: PlannedNotification) => `${n.fireAt.year}-${String(n.fireAt.month).padStart(2, '0')}-${String(n.fireAt.day).padStart(2, '0')} ${String(n.fireAt.hour).padStart(2, '0')}:${String(n.fireAt.minute).padStart(2, '0')}`;
const ofKind = (result: ReturnType<typeof plan>, kind: PlannedNotification['kind']) => result.notifications.filter((n) => n.kind === kind);

beforeEach(() => {
  counter = 0;
});

describe('race prep: schedule and defaults', () => {
  it('is off by default: nothing is planned until the type is enabled', () => {
    const result = plan([race({ eventDate: '2026-12-12' })], { ...DEFAULT_PREFS });
    expect(result.notifications).toEqual([]);
  });

  it('plans Sunday 4 p.m. weekly reminders and 4 p.m. seven-day and two-day milestones, within 12 weeks', () => {
    const r = race({ eventDate: '2026-12-12' }); // Saturday
    const result = plan([r]);
    const weekly = ofKind(result, 'weekly');
    expect(weekly.length).toBeGreaterThan(0);
    for (const n of weekly) {
      expect(at(n).getDay()).toBe(0);
      expect([n.fireAt.hour, n.fireAt.minute]).toEqual([16, 0]);
    }
    const milestones = ofKind(result, 'milestone').map(stamp);
    expect(milestones).toEqual(['2026-12-05 16:00', '2026-12-10 16:00']);
    expect(Math.max(...result.notifications.map((n) => at(n).getTime()))).toBeLessThanOrEqual(NOW.getTime() + 84 * 86_400_000 + 3_600_000);
  });

  it('uses custom days and times from the preferences', () => {
    const result = plan([race({ eventDate: '2026-12-12' })], prefsWith({ racePrep: { weeklyDay: 3, weeklyHour: 18, weeklyMinute: 30, milestoneHour: 9, milestoneMinute: 15 } }));
    for (const n of ofKind(result, 'weekly')) expect([at(n).getDay(), n.fireAt.hour, n.fireAt.minute]).toEqual([3, 18, 30]);
    for (const n of ofKind(result, 'milestone')) expect([n.fireAt.hour, n.fireAt.minute]).toEqual([9, 15]);
  });
});

describe('race prep: milestones and weekly suppression', () => {
  it('suppresses a weekly reminder within 48 hours of a milestone, and keeps both milestones', () => {
    const result = plan([race({ eventDate: '2026-12-12' })]); // M7 Sat Dec 5, M2 Thu Dec 10
    const weeklyStamps = ofKind(result, 'weekly').map(stamp);
    expect(weeklyStamps).not.toContain('2026-12-06 16:00'); // Sunday, 24h after the seven-day milestone
    expect(weeklyStamps).toContain('2026-11-29 16:00');
    expect(ofKind(result, 'milestone')).toHaveLength(2);
  });

  it('replaces a weekly reminder that falls in the same slot as a milestone (race on a Sunday)', () => {
    const result = plan([race({ eventDate: '2026-12-13' })]); // M7 = Sun Dec 6 16:00
    expect(ofKind(result, 'weekly').map(stamp)).not.toContain('2026-12-06 16:00');
    expect(ofKind(result, 'milestone').map(stamp)).toContain('2026-12-06 16:00');
  });

  it('keeps a weekly reminder that is more than 48 hours from every milestone', () => {
    const result = plan([race({ eventDate: '2026-12-16' })]); // M7 Wed Dec 9, M2 Mon Dec 14; Sun Dec 6 is 72h before M7
    expect(ofKind(result, 'weekly').map(stamp)).toContain('2026-12-06 16:00');
    expect(ofKind(result, 'weekly').map(stamp)).not.toContain('2026-12-13 16:00'); // 24h before M2
  });

  it('never sends a weekly reminder on or after race day', () => {
    const result = plan([race({ eventDate: '2026-10-25' })]); // Sunday race day
    for (const n of ofKind(result, 'weekly')) expect(at(n).getTime()).toBeLessThan(new Date(2026, 9, 25).getTime());
  });

  it('skips milestones that are already past', () => {
    const result = plan([race({ eventDate: '2026-10-12' })]); // M7 Oct 5 and M2 Oct 10... M2 is in the future
    expect(ofKind(result, 'milestone').map(stamp)).toEqual(['2026-10-10 16:00']);
  });
});

describe('race prep: which races count and relevance', () => {
  it('counts only incomplete races dated today or later', () => {
    const result = plan([race({ eventDate: '2026-10-06' }), completed('2026-12-20'), race({ eventDate: '2026-10-07' })]);
    // Yesterday's registered race and the completed race are ignored; a race today has no upcoming milestones or weekly reminder.
    expect(result.notifications).toEqual([]);
    expect(result.hasUpcomingRace).toBe(true); // a race dated today still counts as upcoming
  });

  it('plans nothing for a completed checklist', () => {
    const result = plan([race({ eventDate: '2026-12-12', checklistCompleted: ALL_ITEMS })]);
    expect(result.notifications).toEqual([]);
  });

  it('for a running race, never names swim or bike items, and treats its relevant items as the checklist', () => {
    const r = race({ eventDate: '2026-10-31', sport: 'running' });
    const result = plan([r]); // the Oct 18 reminder is 13 days out: packing phase
    const weekly = ofKind(result, 'weekly').find((n) => stamp(n) === '2026-10-18 16:00')!;
    expect(weekly.body).toBe('13 days until ' + r.name + '. Are your running shoes ready?');
    expect((weekly.data as any).i).toBe('run-shoes');
    for (const n of result.notifications) expect(n.body).not.toMatch(/wetsuit|goggles|bike|helmet|cycling|transition/i);
    // Every relevant (run/general) item checked: nothing, even though swim and bike items remain unchecked.
    const runnerItems = ALL_ITEMS.filter((id) => !/^(swim|bike)-/.test(id) && !['travel-bike-case', 'course-elevation', 'course-transition-layout', 'nutrition-bike-fuel'].includes(id));
    expect(plan([race({ eventDate: '2026-10-31', sport: 'running', checklistCompleted: runnerItems })]).notifications).toEqual([]);
  });

  it('for a triathlon, a weekly reminder close to the race starts with gear', () => {
    const r = race({ eventDate: '2026-10-31' });
    const weekly = ofKind(plan([r]), 'weekly').find((n) => stamp(n) === '2026-10-18 16:00')!;
    expect((weekly.data as any).i).toBe('swim-wetsuit');
    expect(weekly.body).toBe(`13 days until ${r.name}. Is your wetsuit ready?`);
  });

  it('works through logistics first when the race is far away, and uses the natural question for the unchecked item', () => {
    const r = race({ eventDate: '2026-12-12', checklistCompleted: ['registration-confirmed', 'registration-documents', 'registration-athlete-guide', 'travel-hotel'] });
    const first = ofKind(plan([r]), 'weekly')[0]!;
    expect(first.body).toBe(`62 days until ${r.name}. Is your transportation sorted?`);
    expect((first.data as any).i).toBe('travel-transport');
  });

  it('uses generic wording, naming no item, when the sport is uncertain', () => {
    const r = race({ eventDate: '2026-12-12', sport: 'other' });
    const result = plan([r]);
    for (const n of result.notifications) {
      expect(n.body).toMatch(/unfinished (race-)?prep items/);
      expect((n.data as any).i).toBeUndefined();
    }
  });
});

describe('race prep: the countdown is for each reminder\u2019s delivery date', () => {
  it('every weekly reminder counts down from its own slot, never from today', () => {
    const r = race({ eventDate: '2026-12-20' }); // Sunday
    const weekly = ofKind(plan([r]), 'weekly');
    const dayCount = (n: PlannedNotification) => Number(/^(\d+) days until/.exec(n.body)![1]);
    const byStamp = Object.fromEntries(weekly.map((n) => [stamp(n), dayCount(n)]));
    expect(byStamp['2026-10-11 16:00']).toBe(70); // 7 Oct is 74 days out, but this reminder is delivered on 11 Oct
    expect(byStamp['2026-10-18 16:00']).toBe(63);
    expect(byStamp['2026-11-01 16:00']).toBe(49);
    for (const n of weekly) {
      const delivered = new Date(n.fireAt.year, n.fireAt.month - 1, n.fireAt.day);
      expect(dayCount(n)).toBe(Math.round((new Date(2026, 11, 20).getTime() - delivered.getTime()) / 86_400_000));
    }
  });

  it('a reminder planned today for a later day is not recomputed for today: the wording is fixed for its delivery date', () => {
    const r = race({ eventDate: '2026-10-25' });
    const early = plan([r], prefsWith(), new Date(2026, 9, 7, 10, 0));
    const later = plan([r], prefsWith(), new Date(2026, 9, 9, 10, 0));
    const find = (res: ReturnType<typeof plan>) => ofKind(res, 'weekly').find((n) => stamp(n) === '2026-10-11 16:00');
    expect(find(early)!.body).toBe(find(later)!.body);
    expect(find(early)!.body).toMatch(/^14 days until/);
  });
});

describe('race prep: copy', () => {
  it('seven-day: asks about gear when gear is unchecked, naming the first unchecked gear item to highlight', () => {
    const r = race({ eventDate: '2026-12-12' });
    const m7 = ofKind(plan([r]), 'milestone').find((n) => stamp(n) === '2026-12-05 16:00')!;
    expect(m7.body).toBe(`One week until ${r.name}. Have you checked your gear?`);
    expect((m7.data as any).i).toBe('swim-wetsuit');
  });

  it('seven-day: with no gear unchecked, asks the specific question for another unchecked item', () => {
    const gearDone = ALL_ITEMS.filter((id) => /^(swim|bike|run)-/.test(id));
    const r = race({ eventDate: '2026-12-12', checklistCompleted: gearDone });
    const m7 = ofKind(plan([r]), 'milestone').find((n) => stamp(n) === '2026-12-05 16:00')!;
    expect(m7.body).toMatch(/^One week until .*\. (Is|Have|Are|Do)/);
    expect(m7.body).not.toMatch(/gear/);
  });

  it('two-day: "You have unfinished prep items." (a specific question only when exactly one item is left)', () => {
    const r = race({ eventDate: '2026-12-12' });
    const m2 = ofKind(plan([r]), 'milestone').find((n) => stamp(n) === '2026-12-10 16:00')!;
    expect(m2.body).toBe(`Two days until ${r.name}. You have unfinished prep items.`);
    const oneLeft = race({ eventDate: '2026-12-12', checklistCompleted: ALL_ITEMS.filter((id) => id !== 'nutrition-backup') });
    const m2b = ofKind(plan([oneLeft]), 'milestone').find((n) => stamp(n) === '2026-12-10 16:00')!;
    expect(m2b.body).toBe(`Two days until ${oneLeft.name}. Do you have backup nutrition?`);
  });
});

describe('race prep: one race at a time', () => {
  const racesOf = (res: ReturnType<typeof plan>) => new Set(res.notifications.map((n) => (n.data as any).r));

  it('schedules weekly, seven-day and two-day reminders ONLY for the nearest eligible race', () => {
    const near = race({ id: 'near', eventDate: '2026-11-20' });
    const far = race({ id: 'far', eventDate: '2027-01-30' });
    const result = plan([far, near]);
    expect(result.focusRace).toEqual({ id: 'near', name: near.name });
    expect([...racesOf(result)]).toEqual(['near']);
    expect(ofKind(result, 'milestone').map(stamp)).toEqual(['2026-11-13 16:00', '2026-11-18 16:00']);
    expect(ofKind(result, 'weekly').length).toBeGreaterThan(0);
    for (const n of result.notifications) expect(n.body).toContain(near.name);
    // The later race gets nothing at all: not even weekly reminders after the nearest race has passed.
    for (const n of result.notifications) expect(at(n).getTime()).toBeLessThan(new Date(2026, 10, 20).getTime());
  });

  it('does not combine milestones: two races never produce a combined or list notification, even on the same day', () => {
    const a = race({ id: 'a', eventDate: '2026-12-17' }); // would have shared a milestone day with b
    const b = race({ id: 'b', eventDate: '2026-12-12' });
    const result = plan([a, b]);
    expect([...racesOf(result)]).toEqual(['b']);
    expect(result.notifications.every((n) => n.kind === 'weekly' || n.kind === 'milestone')).toBe(true);
    expect(result.notifications.every((n) => (n.data as any).t === 'prep')).toBe(true);
    expect(result.notifications.filter((n) => stamp(n) === '2026-12-10 16:00')).toHaveLength(1);
  });

  it('a complete checklist on the nearest race sends nothing, and does NOT switch to a later race', () => {
    const doneNear = race({ id: 'near', eventDate: '2026-11-20', checklistCompleted: ALL_ITEMS });
    const far = race({ id: 'far', eventDate: '2027-01-30' });
    const result = plan([doneNear, far]);
    expect(result.notifications).toEqual([]);
    expect(result.focusRace?.id).toBe('near');
    expect(result.candidateCount).toBe(0);
    expect(result.eligibleCount).toBe(2);
  });

  it('moves to the next race when the nearest is completed, removed, or its date has passed', () => {
    const near = race({ id: 'near', eventDate: '2026-11-20' });
    const far = race({ id: 'far', eventDate: '2027-01-30' });
    expect(plan([near, far]).focusRace?.id).toBe('near');
    // Completed
    expect(plan([{ ...near, status: 'completed' }, far]).focusRace?.id).toBe('far');
    // Removed (no longer loaded)
    expect(plan([far]).focusRace?.id).toBe('far');
    // Date passed
    const afterNear = plan([near, far], prefsWith(), new Date(2026, 10, 21, 9, 0));
    expect(afterNear.focusRace?.id).toBe('far');
    expect([...racesOf(afterNear)]).toEqual(['far']);
    // Once the nearest race is finished, the next one starts getting reminders.
    expect(ofKind(plan([{ ...near, status: 'completed' }, far]), 'weekly').length).toBeGreaterThan(0);
  });

  it('a date edit re-evaluates which race is nearest: reminders move, and the old race\u2019s reminders are no longer planned', () => {
    const a = race({ id: 'a', eventDate: '2026-11-20' });
    const b = race({ id: 'b', eventDate: '2027-01-30' });
    const before = plan([a, b]);
    expect(racesOf(before)).toEqual(new Set(['a']));
    const moved = plan([a, { ...b, eventDate: '2026-11-01' }]); // b is now the nearest
    expect(moved.focusRace?.id).toBe('b');
    expect(racesOf(moved)).toEqual(new Set(['b']));
    // Nothing planned before still refers to a: its identifiers are absent from the new plan (reconcile cancels them).
    const aIds = new Set(before.notifications.map((n) => n.identifier));
    for (const n of moved.notifications) expect(aIds.has(n.identifier)).toBe(false);
    // And moving a's own date changes its reminders' identifiers (so the stale ones are cancelled).
    const edited = plan([{ ...a, eventDate: '2026-11-27' }, b]);
    expect(edited.notifications.map((n) => n.identifier).some((id) => aIds.has(id))).toBe(false);
  });

  it('races sharing the earliest date get a stable choice: the same race every time, whatever the order they are listed in', () => {
    const x = race({ id: 'race-x', eventDate: '2026-12-12' });
    const y = race({ id: 'race-y', eventDate: '2026-12-12' });
    const first = plan([x, y]);
    const second = plan([y, x]);
    expect(first.focusRace).toEqual(second.focusRace);
    expect(first.focusRace?.id).toBe('race-x');
    expect(first.notifications.map((n) => n.identifier)).toEqual(second.notifications.map((n) => n.identifier));
    expect(racesOf(first)).toEqual(new Set(['race-x']));
  });

  it('a race dated today is the focus (nothing to send), and a nearer past-dated race does not count', () => {
    const today = race({ id: 'today', eventDate: '2026-10-07' });
    const later = race({ id: 'later', eventDate: '2026-12-12' });
    const result = plan([later, today]);
    expect(result.focusRace?.id).toBe('today');
    expect(result.notifications).toEqual([]); // on race day there is nothing left to remind about, and we do not skip ahead
    expect(plan([later, race({ eventDate: '2026-10-06' })]).focusRace?.id).toBe('later');
  });

  it('between-race prompts stay paused while any eligible race exists, including one with a complete checklist', () => {
    const doneNear = race({ id: 'near', eventDate: '2026-11-20', checklistCompleted: ALL_ITEMS });
    const result = plan([doneNear], prefsWith({ betweenRace: { enabled: true } }));
    expect(ofKind(result, 'between')).toHaveLength(0);
    expect(result.hasUpcomingRace).toBe(true);
  });
});

describe('horizon and limits', () => {
  it('schedules at most 12 weeks of reminders: a distant race gets weekly reminders but no milestones yet', () => {
    const result = plan([race({ eventDate: '2027-03-20' })]);
    expect(ofKind(result, 'milestone')).toHaveLength(0);
    expect(ofKind(result, 'weekly').length).toBeLessThanOrEqual(12);
    expect(ofKind(result, 'weekly').length).toBeGreaterThanOrEqual(11);
  });

  it('never exceeds the OS limit, keeping the soonest reminders', () => {
    const many = Array.from({ length: 40 }, (_, i) => race({ eventDate: `2026-${i % 2 === 0 ? '11' : '12'}-${String((i % 27) + 1).padStart(2, '0')}` }));
    const result = plan(many, prefsWith({ betweenRace: { enabled: true } }));
    expect(result.notifications.length).toBeLessThanOrEqual(MAX_PENDING);
    const times = result.notifications.map((n) => at(n).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('gives a changed reminder a new identifier and an unchanged one the same identifier', () => {
    const r = race({ eventDate: '2026-12-12' });
    const first = plan([r]).notifications.map((n) => n.identifier);
    expect(plan([r]).notifications.map((n) => n.identifier)).toEqual(first);
    const toggled = plan([{ ...r, checklistCompleted: ['registration-confirmed'] }]).notifications.map((n) => n.identifier);
    expect(toggled).not.toEqual(first);
    for (const id of first) expect(id.startsWith(`rs:${ATHLETE}:`)).toBe(true);
  });
});

describe('between-race prompts: planning', () => {
  const between = (extra: Parameters<typeof prefsWith>[0] = {}) => prefsWith({ racePrep: { enabled: false }, betweenRace: { enabled: true }, ...extra });

  it('plans one prompt per week on Sunday at 4 p.m. for eight weeks', () => {
    const result = plan([], between());
    const prompts = ofKind(result, 'between');
    expect(prompts).toHaveLength(8);
    for (const n of prompts) expect([at(n).getDay(), n.fireAt.hour, n.fireAt.minute]).toEqual([0, 16, 0]);
    expect(stamp(prompts[0]!)).toBe('2026-10-11 16:00');
    expect(prompts.every((n) => (n.data as any).t === 'between')).toBe(true);
  });

  it('is off by default and pauses while an upcoming race exists', () => {
    expect(plan([], { ...DEFAULT_PREFS }).notifications).toEqual([]);
    const paused = plan([race({ eventDate: '2026-12-12' })], between());
    expect(ofKind(paused, 'between')).toHaveLength(0);
    expect(paused.rotation.assigned).toEqual([]);
  });

  it('a race dated before today no longer pauses it', () => {
    const result = plan([race({ eventDate: '2026-10-01' })], between());
    expect(ofKind(result, 'between')).toHaveLength(8);
  });

  it('retrospective prompts require a completed race in the last 12 months', () => {
    const none = ofKind(plan([], between()), 'between').map((n) => (n.data as any).p);
    for (const id of none) expect(['next-season-focus', 'try-next-distance', 'next-race-success']).toContain(id);
    const old = ofKind(plan([completed('2025-09-01')], between()), 'between').map((n) => (n.data as any).p);
    for (const id of old) expect(['next-season-focus', 'try-next-distance', 'next-race-success']).toContain(id);
    const recent = plan([completed('2026-06-01')], between());
    const ids = new Set(ofKind(recent, 'between').map((n) => (n.data as any).p));
    expect([...ids].some((id) => ['more-time-this-season', 'went-well', 'change-prep'].includes(id))).toBe(true);
  });

  it('opens each prompt with its question as the notification body', () => {
    const prompts = ofKind(plan([], between()), 'between');
    for (const n of prompts) {
      expect(n.title).toBe('Think about what comes next');
      expect(n.body).toMatch(/\?$/);
    }
  });

  it('uses the edited day and time', () => {
    const prompts = ofKind(plan([], between({ betweenRace: { enabled: true, day: 6, hour: 9, minute: 30 } })), 'between');
    for (const n of prompts) expect([at(n).getDay(), n.fireAt.hour, n.fireAt.minute]).toEqual([6, 9, 30]);
  });

  it('does not reshuffle already scheduled prompts when planned again, and advances when their time passes', () => {
    const first = plan([], between());
    const ids = (r: typeof first) => ofKind(r, 'between').map((n) => `${stamp(n)}:${(n.data as any).p}`);
    const again = planNotifications({ now: new Date(2026, 9, 8, 9, 0), athleteId: ATHLETE, prefs: between(), races: [], rotation: first.rotation, rng: () => 0.99 });
    expect(ids(again).slice(0, 8)).toEqual(ids(first).slice(0, 8)); // a different rng changes nothing already assigned
    // After the first slot has passed, it is gone and a new one is appended after the last.
    const later = planNotifications({ now: new Date(2026, 9, 11, 17, 0), athleteId: ATHLETE, prefs: between(), races: [], rotation: first.rotation, rng: () => 0.5 });
    expect(ids(later).slice(0, 7)).toEqual(ids(first).slice(1, 8));
    expect(later.rotation.lastShown).toBe((ofKind(first, 'between')[0]!.data as any).p);
  });
});
