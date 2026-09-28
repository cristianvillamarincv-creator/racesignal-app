import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '@/lib/auth';

/**
 * B.12 — the secondary email/password sign-in path (`signInWithPassword` in auth.tsx), covering
 * exactly the two automated cases this doesn't need a physical device to prove: a wrong password
 * returns a clean error and never touches `session`, and a correct password establishes a session
 * through the SAME onAuthStateChange listener every other sign-in method already uses (no separate
 * code path). Sign-in on a real device, sign-out, and session restoration after an app relaunch
 * still need the physical-device pass — those aren't things a mocked supabase-js client can prove.
 */

let mockAuthStateChangeCallback: ((event: string, session: unknown) => void) | null = null;
const mockSignInWithPassword = jest.fn();

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mockAuthStateChangeCallback = cb;
        // Matches the real supabase-js contract this file's own comment relies on: INITIAL_SESSION
        // fires once, synchronously-ish, right after subscribing.
        queueMicrotask(() => cb('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
    },
  },
}));

function Probe() {
  const { isReady, session, signInWithPassword } = useAuth();
  const [lastError, setLastError] = useState<string | null>('unset');
  const [lastUserId, setLastUserId] = useState<string | null>('unset');
  return (
    <>
      <Text testID="ready">{String(isReady)}</Text>
      <Text testID="session">{session ? session.user.id : 'none'}</Text>
      <Text testID="error">{lastError ?? 'null'}</Text>
      <Text testID="returned-userId">{lastUserId ?? 'null'}</Text>
      <Text
        testID="trigger-wrong"
        onPress={async () => {
          const { error, userId } = await signInWithPassword('reviewer@racesignal.test', 'wrong-password');
          setLastError(error);
          setLastUserId(userId);
        }}
      />
      <Text
        testID="trigger-right"
        onPress={async () => {
          const { error, userId } = await signInWithPassword('reviewer@racesignal.test', 'correct-password');
          setLastError(error);
          setLastUserId(userId);
        }}
      />
    </>
  );
}

beforeEach(() => {
  mockAuthStateChangeCallback = null;
  mockSignInWithPassword.mockReset();
});

describe('signInWithPassword — invalid credentials', () => {
  it('returns a clean error message and never establishes a session', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null, user: null }, // matches the real supabase-js shape: data.user, not data.session.user
      error: { name: 'AuthApiError', message: 'Invalid login credentials' },
    });

    const ui = await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('ready').props.children).toBe('true'));

    await act(async () => {
      ui.getByTestId('trigger-wrong').props.onPress();
    });
    await waitFor(() => expect(mockSignInWithPassword).toHaveBeenCalledTimes(1));
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'reviewer@racesignal.test', password: 'wrong-password' });
    expect(ui.getByTestId('session').props.children).toBe('none');
    await waitFor(() => expect(ui.getByTestId('error').props.children).toBe('Invalid login credentials'));
    expect(ui.getByTestId('returned-userId').props.children).toBe('null');

    await act(async () => {
      ui.unmount();
    });
  });
});

describe('signInWithPassword — valid credentials', () => {
  it('establishes a session through the same onAuthStateChange listener every sign-in method uses', async () => {
    mockSignInWithPassword.mockImplementation(async () => {
      // supabase-js itself fires onAuthStateChange('SIGNED_IN', ...) as a side effect of a
      // successful signInWithPassword call — this mock reproduces exactly that. `data.user` is a
      // top-level sibling of `data.session` in the real API (not nested under session) — auth.tsx's
      // signInWithPassword reads `data.user?.id` directly, so this must match that real shape.
      mockAuthStateChangeCallback?.('SIGNED_IN', { user: { id: 'reviewer-athlete-id' } });
      return { data: { session: { user: { id: 'reviewer-athlete-id' } }, user: { id: 'reviewer-athlete-id' } }, error: null };
    });

    const ui = await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(ui.getByTestId('ready').props.children).toBe('true'));
    expect(ui.getByTestId('session').props.children).toBe('none');

    await act(async () => {
      ui.getByTestId('trigger-right').props.onPress();
    });

    await waitFor(() => expect(ui.getByTestId('session').props.children).toBe('reviewer-athlete-id'));
    await waitFor(() => expect(ui.getByTestId('returned-userId').props.children).toBe('reviewer-athlete-id'));

    await act(async () => {
      ui.unmount();
    });
  });
});
