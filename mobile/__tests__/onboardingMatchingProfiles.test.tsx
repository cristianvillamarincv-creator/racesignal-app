import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { AppPhaseProvider } from '@/lib/appPhase';
import { AuthProvider } from '@/lib/auth';

/**
 * The matching-profile screen (several athletes share the searched name): a short heading and one line of guidance, the profile
 * rows, and nothing else to fill in. Choosing a profile only loads that profile's history; nothing is merged.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        queueMicrotask(() => cb('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
  isSupabaseConfigured: true,
}));
jest.mock('@/lib/db/races', () => ({
  fetchOnboardingCompletedAt: jest.fn(),
  fetchImportedProviderResultIds: jest.fn().mockResolvedValue(new Set()),
  insertConfirmedRaces: jest.fn().mockResolvedValue([]),
  markOnboardingComplete: jest.fn(),
  upsertAthleteProfile: jest.fn(),
}));
const mockSearchAthletes = jest.fn();
const mockFetchHistory = jest.fn();
jest.mock('@/lib/raceDiscovery', () => ({
  searchAthletes: (...a: unknown[]) => mockSearchAthletes(...a),
  fetchCandidateHistory: (...a: unknown[]) => mockFetchHistory(...a),
  fetchRaceDetail: jest.fn(),
}));
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ applyImportedRaces: jest.fn() }) }));
jest.mock('expo-linking', () => ({ getInitialURL: jest.fn().mockResolvedValue(null), addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }) }));
jest.mock('@/lib/devPreview', () => ({
  isDevPreviewAvailable: () => false,
  useDevPreview: () => ({ mode: 'off', enterBrowse: jest.fn(), enterOnboardingReplay: jest.fn(), exit: jest.fn() }),
}));
jest.mock('@/lib/socialAuthConfig', () => ({ getSocialAuthConfig: () => ({ apple: false, google: false }) }));
jest.mock('@/lib/socialAuth', () => ({ signInWithProvider: jest.fn(), linkProvider: jest.fn(), getConnectedProviders: jest.fn(), requestAppleRevocationCode: jest.fn() }));

const IDENTITIES = [
  { providerAthleteId: 'p1', displayName: 'Cristian Andres Villamarin Garcia' },
  { providerAthleteId: 'p2', displayName: 'Cristian Villamarin' },
  { providerAthleteId: 'p3', displayName: 'Cristian Villamarin G' },
  { providerAthleteId: 'p4', displayName: 'Cristian Alberto Santander Villamarin' },
];

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSearchAthletes.mockReset().mockResolvedValue({ available: true, data: IDENTITIES });
  mockFetchHistory.mockReset().mockResolvedValue({ available: true, data: [] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

async function openMatchingProfiles() {
  const ui = await render(
    <AuthProvider>
      <AppPhaseProvider>
        <OnboardingFlow onComplete={jest.fn()} />
      </AppPhaseProvider>
    </AuthProvider>,
  );
  await waitFor(() => expect(ui.getByLabelText('What name do you race under?')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(ui.getByLabelText('What name do you race under?'), 'Cristian Villamarin');
  });
  await act(async () => {
    fireEvent.press(ui.getByLabelText('Search'));
  });
  await waitFor(() => expect(ui.getByText('We found several matching profiles.')).toBeTruthy());
  return ui;
}

describe('matching-profile screen', () => {
  it('shows the short heading and guidance, every profile as a row, and no optional hint inputs', async () => {
    const ui = await openMatchingProfiles();
    expect(ui.getByText('Choose a profile to review its race history.')).toBeTruthy();
    expect(ui.queryByText(/more than one athlete/)).toBeNull();
    for (const identity of IDENTITIES) expect(ui.getByLabelText(`This is me: ${identity.displayName}`)).toBeTruthy();
    // The race and birth-year hints never filtered or annotated the matches, so they are gone.
    expect(ui.queryByLabelText('A race you remember (optional)')).toBeNull();
    expect(ui.queryByLabelText('Birth year (optional)')).toBeNull();
    expect(ui.queryByText(/A race you remember/)).toBeNull();
    expect(ui.queryByText(/birth year/i)).toBeNull();
    await act(async () => ui.unmount());
  });

  it('choosing a profile loads only that profile\'s history (nothing is merged), and Back returns to the name search', async () => {
    const ui = await openMatchingProfiles();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('This is me: Cristian Villamarin'));
    });
    expect(mockFetchHistory).toHaveBeenCalledTimes(1);
    expect(mockFetchHistory).toHaveBeenCalledWith('p2');
    await act(async () => ui.unmount());

    const again = await openMatchingProfiles();
    await act(async () => {
      fireEvent.press(again.getByLabelText('Back'));
    });
    await waitFor(() => expect(again.getByLabelText('What name do you race under?')).toBeTruthy());
    await act(async () => again.unmount());
  });
});
