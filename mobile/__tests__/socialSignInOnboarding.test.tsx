/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require lazily (babel hoists them above imports) */
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { AppPhaseProvider, useAppPhase } from '@/lib/appPhase';
import { AuthProvider } from '@/lib/auth';
import { loadOnboardingDraft, saveOnboardingDraft } from '@/lib/onboardingDraft';

/**
 * Apple / Google sign-in through the REAL AuthProvider + AppPhaseProvider + OnboardingFlow, like
 * passwordSignInNavigation.test.tsx does for passwords. Only true I/O boundaries are mocked: Supabase,
 * AsyncStorage, expo-linking, the race tables, race discovery, and the provider layer itself (which is
 * unit-tested in socialAuth.test.ts). What this proves is where an athlete LANDS and what happens to
 * their pending race selections.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        queueMicrotask(() => cb('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      signInWithPassword: jest.fn(),
    },
  },
  isSupabaseConfigured: true,
}));

const mockFetchOnboardingCompletedAt = jest.fn();
const mockFetchImported = jest.fn();
const mockUpsertAthleteProfile = jest.fn().mockResolvedValue(undefined);
const mockMarkOnboardingComplete = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/db/races', () => ({
  fetchOnboardingCompletedAt: (...a: unknown[]) => mockFetchOnboardingCompletedAt(...a),
  fetchImportedProviderResultIds: (...a: unknown[]) => mockFetchImported(...a),
  insertConfirmedRaces: jest.fn().mockResolvedValue([]),
  markOnboardingComplete: (...a: unknown[]) => mockMarkOnboardingComplete(...a),
  upsertAthleteProfile: (...a: unknown[]) => mockUpsertAthleteProfile(...a),
}));

const mockFetchRaceDetail = jest.fn().mockResolvedValue({ available: false, reason: 'provider_blocked' });
jest.mock('@/lib/raceDiscovery', () => ({
  fetchRaceDetail: (...a: unknown[]) => mockFetchRaceDetail(...a),
  fetchCandidateHistory: jest.fn(),
  searchAthletes: jest.fn(),
}));

jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ applyImportedRaces: jest.fn() }) }));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));
jest.mock('@/lib/devPreview', () => ({
  isDevPreviewAvailable: () => false,
  useDevPreview: () => ({ mode: 'off', enterBrowse: jest.fn(), enterOnboardingReplay: jest.fn(), exit: jest.fn() }),
}));

// This build offers both providers.
jest.mock('@/lib/socialAuthConfig', () => ({
  getSocialAuthConfig: () => ({ apple: true, google: true, googleWebClientId: 'w', googleIosClientId: 'i' }),
}));

// The provider layer: unit-tested separately, controlled here.
const mockSignInWithProvider = jest.fn();
jest.mock('@/lib/socialAuth', () => ({
  signInWithProvider: (...a: unknown[]) => mockSignInWithProvider(...a),
  linkProvider: jest.fn(),
  getConnectedProviders: jest.fn().mockResolvedValue(null),
  requestAppleRevocationCode: jest.fn(),
}));

// The two native buttons, as pressable stand-ins carrying their provider labels.
jest.mock('expo-apple-authentication', () => {
  const { Pressable, Text: RNText } = require('react-native');
  const R = require('react');
  return {
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 2 },
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      R.createElement(Pressable, { onPress, accessibilityRole: 'button', accessibilityLabel: 'Continue with Apple' }, R.createElement(RNText, null, 'Apple')),
  };
});
jest.mock('@react-native-google-signin/google-signin', () => {
  const { Pressable, Text: RNText } = require('react-native');
  const R = require('react');
  const GoogleSigninButton = ({ onPress }: { onPress: () => void }) =>
    R.createElement(Pressable, { onPress, accessibilityRole: 'button', accessibilityLabel: 'Sign in with Google' }, R.createElement(RNText, null, 'Google'));
  GoogleSigninButton.Size = { Wide: 1 };
  GoogleSigninButton.Color = { Dark: 'dark', Light: 'light' };
  return { GoogleSigninButton, GoogleSignin: {}, statusCodes: {} };
});

function Harness() {
  const { phase, markOnboardingComplete } = useAppPhase();
  return (
    <>
      <Text testID="phase-probe">{phase}</Text>
      <OnboardingFlow onComplete={markOnboardingComplete} />
    </>
  );
}

async function renderApp() {
  return render(
    <AuthProvider>
      <AppPhaseProvider>
        <Harness />
      </AppPhaseProvider>
    </AuthProvider>,
  );
}

async function press(ui: Awaited<ReturnType<typeof renderApp>>, label: string) {
  await act(async () => {
    fireEvent.press(ui.getByLabelText(label));
  });
}

const CANDIDATE = {
  provider: 'sportstats' as const,
  providerResultId: 'r1',
  providerAthleteResultId: 'a1',
  sourceUrl: 'https://example.test/r1',
  eventName: 'Synthetic Sprint',
  category: 'M35-39',
  eventDate: '2024-05-05',
  eventYear: 2024,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSignInWithProvider.mockReset();
  mockFetchOnboardingCompletedAt.mockReset();
  mockFetchImported.mockReset().mockResolvedValue(new Set());
  mockUpsertAthleteProfile.mockClear();
  mockMarkOnboardingComplete.mockClear();
  mockFetchRaceDetail.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('returning athlete: "Already have an account? Sign in"', () => {
  async function openReturningSignIn() {
    const ui = await renderApp();
    await waitFor(() => expect(ui.getByLabelText('Already have an account? Sign in')).toBeTruthy());
    await press(ui, 'Already have an account? Sign in');
    await waitFor(() => expect(ui.getByLabelText('Continue with Apple')).toBeTruthy());
    return ui;
  }

  it('Apple sign-in for an account that finished onboarding lands on the app (Stats) with no relaunch', async () => {
    mockFetchOnboardingCompletedAt.mockResolvedValue('2026-01-01T00:00:00Z');
    mockSignInWithProvider.mockResolvedValue({ status: 'success', userId: 'existing-user' });
    const ui = await openReturningSignIn();
    await press(ui, 'Continue with Apple');
    await waitFor(() => expect(ui.getByTestId('phase-probe').props.children).toBe('app'));
    expect(mockSignInWithProvider).toHaveBeenCalledWith('apple');
    expect(mockFetchOnboardingCompletedAt).toHaveBeenCalledWith('existing-user');
    expect(mockUpsertAthleteProfile).not.toHaveBeenCalled(); // never overwrites the existing profile
    await act(async () => ui.unmount());
  });

  it('Google sign-in for an account that never finished onboarding continues into onboarding, not an empty app', async () => {
    mockFetchOnboardingCompletedAt.mockResolvedValue(null);
    mockSignInWithProvider.mockResolvedValue({ status: 'success', userId: 'new-user' });
    const ui = await openReturningSignIn();
    await press(ui, 'Sign in with Google');
    await waitFor(() => expect(ui.getByText('What name do you race under?')).toBeTruthy());
    expect(ui.getByTestId('phase-probe').props.children).toBe('onboarding');
    await act(async () => ui.unmount());
  });

  it('cancelling the provider sheet returns quietly: same screen, no error, nothing navigated', async () => {
    mockSignInWithProvider.mockResolvedValue({ status: 'cancelled' });
    const ui = await openReturningSignIn();
    await press(ui, 'Continue with Apple');
    expect(mockSignInWithProvider).toHaveBeenCalledTimes(1);
    expect(ui.getByLabelText('Continue with Apple')).toBeTruthy();
    expect(ui.queryByText(/did not complete|isn’t available|went wrong/i)).toBeNull();
    expect(ui.getByTestId('phase-probe').props.children).toBe('onboarding');
    expect(mockFetchOnboardingCompletedAt).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });

  it('shows a provider failure on the same screen and keeps email sign-in available', async () => {
    mockSignInWithProvider.mockResolvedValue({ status: 'error', message: 'Apple sign-in did not complete. Please try again.' });
    const ui = await openReturningSignIn();
    await press(ui, 'Continue with Apple');
    await waitFor(() => expect(ui.getByText('Apple sign-in did not complete. Please try again.')).toBeTruthy());
    expect(ui.getByLabelText('Send sign-in link')).toBeTruthy();
    expect(ui.getByLabelText('Sign in with email and password')).toBeTruthy();
    await act(async () => ui.unmount());
  });
});

describe('new athlete with pending race selections: save step', () => {
  async function openSaveStepWithPendingDraft() {
    await saveOnboardingDraft({
      racingName: 'Dev Athlete',
      birthYearHint: '',
      candidates: [CANDIDATE],
      selectedResultIds: ['r1'],
    });
    const ui = await renderApp();
    // Draft restore lands on the candidates step with the selection intact.
    await waitFor(() => expect(ui.getByLabelText('Add 1 races')).toBeTruthy());
    await press(ui, 'Add 1 races');
    await waitFor(() => expect(ui.getByLabelText('Continue with Apple')).toBeTruthy());
    return ui;
  }

  it('offers Apple, Google AND email together on the save step', async () => {
    const ui = await openSaveStepWithPendingDraft();
    expect(ui.getByLabelText('Sign in with Google')).toBeTruthy();
    expect(ui.getByLabelText('Continue with email')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('cancelling keeps the athlete on the save step with their selections still saved', async () => {
    mockSignInWithProvider.mockResolvedValue({ status: 'cancelled' });
    const ui = await openSaveStepWithPendingDraft();
    await press(ui, 'Continue with Apple');
    expect(ui.getByLabelText('Continue with Apple')).toBeTruthy();
    const draft = await loadOnboardingDraft();
    expect(draft?.selectedResultIds).toEqual(['r1']);
    expect(draft?.racingName).toBe('Dev Athlete');
    expect(mockUpsertAthleteProfile).not.toHaveBeenCalled();
    await act(async () => ui.unmount());
  });

  it('a brand-new account runs the normal import of the pending selections', async () => {
    mockFetchOnboardingCompletedAt.mockResolvedValue(null);
    mockSignInWithProvider.mockResolvedValue({ status: 'success', userId: 'brand-new-user' });
    const ui = await openSaveStepWithPendingDraft();
    await press(ui, 'Continue with Apple');
    await waitFor(() => expect(mockUpsertAthleteProfile).toHaveBeenCalledWith('brand-new-user', expect.any(String), undefined));
    expect(mockFetchRaceDetail).toHaveBeenCalledWith('r1', 'a1', 'M35-39'); // the saved selection was the one imported
    await act(async () => ui.unmount());
  });

  describe('an existing, already-onboarded account (e.g. linked by verified email) with selections pending', () => {
    async function signInToExistingAccount() {
      mockFetchOnboardingCompletedAt.mockResolvedValue('2026-01-01T00:00:00Z');
      mockSignInWithProvider.mockResolvedValue({ status: 'success', userId: 'existing-user' });
      const ui = await openSaveStepWithPendingDraft();
      await press(ui, 'Sign in with Google');
      await waitFor(() => expect(ui.getByText('Welcome back.')).toBeTruthy());
      return ui;
    }

    it('keeps the selections and asks, instead of silently discarding or importing them', async () => {
      const ui = await signInToExistingAccount();
      expect(ui.getByLabelText('Review selected races')).toBeTruthy();
      expect(ui.getByLabelText('Skip')).toBeTruthy();
      expect(ui.getByTestId('phase-probe').props.children).toBe('onboarding'); // not in the app yet
      const draft = await loadOnboardingDraft();
      expect(draft?.selectedResultIds).toEqual(['r1']); // still saved
      expect(mockUpsertAthleteProfile).not.toHaveBeenCalled();
      expect(mockFetchRaceDetail).not.toHaveBeenCalled();
      await act(async () => ui.unmount());
    });

    it('"Skip" goes to the app, imports nothing, and clears the draft', async () => {
      const ui = await signInToExistingAccount();
      await press(ui, 'Skip');
      await waitFor(() => expect(ui.getByTestId('phase-probe').props.children).toBe('app'));
      expect(mockUpsertAthleteProfile).not.toHaveBeenCalled();
      expect(mockFetchRaceDetail).not.toHaveBeenCalled();
      expect(await loadOnboardingDraft()).toBeNull();
      await act(async () => ui.unmount());
    });

    it('"Review selected races" shows the selections; importing adds only races, leaving the profile and completion time alone', async () => {
      const ui = await signInToExistingAccount();
      await press(ui, 'Review selected races');
      await waitFor(() => expect(ui.getByText('Review your selected races')).toBeTruthy());
      expect(ui.queryByLabelText('Search again')).toBeNull();
      await press(ui, 'Add 1 races');
      await waitFor(() => expect(mockFetchRaceDetail).toHaveBeenCalledWith('r1', 'a1', 'M35-39'));
      expect(mockUpsertAthleteProfile).not.toHaveBeenCalled(); // never overwrites racing name / birth year
      expect(mockMarkOnboardingComplete).not.toHaveBeenCalled(); // never rewrites the completion time
      await act(async () => ui.unmount());
    });

    it('reviewing can be backed out of without importing anything', async () => {
      const ui = await signInToExistingAccount();
      await press(ui, 'Review selected races');
      await waitFor(() => expect(ui.getByText('Review your selected races')).toBeTruthy());
      await press(ui, 'Back');
      await waitFor(() => expect(ui.getByText('Welcome back.')).toBeTruthy());
      expect(mockFetchRaceDetail).not.toHaveBeenCalled();
      await act(async () => ui.unmount());
    });

    it('does not even ask when every selected race is already in the account: straight to the app', async () => {
      mockFetchOnboardingCompletedAt.mockResolvedValue('2026-01-01T00:00:00Z');
      mockFetchImported.mockResolvedValue(new Set(['r1']));
      mockSignInWithProvider.mockResolvedValue({ status: 'success', userId: 'existing-user' });
      const ui = await openSaveStepWithPendingDraft();
      await press(ui, 'Sign in with Google');
      await waitFor(() => expect(ui.getByTestId('phase-probe').props.children).toBe('app'));
      expect(ui.queryByText('Welcome back.')).toBeNull();
      expect(mockUpsertAthleteProfile).not.toHaveBeenCalled();
      await act(async () => ui.unmount());
    });
  });

  it('keeps the email path working from the same screen', async () => {
    const ui = await openSaveStepWithPendingDraft();
    await press(ui, 'Continue with email');
    await waitFor(() => expect(ui.getByLabelText('Send sign-in link')).toBeTruthy());
    expect(ui.getByLabelText('Sign in with email and password')).toBeTruthy();
    await act(async () => ui.unmount());
  });
});
