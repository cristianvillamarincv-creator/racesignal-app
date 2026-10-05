import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth';
import { installForegroundHandler, notificationsApi, type NotificationsApi, type PermissionState } from '@/lib/notifications/api';
import { describeError } from '@/lib/notifications/devTests';
import { toDate, type LocalDateTime } from '@/lib/notifications/localTime';
import { eligibleUpcomingRaces, planNotifications } from '@/lib/notifications/planner';
import { DEFAULT_PREFS, type NotificationPrefs, type Weekday } from '@/lib/notifications/prefs';
import { loadPrefs, savePrefs } from '@/lib/notifications/prefsStorage';
import { cancelAllOurs, reconcileSchedule } from '@/lib/notifications/reconcile';
import { EMPTY_ROTATION, sameRotation, type RotationState } from '@/lib/notifications/rotation';
import { loadRotation, saveRotation } from '@/lib/notifications/rotationStorage';
import { useAthleteRaces } from '@/lib/racesContext';

/**
 * Owns this feature's state for the signed-in athlete on this device: preferences, OS permission, the schedule, and the opt-in invitations.
 *
 * Reconciliation (making the OS's pending notifications match the plan) runs when the app launches, returns to the foreground, and whenever
 * the athlete, the races (including checklist changes), the preferences or the permission change. It never plans from incomplete data (races still
 * loading), never schedules without permission, and cancels everything for a signed-out or switched account. Local notifications are fixed when
 * they are scheduled, so changes made on another device stay stale until this app is reopened, and reminders stop once the scheduled window runs
 * out without a reopen. Both are accepted limits of local scheduling (docs/notifications.md).
 */

export type NotificationType = 'racePrep' | 'betweenRace';
export type Invitation = { kind: 'racePrep'; raceId: string } | { kind: 'betweenRace' };

/** What reconciliation last did, read back from iOS, so Settings can confirm that reminders exist (or say why none do). */
export interface ScheduleStatusEntry {
  /** Reminders of this type that iOS lists as pending. */
  scheduled: number;
  next: LocalDateTime | null;
  /** Why nothing is scheduled, or another thing worth knowing. */
  note: string | null;
}
export interface ScheduleStatus {
  racePrep: ScheduleStatusEntry | null;
  betweenRace: ScheduleStatusEntry | null;
  /** A problem scheduling or verifying (never swallowed silently). */
  error: string | null;
}

export interface SchedulePatch {
  racePrep?: Partial<Pick<NotificationPrefs['racePrep'], 'weeklyDay' | 'weeklyHour' | 'weeklyMinute' | 'milestoneHour' | 'milestoneMinute'>>;
  betweenRace?: Partial<Pick<NotificationPrefs['betweenRace'], 'day' | 'hour' | 'minute'>>;
}

interface NotificationsContextValue {
  /** Preferences for the signed-in athlete have loaded. */
  ready: boolean;
  prefs: NotificationPrefs;
  permission: PermissionState | 'unknown';
  /** The result of the last reconcile, verified against iOS's pending list; null while nothing is enabled. */
  scheduleStatus: ScheduleStatus | null;
  /** Asks iOS for permission only now (never earlier), then turns the type on with its defaults. */
  enable: (type: NotificationType) => Promise<'enabled' | 'denied'>;
  disable: (type: NotificationType) => Promise<void>;
  updateSchedule: (patch: SchedulePatch) => Promise<void>;
  refreshPermission: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
  /** The invitation due now, if any (the host decides whether it is safe to show it). */
  invitation: Invitation | null;
  /** Called by the host when it presents the one-time between-race invitation. */
  markInvitationPresented: () => void;
  /** "Not now": dismisses the current invitation permanently. */
  dismissInvitation: () => Promise<void>;
  /** Offered after saving an upcoming race. */
  requestRacePrepOffer: (raceId: string) => void;
  /** Cancels everything this feature scheduled (sign-out). */
  cancelAllForSignOut: () => Promise<void>;
  /** For the development tools. */
  api: NotificationsApi;
  reconcileNow: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used within a NotificationsProvider');
  return context;
}

