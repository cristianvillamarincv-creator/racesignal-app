/**
 * Notification preferences, per athlete and per device (stored in AsyncStorage keyed by the athlete id, see prefsStorage.ts; nothing is stored on the server).
 * Both notification types start OFF. Defaults: Sunday at 4 p.m. local time, race milestones at 4 p.m.
 */

/** 0 = Sunday ... 6 = Saturday (JavaScript's Date.getDay()). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type OfferStatus = 'unseen' | 'dismissed';
export type InviteStatus = 'unseen' | 'shown' | 'dismissed';

export interface NotificationPrefs {
  version: 1;
  racePrep: {
    enabled: boolean;
    weeklyDay: Weekday;
    weeklyHour: number;
    weeklyMinute: number;
    milestoneHour: number;
    milestoneMinute: number;
    /** The offer shown after saving an upcoming race. "Not now" dismisses it permanently. */
    offer: OfferStatus;
  };
  betweenRace: {
    enabled: boolean;
    day: Weekday;
    hour: number;
    minute: number;
    /** The one-time launch invitation: 'shown' once presented; "Not now" dismisses it permanently. */
    invite: InviteStatus;
  };
  /** Fresh launches that began in the app (after onboarding). Existing users start counting at their first launch of this feature. */
  launches: number;
  /** The timezone the schedule was last built for; a change forces a full reschedule. */
  lastTimeZone: string | null;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  version: 1,
  racePrep: { enabled: false, weeklyDay: 0, weeklyHour: 16, weeklyMinute: 0, milestoneHour: 16, milestoneMinute: 0, offer: 'unseen' },
  betweenRace: { enabled: false, day: 0, hour: 16, minute: 0, invite: 'unseen' },
  launches: 0,
  lastTimeZone: null,
};

export const PREFS_KEY_PREFIX = 'rs.notif.prefs.v1:';
export const ROTATION_KEY_PREFIX = 'rs.notif.rotation.v1:';

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/** Merges stored JSON over the defaults, ignoring anything malformed (a corrupt value falls back to its default). */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const rp = (input.racePrep && typeof input.racePrep === 'object' ? input.racePrep : {}) as Record<string, unknown>;
  const br = (input.betweenRace && typeof input.betweenRace === 'object' ? input.betweenRace : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  return {
    version: 1,
    racePrep: {
      enabled: rp.enabled === true,
      weeklyDay: clampInt(rp.weeklyDay, 0, 6, d.racePrep.weeklyDay) as Weekday,
      weeklyHour: clampInt(rp.weeklyHour, 0, 23, d.racePrep.weeklyHour),
      weeklyMinute: clampInt(rp.weeklyMinute, 0, 59, d.racePrep.weeklyMinute),
      milestoneHour: clampInt(rp.milestoneHour, 0, 23, d.racePrep.milestoneHour),
      milestoneMinute: clampInt(rp.milestoneMinute, 0, 59, d.racePrep.milestoneMinute),
      offer: rp.offer === 'dismissed' ? 'dismissed' : 'unseen',
    },
    betweenRace: {
      enabled: br.enabled === true,
      day: clampInt(br.day, 0, 6, d.betweenRace.day) as Weekday,
      hour: clampInt(br.hour, 0, 23, d.betweenRace.hour),
      minute: clampInt(br.minute, 0, 59, d.betweenRace.minute),
      invite: br.invite === 'shown' || br.invite === 'dismissed' ? br.invite : 'unseen',
    },
    launches: clampInt(input.launches, 0, 1_000_000, 0),
    lastTimeZone: typeof input.lastTimeZone === 'string' ? input.lastTimeZone : null,
  };
}

export function weekdayName(day: Weekday): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]!;
}
