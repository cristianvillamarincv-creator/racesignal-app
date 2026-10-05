import type { Race } from '@/fixtures/races';
import {
  addCalendarDays,
  atTime,
  calendarDaysBetween,
  dayKey,
  fromDate,
  HOUR_MS,
  minuteKey,
  minuteKeyOf,
  parseRaceDate,
  startOfLocalDay,
  toDate,
  type LocalDateTime,
} from '@/lib/notifications/localTime';
import { PAYLOAD_VERSION, type TapPayload } from '@/lib/notifications/payload';
import type { NotificationPrefs } from '@/lib/notifications/prefs';
import { eligiblePromptIds, promptById } from '@/lib/notifications/prompts';
import {
  ITEM_QUESTIONS,
  pickWeeklyItem,
  relevantItemsFor,
  uncheckedGear,
  uncheckedRelevantItems,
} from '@/lib/notifications/relevance';
import { reconcileRotation, type RotationState } from '@/lib/notifications/rotation';

/**
 * Decides which local notifications should exist right now. Pure: it takes the clock, the preferences, the races (with their checklist
 * state) and the prompt rotation, and returns the full desired schedule plus the updated rotation. The scheduler then makes the OS match.
 *
 * Race prep (only while enabled):
 *  - eligible races are incomplete (not "completed") and dated today or later; a race whose relevant checklist items are all checked gets nothing;
 *  - a seven-day and a two-day milestone per race at the milestone time; milestones falling on the same day (for different races) combine
 *    into one notification that opens the Races list;
 *  - ONE weekly reminder total (Sunday 4 p.m. by default), about the nearest race with unchecked relevant items; a weekly reminder within 48 hours
 *    of any milestone is suppressed, and none is sent on or after race day;
 *  - everything within 12 weeks of now.
 * Between-race prompts (only while enabled and NO eligible upcoming race exists): one per week for up to eight weeks, assigned from the rotation.
 */

export const RACE_HORIZON_DAYS = 12 * 7;
export const PROMPT_HORIZON_DAYS = 8 * 7;
/** Reminders closer than this to "now" are not scheduled (the OS may drop a trigger that is already in the past by the time it is applied). */
export const MIN_LEAD_MS = 60_000;
/** iOS keeps at most 64 pending local notifications; stay under it. */
export const MAX_PENDING = 60;
export const SUPPRESSION_WINDOW_MS = 48 * HOUR_MS;

export type PlannedKind = 'weekly' | 'milestone' | 'milestones-combined' | 'between';

export interface PlannedNotification {
  /** Stable for the same content, so a changed reminder gets a new identifier and is rescheduled. */
  identifier: string;
  kind: PlannedKind;
  fireAt: LocalDateTime;
  title: string;
  body: string;
  data: TapPayload;
}

export interface PlanInput {
  now: Date;
  athleteId: string;
  prefs: NotificationPrefs;
  races: Race[];
  rotation: RotationState;
  rng?: () => number;
}

export interface PlanResult {
  notifications: PlannedNotification[];
  rotation: RotationState;
  /** True while an eligible upcoming race exists (between-race prompts are paused). */
  hasUpcomingRace: boolean;
}

export const IDENTIFIER_PREFIX = 'rs:';
export const TEST_IDENTIFIER_PREFIX = 'rs-test:';

const GENERIC_PREP = 'You have unfinished race-prep items.';

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function identify(athleteId: string, kind: PlannedKind, key: string, fireAt: LocalDateTime, title: string, body: string, data: TapPayload): PlannedNotification {
  const contentHash = hash(`${title}|${body}|${minuteKey(fireAt)}|${JSON.stringify(data)}`);
  return { identifier: `${IDENTIFIER_PREFIX}${athleteId}:${kind}:${key}:${contentHash}`, kind, fireAt, title, body, data };
}

