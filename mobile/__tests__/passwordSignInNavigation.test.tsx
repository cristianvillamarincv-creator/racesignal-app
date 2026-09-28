import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AppPhaseProvider, useAppPhase } from '@/lib/appPhase';
import { AuthProvider } from '@/lib/auth';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

/**
 * B.14 — the integration test explicitly required beyond an Auth API test or an EmailFormStep
 * callback test: this renders the REAL AppPhaseProvider, the REAL AuthProvider, and the REAL
 * OnboardingFlow together (only the true I/O boundaries — the Supabase client, AsyncStorage, and
 * expo-linking — are mocked), and drives the full chain a finger would:
 *
 *   tap "Already have an account? Sign in" -> "Sign in with email and password" -> type
 *   credentials -> tap Sign in -> (mocked) Supabase establishes a session -> OnboardingFlow's
 *   resumeReturningUser checks onboarding status -> AppPhaseProvider's exposed `phase` flips to
 *   'app' -- with NO app relaunch, which is exactly the confirmed B.13 device bug this proves fixed.
 *
 * A regression here would mean this test fails with `phase` stuck at 'onboarding' after a
 * successful sign-in for an already-onboarded account — the exact symptom reported.
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockAuthStateChangeCallback: ((event: string, session: unknown) => void) | null = null;
const mockSignInWithPassword = jest.fn();
jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mockAuthStateChangeCallback = cb;
        queueMicrotask(() => cb('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
    },
  },
  isSupabaseConfigured: true,
}));

const mockFetchOnboardingCompletedAt = jest.fn();
jest.mock('@/lib/db/races', () => ({
  fetchOnboardingCompletedAt: (...args: unknown[]) => mockFetchOnboardingCompletedAt(...args),
  fetchImportedProviderResultIds: jest.fn().mockResolvedValue(new Set()),
  insertConfirmedRaces: jest.fn().mockResolvedValue([]),
  markOnboardingComplete: jest.fn().mockResolvedValue(undefined),
  upsertAthleteProfile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/racesContext', () => ({
  useAthleteRaces: () => ({ applyImportedRaces: jest.fn() }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

jest.mock('@/lib/devPreview', () => ({
  isDevPreviewAvailable: () => false,
  useDevPreview: () => ({ mode: 'off', enterBrowse: jest.fn(), enterOnboardingReplay: jest.fn(), exit: jest.fn() }),
}));

/** Mirrors _layout.tsx's real RootNavigator wiring exactly: OnboardingFlow's onComplete prop IS
 *  AppPhaseProvider's markOnboardingComplete, and `phase` is what RootNavigator branches on to
 *  decide whether to render OnboardingFlow or the real tab stack. */
function Harness() {
  const { phase, markOnboardingComplete } = useAppPhase();
  return (
    <>
      <Text testID="phase-probe">{phase}</Text>
      <OnboardingFlow onComplete={markOnboardingComplete} />
    </>
  );
}

beforeEach(() => {
  mockAuthStateChangeCallback = null;
  mockSignInWithPassword.mockReset();
  mockFetchOnboardingCompletedAt.mockReset();
});

describe('B.14 integration: password sign-in -> auth session -> onboarding status -> phase transition', () => {
  it('flips AppPhaseProvider to "app" immediately after a returning, already-onboarded account signs in with a password — no relaunch needed', async () => {
    mockFetchOnboardingCompletedAt.mockResolvedValue('2026-01-01T00:00:00.000Z'); // already onboarded
    mockSignInWithPassword.mockImplementation(async () => {
      mockAuthStateChangeCallback?.('SIGNED_IN', { user: { id: 'returning-athlete-id' } });
      return { data: { user: { id: 'returning-athlete-id' }, session: { user: { id: 'returning-athlete-id' } } }, error: null };
    });

    const ui = await render(
      <AuthProvider>
        <AppPhaseProvider>
          <Harness />
        </AppPhaseProvider>
      </AuthProvider>,
    );

    // AppPhaseProvider's own one-time classification (no session yet) resolves to 'onboarding'.
    await waitFor(() => expect(ui.getByLabelText('Already have an account? Sign in')).toBeTruthy());
    expect(ui.getByTestId('phase-probe').props.children).toBe('onboarding');

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Already have an account? Sign in'));
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Email'), 'reviewer@racesignal.test');
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), 'correct-password');
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    // The actual bug this reproduces: without the B.14 fix, `phase` stays 'onboarding' forever here
    // (AppPhaseProvider's classification effect never re-runs, and nothing else drove the
    // transition) — only a full app relaunch would have fixed it. This must flip on its own.
    await waitFor(() => expect(ui.getByTestId('phase-probe').props.children).toBe('app'), { timeout: 3000 });
    expect(mockFetchOnboardingCompletedAt).toHaveBeenCalledWith('returning-athlete-id');

    await act(async () => {
      ui.unmount();
    });
  });

  it('falls back to the identity step (never stuck) if the signed-in account has not actually completed onboarding', async () => {
    mockFetchOnboardingCompletedAt.mockResolvedValue(null); // never onboarded
    mockSignInWithPassword.mockImplementation(async () => {
      mockAuthStateChangeCallback?.('SIGNED_IN', { user: { id: 'never-onboarded-id' } });
      return { data: { user: { id: 'never-onboarded-id' }, session: { user: { id: 'never-onboarded-id' } } }, error: null };
    });

    const ui = await render(
      <AuthProvider>
        <AppPhaseProvider>
          <Harness />
        </AppPhaseProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(ui.getByLabelText('Already have an account? Sign in')).toBeTruthy());

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Already have an account? Sign in'));
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Email'), 'nobody@racesignal.test');
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), 'some-password');
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    // Stays in 'onboarding' phase (correct — this account genuinely never finished) but lands back
    // on a usable screen (the identity step), never a stuck spinner.
    await waitFor(() => expect(ui.getByText('What name do you race under?')).toBeTruthy());
    expect(ui.getByTestId('phase-probe').props.children).toBe('onboarding');

    await act(async () => {
      ui.unmount();
    });
  });
});
