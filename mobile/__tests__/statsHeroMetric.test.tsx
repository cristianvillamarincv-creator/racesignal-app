import React from 'react';
import { act, render, within } from '@testing-library/react-native';

import StatsScreen from '@/app/(tabs)/stats';
import type { Race } from '@/fixtures/races';

/**
 * The Performance Snapshot's hero metric. When any completed race has a valid age-group ranking (a place AND a field size, not flagged
 * as needing confirmation) the hero is "Best age-group finish · Top X%". Without one, "Races logged" is the hero: an account that
 * has no age-group rankings (for example one with only self-reported or manually entered races) never gets an invented ranking.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
let mockRaces: Race[] = [];
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ data: mockRaces, isLoading: false, isError: false }) }));
jest.mock('@/lib/raceFilterContext', () => ({
  ALL_SPORTS: 'all',
  ALL_YEARS: 'all',
  useRaceFilter: () => ({ sportFilter: 'all', setSportFilter: jest.fn(), yearFilter: 'all', setYearFilter: jest.fn() }),
}));

const race = (id: string, result: Partial<NonNullable<Race['result']>> = {}): Race => ({
  id,
  name: `Race ${id}`,
  sport: 'running',
  distanceLabel: '10K',
  eventDate: `2025-0${id}-10`,
  location: 'Test City',
  status: 'completed',
  result: { finishSeconds: 2700, splits: [], sourceStatus: 'self_reported', ...result },
});

async function open(races: Race[]) {
  mockRaces = races;
  const ui = await render(<StatsScreen />);
  await act(async () => {});
  return ui;
}

describe('Stats hero metric', () => {
  it('shows "Best age-group finish" with the best Top X% whenever valid age-group rankings exist', async () => {
    const ui = await open([race('1'), race('2', { ageGroupRank: { place: 10, field: 100 } }), race('3', { ageGroupRank: { place: 5, field: 50 } })]);
    const hero = ui.getByText('Best age-group finish').parent!;
    expect(within(hero).getByText('Top 10%')).toBeTruthy(); // the card's own hero figure (the same text also appears on highlights)
    expect(ui.queryByText('Races logged')).toBeNull();
    expect(ui.getByText('Races')).toBeTruthy(); // the supporting figure
    await act(async () => ui.unmount());
  });

  it('falls back to "Races logged" with the race count when no race has a complete age-group ranking', async () => {
    const ui = await open([race('1'), race('2', { ageGroupRank: { place: 10 } }), race('3', { overallRank: { place: 3, field: 40 } })]);
    const hero = ui.getByText('Races logged').parent!;
    expect(within(hero).getAllByText('3')[0]).toBeTruthy(); // the hero value renders first, before the supporting figures
    expect(ui.queryByText('Best age-group finish')).toBeNull();
    expect(ui.queryByText(/^Top \d+%$/)).toBeNull();
    await act(async () => ui.unmount());
  });

  it('does not count a ranking flagged as needing confirmation', async () => {
    const ui = await open([race('1', { ageGroupRank: { place: 1, field: 100 }, rankingNeedsConfirmation: true })]);
    expect(ui.getByText('Races logged')).toBeTruthy();
    expect(ui.queryByText('Best age-group finish')).toBeNull();
    await act(async () => ui.unmount());
  });
});