function pluralDays(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

interface EligibleRace {
  race: Race;
  date: Date;
  /** Unchecked relevant items (for an uncertain sport: every unchecked item, never named). */
  open: ReturnType<typeof uncheckedRelevantItems>;
  uncertain: boolean;
}

/** Upcoming for notification purposes: not completed and dated today or later. */
export function eligibleUpcomingRaces(races: Race[], now: Date): { race: Race; date: Date }[] {
  const today = startOfLocalDay(now);
  return races
    .filter((race) => race.status !== 'completed')
    .map((race) => ({ race, date: parseRaceDate(race.eventDate) }))
    .filter((entry): entry is { race: Race; date: Date } => entry.date !== null && entry.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function hasRecentCompletedRace(races: Race[], now: Date): boolean {
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return races.some((race) => {
    if (race.status !== 'completed') return false;
    const date = parseRaceDate(race.eventDate);
    return date !== null && date.getTime() >= cutoff.getTime() && date.getTime() <= now.getTime();
  });
}

function entryFor(race: Race): EligibleRace {
  const relevance = relevantItemsFor(race.sport);
  return { race, date: parseRaceDate(race.eventDate) ?? new Date(NaN), uncertain: relevance.uncertain, open: uncheckedRelevantItems(race.sport, race.checklistCompleted) };
}

/** The body (and the item to highlight, if any) of a weekly reminder for `race` that is `days` days out. Used by the planner and the development tools. */
export function buildWeeklyContent(race: Race, days: number): { body: string; itemId?: string } {
  const entry = entryFor(race);
  const item = entry.uncertain ? null : pickWeeklyItem(entry.open, days);
  return item ? { body: `${pluralDays(days)} until ${race.name}. ${ITEM_QUESTIONS[item.id]}`, itemId: item.id } : { body: `${pluralDays(days)} until ${race.name}. ${GENERIC_PREP}` };
}

/** The body (and item) of the seven-day or two-day milestone for `race`. */
export function buildMilestoneContent(race: Race, which: 7 | 2): { body: string; itemId?: string } {
  return milestoneCopy(entryFor(race), which);
}

function milestoneCopy(entry: EligibleRace, which: 7 | 2): { body: string; itemId?: string } {
  const name = entry.race.name;
  if (which === 7) {
    const gear = entry.uncertain ? [] : uncheckedGear(entry.open);
    if (gear.length > 0) return { body: `One week until ${name}. Have you checked your gear?`, itemId: gear[0]!.id };
    const item = entry.uncertain ? null : pickWeeklyItem(entry.open, 7);
    if (item) return { body: `One week until ${name}. ${ITEM_QUESTIONS[item.id]}`, itemId: item.id };
    return { body: `One week until ${name}. ${GENERIC_PREP}` };
  }
  if (!entry.uncertain && entry.open.length === 1) {
    const only = entry.open[0]!;
    return { body: `Two days until ${name}. ${ITEM_QUESTIONS[only.id]}`, itemId: only.id };
  }
  return { body: `Two days until ${name}. You have unfinished prep items.` };
}

export function planNotifications(input: PlanInput): PlanResult {
  const { now, athleteId, prefs, races } = input;
  const nowMs = now.getTime();
  const earliest = nowMs + MIN_LEAD_MS;
  const upcoming = eligibleUpcomingRaces(races, now);
  const hasUpcomingRace = upcoming.length > 0;
  const planned: PlannedNotification[] = [];

  // ---- Race prep ----
  if (prefs.racePrep.enabled) {
    const horizon = addCalendarDays(now, RACE_HORIZON_DAYS).getTime();
    const candidates: EligibleRace[] = upcoming
      .map(({ race, date }) => {
        const relevance = relevantItemsFor(race.sport);
        return { race, date, uncertain: relevance.uncertain, open: uncheckedRelevantItems(race.sport, race.checklistCompleted) };
      })
      .filter((entry) => entry.open.length > 0); // a completed checklist gets no reminders

    // Milestones (all of them, even past the horizon, count for suppression; only the in-horizon ones are scheduled).
    interface Milestone { entry: EligibleRace; which: 7 | 2; at: Date }
    const milestones: Milestone[] = [];
    for (const entry of candidates) {
      for (const which of [7, 2] as const) {
        const at = atTime(addCalendarDays(entry.date, -which), prefs.racePrep.milestoneHour, prefs.racePrep.milestoneMinute);
        milestones.push({ entry, which, at });
      }
    }
    const scheduledMilestones = milestones.filter((m) => m.at.getTime() >= earliest && m.at.getTime() <= horizon);

    const byDay = new Map<string, Milestone[]>();
    for (const m of scheduledMilestones) byDay.set(dayKey(m.at), [...(byDay.get(dayKey(m.at)) ?? []), m]);
    for (const [day, group] of byDay) {
      const distinctRaces = new Set(group.map((m) => m.entry.race.id));
      const fireAt = fromDate(group[0]!.at);
      if (distinctRaces.size > 1) {
        // Same-day milestones for several races: ONE notification that opens the upcoming-race list.
        const names = [...distinctRaces].map((id) => group.find((m) => m.entry.race.id === id)!.entry.race.name);
        const title = 'Race prep';
        const body = `${distinctRaces.size} races are coming up and have unfinished prep items: ${names.join(', ')}.`;
        planned.push(identify(athleteId, 'milestones-combined', day, fireAt, title, body, { v: PAYLOAD_VERSION, a: athleteId, t: 'prep-list' }));
      } else {
        for (const m of group) {
          const copy = milestoneCopy(m.entry, m.which);
          planned.push(
            identify(athleteId, 'milestone', `${m.entry.race.id}-${m.which}`, fireAt, 'Race prep', copy.body, {
              v: PAYLOAD_VERSION,
              a: athleteId,
              t: 'prep',
              r: m.entry.race.id,
              ...(copy.itemId ? { i: copy.itemId } : {}),
            }),
          );
        }
      }
    }

    // One weekly reminder per slot, about the nearest race with open items; suppressed near any milestone and on/after race day.
    for (let offset = 0; offset <= RACE_HORIZON_DAYS; offset++) {
      const day = addCalendarDays(startOfLocalDay(now), offset);
      if (day.getDay() !== prefs.racePrep.weeklyDay) continue;
      const slot = atTime(day, prefs.racePrep.weeklyHour, prefs.racePrep.weeklyMinute);
      if (slot.getTime() < earliest || slot.getTime() > horizon) continue;
      if (milestones.some((m) => Math.abs(m.at.getTime() - slot.getTime()) <= SUPPRESSION_WINDOW_MS)) continue;
      const subject = candidates.find((entry) => calendarDaysBetween(day, entry.date) > 0);
      if (!subject) continue;
      const days = calendarDaysBetween(day, subject.date);
      const item = subject.uncertain ? null : pickWeeklyItem(subject.open, days);
      const body = item
        ? `${pluralDays(days)} until ${subject.race.name}. ${ITEM_QUESTIONS[item.id]}`
        : `${pluralDays(days)} until ${subject.race.name}. ${GENERIC_PREP}`;
      planned.push(
        identify(athleteId, 'weekly', `${subject.race.id}-${dayKey(slot)}`, fromDate(slot), 'Race prep', body, {
          v: PAYLOAD_VERSION,
          a: athleteId,
          t: 'prep',
          r: subject.race.id,
          ...(item ? { i: item.id } : {}),
        }),
      );
    }
  }

  // ---- Between-race prompts ----
  // Slots exist only while the type is enabled AND no eligible upcoming race exists. Otherwise the rotation is reconciled with no slots: passed
  // slots count as shown, unshown assignments return to the pool, and the rotation resumes from what is unused.
  const promptIds = eligiblePromptIds(hasRecentCompletedRace(races, now));
  const slots: Date[] = [];
  if (prefs.betweenRace.enabled && !hasUpcomingRace) {
    const horizon = addCalendarDays(now, PROMPT_HORIZON_DAYS).getTime();
    for (let offset = 0; offset <= PROMPT_HORIZON_DAYS; offset++) {
      const day = addCalendarDays(startOfLocalDay(now), offset);
      if (day.getDay() !== prefs.betweenRace.day) continue;
      const slot = atTime(day, prefs.betweenRace.hour, prefs.betweenRace.minute);
      if (slot.getTime() >= earliest && slot.getTime() <= horizon) slots.push(slot);
    }
  }
  const slotKeys = slots.map((slot) => minuteKeyOf(slot));
  const rotation = reconcileRotation(input.rotation, { eligibleIds: promptIds, slots: slotKeys, nowKey: minuteKeyOf(now), rng: input.rng });
  for (const assignment of rotation.assigned) {
    const prompt = promptById(assignment.id);
    const slot = slots[slotKeys.indexOf(assignment.slot)];
    if (!prompt || !slot) continue;
    planned.push(
      identify(athleteId, 'between', assignment.slot, fromDate(slot), 'Think about what comes next', prompt.question, {
        v: PAYLOAD_VERSION,
        a: athleteId,
        t: 'between',
        p: prompt.id,
      }),
    );
  }

  planned.sort((a, b) => toDate(a.fireAt).getTime() - toDate(b.fireAt).getTime());
  return { notifications: planned.slice(0, MAX_PENDING), rotation, hasUpcomingRace };
}
