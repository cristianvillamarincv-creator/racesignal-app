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
 * Race prep (only while enabled), ONE race at a time:
 *  - the FOCUS race is the nearest eligible race: incomplete (not "completed") and dated today or later; races sharing the earliest date are ordered by id,
 *    so the choice is stable and reconciliation never alternates between them;
 *  - only the focus race gets reminders: a Sunday 4 p.m. weekly reminder (default, editable) about one relevant unchecked item, plus a seven-day and a
 *    two-day milestone at the milestone time. A weekly reminder within 48 hours of either milestone is suppressed (both milestones are always kept), and none is
 *    sent on or after race day. Other races get nothing and their milestones are never combined or scheduled;
 *  - if the focus race's relevant checklist is complete it gets nothing, and the plan does NOT move to a later race: focus moves only when the focus race is
 *    completed, removed, past, or no longer the nearest (a date edit), and the next reconcile cancels the obsolete reminders;
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

export type PlannedKind = 'weekly' | 'milestone' | 'between';

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
  /** Eligible upcoming races (incomplete, dated today or later). */
  eligibleCount: number;
  /** 1 if the focus race still has unchecked relevant checklist items (the only case that gets reminders), else 0. */
  candidateCount: number;
  /** The race the reminders are about (the nearest eligible race), or null. */
  focusRace: { id: string; name: string } | null;
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
    // Nearest first; races sharing a date are ordered by id so the nearest race is the same one on every reconcile.
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.race.id < b.race.id ? -1 : a.race.id > b.race.id ? 1 : 0));
}

function hasRecentCompletedRace(races: Race[], now: Date): boolean {
  const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return races.some((race) => {
    if (race.status !== 'completed') return false;
    const date = parseRaceDate(race.eventDate);
    return date !== null && date.getTime() >= cutoff.getTime() && date.getTime() <= now.getTime();
  });
}

function entryFor(race: Race, date: Date = parseRaceDate(race.eventDate) ?? new Date(NaN)): EligibleRace {
  const relevance = relevantItemsFor(race.sport);
  return { race, date, uncertain: relevance.uncertain, open: uncheckedRelevantItems(race.sport, race.checklistCompleted) };
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

  // The focus race is the nearest eligible race. If its checklist is complete it gets no reminders, and we do NOT fall through to a later race.
  const focus: EligibleRace | null = upcoming[0] ? entryFor(upcoming[0].race, upcoming[0].date) : null;
  const candidates: EligibleRace[] = focus && focus.open.length > 0 ? [focus] : [];

  // ---- Race prep ----
  if (prefs.racePrep.enabled) {
    const horizon = addCalendarDays(now, RACE_HORIZON_DAYS).getTime();

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

    for (const m of scheduledMilestones) {
      const copy = milestoneCopy(m.entry, m.which);
      planned.push(
        identify(athleteId, 'milestone', `${m.entry.race.id}-${m.which}`, fromDate(m.at), 'Race prep', copy.body, {
          v: PAYLOAD_VERSION,
          a: athleteId,
          t: 'prep',
          r: m.entry.race.id,
          ...(copy.itemId ? { i: copy.itemId } : {}),
        }),
      );
    }

    // One weekly reminder per slot, about the focus race; suppressed near its milestones and on/after race day.
    for (let offset = 0; offset <= RACE_HORIZON_DAYS; offset++) {
      const day = addCalendarDays(startOfLocalDay(now), offset);
      if (day.getDay() !== prefs.racePrep.weeklyDay) continue;
      const slot = atTime(day, prefs.racePrep.weeklyHour, prefs.racePrep.weeklyMinute);
      if (slot.getTime() < earliest || slot.getTime() > horizon) continue;
      if (milestones.some((m) => Math.abs(m.at.getTime() - slot.getTime()) <= SUPPRESSION_WINDOW_MS)) continue;
      const subject = candidates[0];
      if (!subject || calendarDaysBetween(day, subject.date) <= 0) continue;
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
  return {
    notifications: planned.slice(0, MAX_PENDING),
    rotation,
    hasUpcomingRace,
    eligibleCount: upcoming.length,
    candidateCount: candidates.length,
    focusRace: focus ? { id: focus.race.id, name: focus.race.name } : null,
  };
}
