/**
 * Wall-clock helpers for notification planning. Everything here works in the device's LOCAL calendar (year, month, day, hour, minute),
 * never in UTC, because the product rule is "Sunday at 4 p.m. wherever the athlete is".
 */

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function fromDate(date: Date): LocalDateTime {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
}

export function toDate(value: LocalDateTime): Date {
  return new Date(value.year, value.month - 1, value.day, value.hour, value.minute, 0, 0);
}

/** "2026-10-04" for the local calendar day of `date`. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-10-04T16:00": a sortable key for a local wall-clock minute. */
export function minuteKey(value: LocalDateTime): string {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
}

export function minuteKeyOf(date: Date): string {
  return minuteKey(fromDate(date));
}

/** A race's `YYYY-MM-DD` as a local calendar date (midnight local), or null if it is not a full date. */
export function parseRaceDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** `days` calendar days after `date`, keeping the same wall-clock time (daylight-saving safe). */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), 0, 0);
}

/** Whole calendar days from `from` to `to` (local days; negative if `to` is earlier). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** The local moment at `hour:minute` on the calendar day of `day`. */
export function atTime(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

export const HOUR_MS = 3_600_000;
