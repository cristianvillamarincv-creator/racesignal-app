import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import AskScreen from '@/app/(tabs)/ask';
import RacePrepScreen from '@/app/race/[id]';
import type { Race } from '@/fixtures/races';

/**
 * The proactive Signal suggestions about an upcoming race (the Signal tab's "Your next race" module and the race screen's
 * Signal module) appear only for a REGISTERED race with a date of today or later and at least two recent comparable results.
 * Uses the real eligibility rule with synthetic races; "today" is the device date, so dates are relative to it.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'athlete-1' } } }) }));
let mockRaces: Race[] = [];
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ isLoading: false, isError: false, data: mockRaces, removeRace: jest.fn() }) }));
jest.mock('@/lib/devPreview', () => ({ isDevPreviewAvailable: () => false, useDevPreview: () => ({ mode: 'off' }) }));
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: false, refresh: jest.fn() }) }));
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: jest.fn() }));
jest.mock('@/lib/db/signal', () => ({ fetchRecentSignalConversations: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/signal', () => ({ fetchSignalUsage: jest.fn().mockResolvedValue(null) }));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));

const isoDaysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const completed = (id: string, daysAgo: number): Race => ({
  id,
  name: `Olympic ${id}`,
  sport: 'triathlon',
  distanceLabel: 'Olympic',
  eventDate: isoDaysFromNow(-daysAgo),
  location: 'Test City',
  status: 'completed',
  result: { finishSeconds: 9000, splits: [], sourceStatus: 'imported_confirmed' },
});
const upcoming = (status: 'registered' | 'considering', daysAhead = 120, distanceLabel = 'Olympic'): Race => ({
  id: 'next',
  name: 'Lakefront Olympic',
  sport: 'triathlon',
  distanceLabel,
  eventDate: isoDaysFromNow(daysAhead),
  location: 'Lakefront',
  status,
  isManual: true,
});

const TWO = [completed('a', 60), completed('b', 300)];
const MODULE = 'What does my history suggest for Lakefront Olympic?';
const RACE_MODULE = 'What does your history suggest for this race?';

beforeEach(() => {
  mockPush.mockReset();
  mockParams = { id: 'next' };
});

async function tab(races: Race[]) {
  mockRaces = races;
  const ui = await render(<AskScreen />);
  await act(async () => {});
  await waitFor(() => expect(ui.getByText(/Ask Signal anything/)).toBeTruthy());
  return ui;
}

async function raceScreen(races: Race[]) {
  mockRaces = races;
  const ui = await render(<RacePrepScreen />);
  await act(async () => {});
  return ui;
}

describe('Signal tab: "Your next race" module', () => {
  it('shows for a registered next race with two recent comparable results', async () => {
    const ui = await tab([...TWO, upcoming('registered')]);
    expect(ui.getByText(MODULE)).toBeTruthy();
  });

  it.each([
    ['a considering race', [...TWO, upcoming('considering')]],
    ['one recent comparable result', [TWO[0]!, upcoming('registered')]],
    ['only older results', [completed('a', 60), completed('old', 1200), upcoming('registered')]],
    ['no history at all', [upcoming('registered')]],
    ['a distance with no standard match', [...TWO, upcoming('registered', 120, 'Sprint')]],
    ['a race whose date has passed', [...TWO, upcoming('registered', -3)]],
  ])('is hidden for %s, while "Ask Signal anything" stays available', async (_label, races) => {
    const ui = await tab(races as Race[]);
    expect(ui.queryByText(MODULE)).toBeNull();
    expect(ui.getByText(/Ask Signal anything/)).toBeTruthy();
  });
});

describe('Race screen: Signal module', () => {
  it('shows for a registered race with two recent comparable results', async () => {
    const ui = await raceScreen([...TWO, upcoming('registered')]);
    expect(ui.getByText(RACE_MODULE)).toBeTruthy();
  });

  it.each([
    ['a considering race', [...TWO, upcoming('considering')]],
    ['one recent comparable result', [TWO[0]!, upcoming('registered')]],
    ['no history', [upcoming('registered')]],
    ['an unsupported distance', [...TWO, upcoming('registered', 120, 'Sprint')]],
  ])('is hidden for %s', async (_label, races) => {
    const ui = await raceScreen(races as Race[]);
    expect(ui.queryByText(RACE_MODULE)).toBeNull();
  });
});
