import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { FindMyRacesFlow } from '@/components/FindMyRacesFlow';

/**
 * Real component-behavior tests, deliberately separate from raceImportBatch.test.ts's pure-function
 * coverage: a request explicitly called out that testing only describeImportOutcome/
 * fetchCandidateDetails in isolation is insufficient proof that a database-save failure is
 * actually recoverable through this screen's real Retry button, or that a session-expiry
 * mid-import actually hands the *correct*, non-duplicated pending set to the recovery draft. These
 * render the real component and drive it through real state transitions via user-facing labels.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'athlete-1' } }, signOut: mockSignOut }),
}));
jest.mock('@/lib/appPhase', () => ({
  useAppPhase: () => ({ resetToOnboarding: mockResetToOnboarding }),
}));
jest.mock('@/lib/racesContext', () => ({
  useAthleteRaces: () => ({ racingName: 'Jane Doe', applyImportedRaces: mockApplyImportedRaces }),
}));
jest.mock('@/lib/findRacesRetryDraft', () => ({
  loadFindRacesRetryDraft: () => mockLoadFindRacesRetryDraft(),
  saveFindRacesRetryDraft: (...args: unknown[]) => mockSaveFindRacesRetryDraft(...args),
  clearFindRacesRetryDraft: (...args: unknown[]) => mockClearFindRacesRetryDraft(...args),
}));
jest.mock('@/lib/raceDiscovery', () => {
  const actual = jest.requireActual('@/lib/raceDiscovery');
  return {
    ...actual,
    searchAthletes: (...args: unknown[]) => mockSearchAthletes(...args),
    fetchCandidateHistory: (...args: unknown[]) => mockFetchCandidateHistory(...args),
    fetchRaceDetail: (...args: unknown[]) => mockFetchRaceDetail(...args),
  };
});
jest.mock('@/lib/db/races', () => ({
  insertConfirmedRaces: (...args: unknown[]) => mockInsertConfirmedRaces(...args),
  fetchImportedProviderResultIds: () => Promise.resolve(new Set<string>()),
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockResetToOnboarding = jest.fn();
const mockApplyImportedRaces = jest.fn();
const mockSaveFindRacesRetryDraft = jest.fn().mockResolvedValue(undefined);
const mockLoadFindRacesRetryDraft = jest.fn().mockResolvedValue(null);
const mockClearFindRacesRetryDraft = jest.fn().mockResolvedValue(undefined);
const mockSearchAthletes = jest.fn();
const mockFetchCandidateHistory = jest.fn();
const mockFetchRaceDetail = jest.fn();
const mockInsertConfirmedRaces = jest.fn();

const IDENTITY = { providerAthleteId: 'p1', displayName: 'Jane Doe' };
const CANDIDATE_A = {
  provider: 'sportstats' as const,
  providerResultId: 'r1',
  providerAthleteResultId: 'r1-a',
  sourceUrl: 'https://example.test/r1',
  eventName: 'Race A',
  category: 'Overall Results',
  eventDate: '2024-05-01',
  eventYear: 2024,
};
const CANDIDATE_B = {
  ...CANDIDATE_A,
  providerResultId: 'r2',
  providerAthleteResultId: 'r2-a',
  sourceUrl: 'https://example.test/r2',
  eventName: 'Race B',
};

function detailFor(providerResultId: string) {
  return { available: true as const, data: { finishSeconds: 3600, splits: [] } };
}

async function searchAndReachCandidates(candidates: typeof CANDIDATE_A[]) {
  mockSearchAthletes.mockResolvedValue({ available: true, data: [IDENTITY] });
  mockFetchCandidateHistory.mockResolvedValue({ available: true, data: candidates });

  const ui = await render(<FindMyRacesFlow onDone={jest.fn()} />);

  await act(async () => {
    fireEvent.changeText(ui.getByLabelText('Racing name to search'), 'Jane Doe');
  });
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Search'));
  });

  await waitFor(() => ui.getByLabelText(`Add 0 races`));

  for (const c of candidates) {
    await act(async () => {
      fireEvent.press(ui.getByLabelText(`${c.eventName}, ${c.eventYear}`));
    });
  }

  return ui;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertConfirmedRaces.mockReset();
});

describe('FindMyRacesFlow — database-save failure recovery', () => {
  it('lets a failed save be retried through the real Retry button, without re-fetching or duplicating', async () => {
    const ui = await searchAndReachCandidates([CANDIDATE_A, CANDIDATE_B]);

    mockFetchRaceDetail.mockImplementation(async (providerResultId: string) => detailFor(providerResultId));
    mockInsertConfirmedRaces.mockRejectedValueOnce(new Error('network drop'));

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Add 2 races'));
    });

    await waitFor(() => ui.getByLabelText('Retry'));
    expect(ui.getByText(/couldn.t save/i)).toBeTruthy();
    expect(mockFetchRaceDetail).toHaveBeenCalledTimes(2);
    expect(mockInsertConfirmedRaces).toHaveBeenCalledTimes(1);

    mockInsertConfirmedRaces.mockResolvedValueOnce([
      { id: 'row-1', providerResultId: 'r1' },
      { id: 'row-2', providerResultId: 'r2' },
    ] as never);

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Retry'));
    });

    await waitFor(() => ui.getByText('Added to your history.'));
    // The retry must re-attempt the SAME already-fetched rows, not re-fetch detail again — proves
    // a database-save failure is recoverable without wasting a network round-trip or risking a
    // duplicate detail fetch.
    expect(mockFetchRaceDetail).toHaveBeenCalledTimes(2);
    expect(mockInsertConfirmedRaces).toHaveBeenCalledTimes(2);
    expect(mockInsertConfirmedRaces).toHaveBeenLastCalledWith([
      expect.objectContaining({ provider_result_id: 'r1' }),
      expect.objectContaining({ provider_result_id: 'r2' }),
    ]);
    expect(mockApplyImportedRaces).toHaveBeenCalledTimes(1);
    expect(ui.queryByLabelText('Retry')).toBeNull();
  });
});

describe('FindMyRacesFlow — session-expiry recovery', () => {
  it('signs out, and persists only the still-pending candidate for later resumption — never the one already saved', async () => {
    const ui = await searchAndReachCandidates([CANDIDATE_A, CANDIDATE_B]);

    // r1 fetches and saves successfully; r2's detail fetch then hits unauthorized, stopping the
    // batch — r2 is the only thing that should ever be persisted for retry.
    mockFetchRaceDetail.mockImplementation(async (providerResultId: string) =>
      providerResultId === 'r1' ? detailFor(providerResultId) : { available: false, reason: 'unauthorized' },
    );
    mockInsertConfirmedRaces.mockResolvedValue([{ id: 'row-1', providerResultId: 'r1' }] as never);

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Add 2 races'));
    });

    await waitFor(() => ui.getByLabelText('Sign in again'));
    // r1 already saved — importedCount reflects it even though the batch then stopped.
    expect(ui.getByText('1')).toBeTruthy();

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in again'));
    });

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockResetToOnboarding).toHaveBeenCalledTimes(1);
    expect(mockSaveFindRacesRetryDraft).toHaveBeenCalledTimes(1);
    const draft = mockSaveFindRacesRetryDraft.mock.calls[0][0];
    // Exactly the unattempted candidate (r2) — r1, already saved, must never reappear here.
    expect(draft.candidates.map((c: { providerResultId: string }) => c.providerResultId)).toEqual(['r2']);
    expect(draft.rowsAlreadyFetched).toEqual([]);
    // Bound to the account that was actually signed in when the draft was written — see the
    // cross-account test below for why this matters.
    expect(draft.athleteId).toBe('athlete-1');
  });
});

describe('FindMyRacesFlow — cross-account draft safety', () => {
  it('never resumes a pending-retry draft that belongs to a different account than the one now signed in', async () => {
    // Simulates a stale draft left on a shared/reused device by a DIFFERENT account (or the same
    // account before a delete-and-recreate, which mints a new auth user id) — this session is
    // signed in as 'athlete-1' (see the top-of-file useAuth mock), but the on-disk draft belongs
    // to 'athlete-OTHER'.
    mockLoadFindRacesRetryDraft.mockResolvedValueOnce({
      athleteId: 'athlete-OTHER',
      searchName: 'Someone Else',
      candidates: [CANDIDATE_A],
      rowsAlreadyFetched: [],
    });

    await act(async () => {
      render(<FindMyRacesFlow onDone={jest.fn()} />);
    });

    await waitFor(() => expect(mockLoadFindRacesRetryDraft).toHaveBeenCalled());
    // The foreign draft must be discarded, never silently imported into this account.
    await waitFor(() => expect(mockClearFindRacesRetryDraft).toHaveBeenCalled());
    expect(mockFetchRaceDetail).not.toHaveBeenCalled();
    expect(mockInsertConfirmedRaces).not.toHaveBeenCalled();
  });
});
