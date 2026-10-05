import { weekdayName, type Weekday } from '@/lib/notifications/prefs';

/** "4:00 PM" from a 24-hour hour and minute, without relying on the device locale. */
export function formatTimeOfDay(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "Sunday, 4:00 PM". */
export function formatWeeklySlot(day: Weekday, hour: number, minute: number): string {
  return `${weekdayName(day)}, ${formatTimeOfDay(hour, minute)}`;
}

/** "Sundays at 4 p.m." style phrase for the invitation copy. */
export function formatWeeklyPhrase(day: Weekday, hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const time = minute === 0 ? `${h} ${suffix}` : `${h}:${String(minute).padStart(2, '0')} ${suffix}`;
  return `${weekdayName(day)}s at ${time}`;
}

export const SIGNAL_ASK_NOTE = 'Sending it needs an available Signal ask or Premium.';