/** For screens that may render outside the provider (Developer Preview): returns null instead of throwing. */
export function useOptionalNotifications(): NotificationsContextValue | null {
  return useContext(NotificationsContext);
}

// Launches already counted in this JS process, per athlete (a Fast Refresh or provider remount must not count twice).
const countedThisProcess = new Set<string>();
/** For tests. */
export function resetLaunchCounting(): void {
  countedThisProcess.clear();
}

const currentTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
};

const systemNow = () => new Date();

export function NotificationsProvider({
  children,
  startedInApp,
  api = notificationsApi,
  now = systemNow,
}: {
  children: ReactNode;
  /** The process started in the app phase (not in onboarding): only those launches count toward the one-time invitation. */
  startedInApp: boolean;
  api?: NotificationsApi;
  now?: () => Date;
}) {
  const { session } = useAuth();
  const races = useAthleteRaces();
  const athleteId = session?.user.id ?? null;

  const [prefs, setPrefsState] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState | 'unknown'>('unknown');
  const [racePrepOfferRaceId, setRacePrepOfferRaceId] = useState<string | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  const rotationRef = useRef<RotationState>(EMPTY_ROTATION);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    installForegroundHandler();
  }, []);

  // Load this athlete's preferences and rotation; a different athlete (or none) never inherits another's.
  useEffect(() => {
    let cancelled = false;
    setLoadedFor(null);
    setPrefsState(DEFAULT_PREFS);
    rotationRef.current = EMPTY_ROTATION;
    setRacePrepOfferRaceId(null);
    setScheduleStatus(null);
    if (!athleteId) return;
    (async () => {
      const [loaded, rotation] = await Promise.all([loadPrefs(athleteId), loadRotation(athleteId)]);
      if (cancelled) return;
      rotationRef.current = rotation;
      setPrefsState(loaded);
      setLoadedFor(athleteId);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const ready = athleteId !== null && loadedFor === athleteId;

  const persist = useCallback(
    async (next: NotificationPrefs) => {
      prefsRef.current = next;
      setPrefsState(next);
      if (athleteId) await savePrefs(athleteId, next);
    },
    [athleteId],
  );

  // Count this fresh launch once (only launches that began in the app, never the one that finished onboarding).
  useEffect(() => {
    if (!ready || !athleteId || !startedInApp || races.isLoading) return;
    if (countedThisProcess.has(athleteId)) return;
    countedThisProcess.add(athleteId);
    void persist({ ...prefsRef.current, launches: prefsRef.current.launches + 1 });
  }, [ready, athleteId, startedInApp, races.isLoading, persist]);

  const refreshPermission = useCallback(async () => {
    try {
      setPermission(await api.getPermission());
    } catch {
      setPermission('unknown');
    }
  }, [api]);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission, athleteId]);

  // One reconcile at a time, in order.
  const reconcile = useCallback((): Promise<void> => {
    const run = async () => {
      try {
        if (!athleteId) {
          await cancelAllOurs(api);
          setScheduleStatus(null);
          return;
        }
        if (!ready || races.isLoading || races.isError) return; // never plan from data that is not there yet
        const current = prefsRef.current;
        const state = await api.getPermission();
        setPermission(state);
        if ((!current.racePrep.enabled && !current.betweenRace.enabled) || state !== 'granted') {
          await cancelAllOurs(api);
          setScheduleStatus(null);
          return;
        }
        const zone = currentTimeZone();
        const zoneChanged = current.lastTimeZone !== null && zone !== null && current.lastTimeZone !== zone;
        const plan = planNotifications({ now: now(), athleteId, prefs: current, races: races.data, rotation: rotationRef.current });
        const summary = await reconcileSchedule(api, plan.notifications, { rescheduleAll: zoneChanged, timeZone: zone });
        // Read iOS's pending list back: a reminder only counts as scheduled if iOS lists it.
        const pendingIds = new Set((await api.listPending()).map((entry) => entry.identifier));
        const verified = plan.notifications.filter((n) => pendingIds.has(n.identifier));
        const entry = (kinds: string[], enabled: boolean, note: string | null): ScheduleStatusEntry | null => {
          if (!enabled) return null;
          const mine = verified.filter((n) => kinds.includes(n.kind)).sort((a, b) => toDate(a.fireAt).getTime() - toDate(b.fireAt).getTime());
          return { scheduled: mine.length, next: mine[0]?.fireAt ?? null, note: mine.length === 0 ? note : null };
        };
        const racePrepNote =
          plan.eligibleCount === 0
            ? 'Nothing to schedule yet. Save an upcoming race and reminders start automatically.'
            : plan.candidateCount === 0
              ? `Nothing to remind you about${plan.focusRace ? ` for ${plan.focusRace.name}` : ''}: every relevant Race Prep item is checked.`
              : 'No reminders fall in the next 12 weeks yet.';
        const betweenNote = plan.hasUpcomingRace ? 'Paused while you have an upcoming race. It resumes automatically afterward.' : 'No prompts could be scheduled.';
        const missing = plan.notifications.length - verified.length;
        console.log('[notifications] reconcile', { planned: plan.notifications.length, verified: verified.length, scheduled: summary.scheduled, cancelled: summary.cancelled, kept: summary.kept, failed: summary.failed });
        setScheduleStatus({
          racePrep: entry(['weekly', 'milestone', 'milestones-combined'], current.racePrep.enabled, racePrepNote),
          betweenRace: entry(['between'], current.betweenRace.enabled, betweenNote),
          error:
            summary.failed > 0
              ? `iOS refused ${summary.failed} reminder${summary.failed === 1 ? '' : 's'}. Open the development test tools for details.`
              : missing > 0
                ? `Scheduled ${plan.notifications.length} but iOS lists only ${verified.length}.`
                : null,
        });
        if (!sameRotation(plan.rotation, rotationRef.current)) {
          rotationRef.current = plan.rotation;
          await saveRotation(athleteId, plan.rotation);
        }
        if (zone !== null && current.lastTimeZone !== zone) await persist({ ...prefsRef.current, lastTimeZone: zone });
      } catch (err) {
        console.warn('[notifications] reconcile failed:', err);
        setScheduleStatus({ racePrep: null, betweenRace: null, error: `Could not schedule reminders: ${describeError(err)}` });
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [api, athleteId, ready, races.isLoading, races.isError, races.data, now, persist]);

  // Reconcile when anything the plan depends on changes (debounced), and when the app returns to the foreground.
  useEffect(() => {
    const timer = setTimeout(() => void reconcile(), 300);
    return () => clearTimeout(timer);
  }, [reconcile, prefs]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPermission();
        void reconcile();
      }
    });
    return () => subscription.remove();
  }, [reconcile, refreshPermission]);

  const enable = useCallback(
    async (type: NotificationType): Promise<'enabled' | 'denied'> => {
      let state = await api.getPermission();
      if (state === 'undetermined') state = await api.requestPermission(); // the iOS prompt appears only here, after Enable
      setPermission(state);
      if (state !== 'granted') return 'denied';
      const current = prefsRef.current;
      await persist(
        type === 'racePrep'
          ? { ...current, racePrep: { ...current.racePrep, enabled: true, offer: 'dismissed' } }
          : { ...current, betweenRace: { ...current.betweenRace, enabled: true, invite: 'dismissed' } },
      );
      return 'enabled';
    },
    [api, persist],
  );

  const disable = useCallback(
    async (type: NotificationType) => {
      const current = prefsRef.current;
      await persist(type === 'racePrep' ? { ...current, racePrep: { ...current.racePrep, enabled: false } } : { ...current, betweenRace: { ...current.betweenRace, enabled: false } });
    },
    [persist],
  );

  const updateSchedule = useCallback(
    async (patch: SchedulePatch) => {
      const current = prefsRef.current;
      const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
        value !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
      const rp = { ...current.racePrep, ...patch.racePrep };
      const br = { ...current.betweenRace, ...patch.betweenRace };
      await persist({
        ...current,
        racePrep: {
          ...current.racePrep,
          weeklyDay: clamp(rp.weeklyDay, 0, 6, current.racePrep.weeklyDay) as Weekday,
          weeklyHour: clamp(rp.weeklyHour, 0, 23, current.racePrep.weeklyHour),
          weeklyMinute: clamp(rp.weeklyMinute, 0, 59, current.racePrep.weeklyMinute),
          milestoneHour: clamp(rp.milestoneHour, 0, 23, current.racePrep.milestoneHour),
          milestoneMinute: clamp(rp.milestoneMinute, 0, 59, current.racePrep.milestoneMinute),
        },
        betweenRace: {
          ...current.betweenRace,
          day: clamp(br.day, 0, 6, current.betweenRace.day) as Weekday,
          hour: clamp(br.hour, 0, 23, current.betweenRace.hour),
          minute: clamp(br.minute, 0, 59, current.betweenRace.minute),
        },
      });
    },
    [persist],
  );

  const hasUpcoming = useMemo(() => eligibleUpcomingRaces(races.data, now()).length > 0, [races.data, now]);

  const invitation = useMemo<Invitation | null>(() => {
    if (!ready || races.isLoading || races.isError) return null;
    if (racePrepOfferRaceId && !prefs.racePrep.enabled && prefs.racePrep.offer === 'unseen') {
      const stillEligible = eligibleUpcomingRaces(races.data, now()).some((entry) => entry.race.id === racePrepOfferRaceId);
      if (stillEligible) return { kind: 'racePrep', raceId: racePrepOfferRaceId };
    }
    // One-time: the first eligible launch from the second on, with no upcoming race saved, and only if it has never been shown.
    if (startedInApp && prefs.launches >= 2 && prefs.betweenRace.invite === 'unseen' && !prefs.betweenRace.enabled && !hasUpcoming) return { kind: 'betweenRace' };
    return null;
  }, [ready, races.isLoading, races.isError, races.data, racePrepOfferRaceId, prefs, startedInApp, hasUpcoming, now]);

  const markInvitationPresented = useCallback(() => {
    const current = prefsRef.current;
    if (current.betweenRace.invite === 'unseen') void persist({ ...current, betweenRace: { ...current.betweenRace, invite: 'shown' } });
  }, [persist]);

  const dismissInvitation = useCallback(async () => {
    const current = prefsRef.current;
    if (racePrepOfferRaceId && current.racePrep.offer === 'unseen' && !current.racePrep.enabled) {
      setRacePrepOfferRaceId(null);
      await persist({ ...current, racePrep: { ...current.racePrep, offer: 'dismissed' } });
      return;
    }
    await persist({ ...current, betweenRace: { ...current.betweenRace, invite: 'dismissed' } });
  }, [persist, racePrepOfferRaceId]);

  const requestRacePrepOffer = useCallback((raceId: string) => {
    const current = prefsRef.current;
    if (!current.racePrep.enabled && current.racePrep.offer === 'unseen') setRacePrepOfferRaceId(raceId);
  }, []);

  const cancelAllForSignOut = useCallback(async () => {
    await cancelAllOurs(api);
  }, [api]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      ready,
      prefs,
      permission,
      scheduleStatus,
      enable,
      disable,
      updateSchedule,
      refreshPermission,
      openSystemSettings: () => api.openSystemSettings(),
      invitation,
      markInvitationPresented,
      dismissInvitation,
      requestRacePrepOffer,
      cancelAllForSignOut,
      api,
      reconcileNow: reconcile,
    }),
    [ready, prefs, permission, scheduleStatus, enable, disable, updateSchedule, refreshPermission, api, invitation, markInvitationPresented, dismissInvitation, requestRacePrepOffer, cancelAllForSignOut, reconcile],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
