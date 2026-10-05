import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import type { Race } from '@/fixtures/races';
import { NotificationsProvider, resetLaunchCounting, useNotifications } from '@/lib/notifications/NotificationsProvider';
import { PREFS_KEY_PREFIX, ROTATION_KEY_PREFIX } from '@/lib/notifications/prefs';
import { createFakeApi } from './helpers/fakeNotificationsApi';

/**
 * The provider owns preferences, permission, the schedule and the invitations, per athlete and per device. Everything here runs against an in-memory
 * stand-in for the OS scheduler (see helpers/fakeNotificationsApi.ts).
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('@/lib/notifications/api', () => ({ installForegroundHandler: jest.fn(), notificationsApi: {} }));
let mockSession: { user: { id: string } } | null = { user: { id: 'athlete-1' } };
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: mockSession }) }));
let mockRaces: { isLoading: boolean; isError: boolean; data: Race[] } = { isLoading: false, isError: false, data: [] };
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => mockRaces }));

const NOW = new Date(2026, 9, 7, 10, 0); // Wed Oct 7 2026
const now = () => NOW;
const race = (overrides: Partial<Race> = {}): Race =>
  ({ id: 'r1', name: 'Test Tri', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2026-12-12', location: '', status: 'registered', isManual: true, ...overrides }) as Race;
const completedRace = (): Race => race({ id: 'done', status: 'completed', eventDate: '2026-06-01', result: { finishSeconds: 1, splits: [], sourceStatus: 'imported_confirmed' } } as Partial<Race>);

let ctx: ReturnType<typeof useNotifications>;
function Probe() {
  ctx = useNotifications();
  return null;
}

async function mount(api: ReturnType<typeof createFakeApi>['api'], startedInApp = true) {
  // A fresh element each time, so a re-render really re-reads the (mutable) mocked session and races.
  const build = () => (
    <NotificationsProvider api={api} now={now} startedInApp={startedInApp}>
      <Probe />
    </NotificationsProvider>
  );
  const view = await render(build());
  return { unmount: () => view.unmount(), rerenderTree: () => view.rerender(build()) };
}

const settle = async (ms = 450) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const storedPrefs = async (athlete = 'athlete-1') => JSON.parse((await AsyncStorage.getItem(PREFS_KEY_PREFIX + athlete)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  resetLaunchCounting();
  mockSession = { user: { id: 'athlete-1' } };
  mockRaces = { isLoading: false, isError: false, data: [] };
});

describe('opt-in and permission', () => {
  it('starts off, schedules nothing, and never asks iOS for permission on its own', async () => {
    const { api, state } = createFakeApi();
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await settle();
    expect(ctx.prefs.racePrep.enabled).toBe(false);
    expect(ctx.prefs.betweenRace.enabled).toBe(false);
    expect(state.permissionRequests).toBe(0);
    expect(state.scheduled).toEqual([]);
  });

  it('asks for permission only when Enable is tapped, then applies the defaults immediately', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi();
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      expect(await ctx.enable('racePrep')).toBe('enabled');
    });
    expect(state.permissionRequests).toBe(1);
    expect(ctx.prefs.racePrep).toMatchObject({ enabled: true, weeklyDay: 0, weeklyHour: 16, weeklyMinute: 0, milestoneHour: 16 });
    await waitFor(() => expect(state.scheduled.length).toBeGreaterThan(0));
    expect(state.scheduled.every((s) => s.identifier.startsWith('rs:athlete-1:'))).toBe(true);
    expect((await storedPrefs()).racePrep.enabled).toBe(true);
  });

  it('a refused iOS prompt leaves the type off and schedules nothing', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi();
    state.nextPromptAnswer = 'denied';
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      expect(await ctx.enable('racePrep')).toBe('denied');
    });
    expect(ctx.prefs.racePrep.enabled).toBe(false);
    expect(ctx.permission).toBe('denied');
    await settle();
    expect(state.scheduled).toEqual([]);
  });

  it('with permission already denied, Enable does not prompt again and reports denied', async () => {
    const { api, state } = createFakeApi({ permission: 'denied' });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      expect(await ctx.enable('betweenRace')).toBe('denied');
    });
    expect(state.permissionRequests).toBe(0);
    expect(ctx.prefs.betweenRace.enabled).toBe(false);
  });

  it('turning a type off cancels its reminders', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      await ctx.enable('racePrep');
    });
    await waitFor(() => expect(state.pending.size).toBeGreaterThan(0));
    await act(async () => {
      await ctx.disable('racePrep');
    });
    await waitFor(() => expect(state.pending.size).toBe(0));
  });

  it('permission turned off later in iOS Settings is detected on return to the foreground: reminders are cancelled and the state is shown', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    let appStateHandler: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (s: string) => void) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as never);
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      await ctx.enable('racePrep');
    });
    await waitFor(() => expect(state.pending.size).toBeGreaterThan(0));
    state.permission = 'denied';
    await act(async () => {
      appStateHandler!('active');
    });
    await waitFor(() => expect(state.pending.size).toBe(0));
    expect(ctx.permission).toBe('denied');
    expect(ctx.prefs.racePrep.enabled).toBe(true); // the preference is kept; Settings explains why nothing is delivered
    jest.restoreAllMocks();
  });
});

describe('reconciliation', () => {
  it('reschedules when the checklist changes and when a race is edited or removed', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    const view = await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      await ctx.enable('racePrep');
    });
    await waitFor(() => expect(state.pending.size).toBeGreaterThan(0));
    const before = [...state.pending.keys()].sort();

    mockRaces = { ...mockRaces, data: [race({ checklistCompleted: ['registration-confirmed', 'registration-documents'] })] };
    await view.rerenderTree();
    await settle();
    expect([...state.pending.keys()].sort()).not.toEqual(before);
    expect(state.pending.size).toBe(before.length); // same slots, new wording

    mockRaces = { ...mockRaces, data: [] };
    await view.rerenderTree();
    await settle();
    expect(state.pending.size).toBe(0); // the only race was removed
  });

  it('does not plan from races that are still loading or failed to load', async () => {
    mockRaces = { isLoading: true, isError: false, data: [] };
    const { api, state } = createFakeApi({ permission: 'granted' });
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ racePrep: { enabled: true } }));
    await api.schedule({ identifier: 'rs:athlete-1:existing', title: 't', body: 'b', data: {}, fireAt: { year: 2026, month: 12, day: 1, hour: 16, minute: 0 } });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await settle();
    expect(state.pending.has('rs:athlete-1:existing')).toBe(true); // untouched until the data is there
    expect(state.cancelled).toEqual([]);
  });

  it('rebuilds the whole schedule when the timezone changed since it was built', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ racePrep: { enabled: true }, lastTimeZone: 'Pacific/Fake_Zone' }));
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await waitFor(() => expect(state.scheduled.length).toBeGreaterThan(0));
    const firstPass = state.scheduled.length;
    await settle();
    expect((await storedPrefs()).lastTimeZone).not.toBe('Pacific/Fake_Zone');
    expect(state.scheduled.length).toBe(firstPass); // recorded once, no churn afterwards
  });
});

describe('accounts', () => {
  it('cancels everything when the session is lost, and keeps each account’s preferences separate', async () => {
    mockRaces.data = [race()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    const view = await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      await ctx.enable('racePrep');
    });
    await waitFor(() => expect(state.pending.size).toBeGreaterThan(0));

    mockSession = null; // signed out, or the session expired
    await view.rerenderTree();
    await waitFor(() => expect(state.pending.size).toBe(0));

    mockSession = { user: { id: 'athlete-2' } }; // a different account on the same device starts from the defaults
    await view.rerenderTree();
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.prefs.racePrep.enabled).toBe(false);
    await settle();
    expect(state.pending.size).toBe(0);
    expect((await storedPrefs('athlete-2')).racePrep.enabled).toBe(false); // only its own launch count was recorded
    expect((await storedPrefs('athlete-1')).racePrep.enabled).toBe(true);
  });

  it('cancelAllForSignOut cancels every reminder, for any account', async () => {
    const { api, state } = createFakeApi({ permission: 'granted' });
    await api.schedule({ identifier: 'rs:athlete-1:a', title: 't', body: 'b', data: {}, fireAt: { year: 2026, month: 12, day: 1, hour: 16, minute: 0 } });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => {
      await ctx.cancelAllForSignOut();
    });
    expect(state.pending.size).toBe(0);
  });
});

describe('launch counting and the one-time between-race invitation', () => {
  it('counts a fresh launch once per process, never one that began in onboarding, and starts counting at the first launch of this feature', async () => {
    const { api } = createFakeApi();
    const first = await mount(api, true);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await waitFor(async () => expect((await storedPrefs()).launches).toBe(1));
    await first.rerenderTree();
    await settle(100);
    expect((await storedPrefs()).launches).toBe(1); // a re-render in the same process does not count again
    await first.unmount();

    resetLaunchCounting(); // a new process
    await mount(api, false); // started in onboarding: not counted
    await waitFor(() => expect(ctx.ready).toBe(true));
    await settle(100);
    expect((await storedPrefs()).launches).toBe(1);
  });

  it('offers the invitation on the second launch only, with no upcoming race, and only once', async () => {
    const { api } = createFakeApi();
    const first = await mount(api);
    await waitFor(() => expect(ctx.prefs.launches).toBe(1));
    expect(ctx.invitation).toBeNull();
    await first.unmount();

    resetLaunchCounting();
    await mount(api);
    await waitFor(() => expect(ctx.prefs.launches).toBe(2));
    expect(ctx.invitation).toEqual({ kind: 'betweenRace' });
    await act(async () => ctx.markInvitationPresented());
    await waitFor(() => expect(ctx.prefs.betweenRace.invite).toBe('shown'));
    expect(ctx.invitation).toBeNull(); // once: presenting it uses it up

    resetLaunchCounting();
    await mount(api);
    await waitFor(() => expect(ctx.prefs.launches).toBe(3));
    expect(ctx.invitation).toBeNull();
  });

  it('is not offered while an upcoming race is saved, and a race dated in the past does not block it', async () => {
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ launches: 1 }));
    mockRaces.data = [race()];
    const { api } = createFakeApi();
    await mount(api);
    await waitFor(() => expect(ctx.prefs.launches).toBe(2));
    expect(ctx.invitation).toBeNull();

    resetLaunchCounting();
    mockRaces.data = [race({ eventDate: '2026-09-01' })]; // registered but long past
    await mount(api);
    await waitFor(() => expect(ctx.prefs.launches).toBe(3));
    expect(ctx.invitation).toEqual({ kind: 'betweenRace' });
  });

  it('"Not now" dismisses it permanently; enabling in Settings still works', async () => {
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ launches: 1 }));
    const { api } = createFakeApi({ permission: 'granted' });
    await mount(api);
    await waitFor(() => expect(ctx.invitation).toEqual({ kind: 'betweenRace' }));
    await act(async () => {
      await ctx.dismissInvitation();
    });
    expect(ctx.prefs.betweenRace.invite).toBe('dismissed');
    expect(ctx.invitation).toBeNull();
    await act(async () => {
      expect(await ctx.enable('betweenRace')).toBe('enabled'); // the Settings switch
    });
    expect(ctx.prefs.betweenRace.enabled).toBe(true);
  });

  it('offers race reminders after an upcoming race is saved, once, until enabled or dismissed', async () => {
    mockRaces.data = [race()];
    const { api } = createFakeApi({ permission: 'granted' });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    expect(ctx.invitation).toBeNull();
    await act(async () => ctx.requestRacePrepOffer('r1'));
    expect(ctx.invitation).toEqual({ kind: 'racePrep', raceId: 'r1' });
    await act(async () => {
      await ctx.dismissInvitation();
    });
    expect(ctx.prefs.racePrep.offer).toBe('dismissed');
    await act(async () => ctx.requestRacePrepOffer('r1'));
    expect(ctx.invitation).toBeNull(); // never offered again after "Not now"
  });

  it('does not offer race reminders when they are already on', async () => {
    mockRaces.data = [race()];
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ racePrep: { enabled: true } }));
    const { api } = createFakeApi({ permission: 'granted' });
    await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await act(async () => ctx.requestRacePrepOffer('r1'));
    expect(ctx.invitation).toBeNull();
  });
});

describe('prompt rotation persistence', () => {
  it('stores the assigned prompts so a later reconcile never reshuffles them', async () => {
    mockRaces.data = [completedRace()];
    const { api, state } = createFakeApi({ permission: 'granted' });
    await AsyncStorage.setItem(PREFS_KEY_PREFIX + 'athlete-1', JSON.stringify({ betweenRace: { enabled: true } }));
    const view = await mount(api);
    await waitFor(() => expect(ctx.ready).toBe(true));
    await waitFor(() => expect(state.pending.size).toBe(8));
    const first = [...state.pending.values()].map((r) => `${r.identifier}`);
    const rotation = JSON.parse((await AsyncStorage.getItem(ROTATION_KEY_PREFIX + 'athlete-1')) ?? 'null');
    expect(rotation.assigned).toHaveLength(8);
    await view.rerenderTree();
    await act(async () => {
      await ctx.reconcileNow();
    });
    expect([...state.pending.values()].map((r) => r.identifier)).toEqual(first);
  });
});
