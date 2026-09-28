import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { EmailFormStep } from '@/components/onboarding/OnboardingFlow';

// OnboardingFlow.tsx (which EmailFormStep is exported from) transitively imports the real
// supabaseClient — mocked here purely so importing the module under test doesn't try to load the
// native AsyncStorage module in Jest. Nothing in these tests exercises Supabase directly; every
// side effect goes through the injected props (onSendLink/onSignInWithPassword/onBack). jest.mock
// calls are hoisted above imports by babel-jest regardless of source position, so this still takes
// effect before OnboardingFlow.tsx is evaluated.
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

/**
 * B.13 — real rendered-component tests for the password sign-in path reported broken on a
 * physical device ("tapping Sign in appeared to do nothing"). These render the actual component
 * (not a mock of it) and drive it exactly like a finger would: typing into the real TextInput,
 * pressing the real Pressable, and asserting on what actually reaches the screen and the
 * `onSignInWithPassword` prop — not just on internal state. This is what traces
 * input -> component state -> button handler -> the prop signal.tsx/OnboardingFlow ultimately wires
 * to `signInWithPassword` (see auth.tsx and authPasswordSignIn.test.tsx for the layer below this:
 * that a successful call establishes a session and a wrong password returns a clean error).
 */

async function renderStep(overrides: Partial<React.ComponentProps<typeof EmailFormStep>> = {}) {
  const onChangeEmail = jest.fn();
  const onSendLink = jest.fn();
  const onSignInWithPassword = jest.fn().mockResolvedValue({ error: null });
  const onBack = jest.fn();
  const props: React.ComponentProps<typeof EmailFormStep> = {
    email: overrides.email ?? '',
    onChangeEmail: overrides.onChangeEmail ?? onChangeEmail,
    error: overrides.error ?? null,
    selectedCount: overrides.selectedCount ?? 0,
    isSending: overrides.isSending ?? false,
    onSendLink: overrides.onSendLink ?? onSendLink,
    onSignInWithPassword: overrides.onSignInWithPassword ?? onSignInWithPassword,
    onBack: overrides.onBack ?? onBack,
  };
  const ui = await render(<EmailFormStep {...props} />);
  return { ui, onChangeEmail, onSendLink, onSignInWithPassword, onBack };
}

/** A thin wrapper managing `email` as real React state, so typing into the Email field in
 *  password mode is visible in the rendered value — EmailFormStep itself is controlled (`email`
 *  is a prop, not its own state), matching how OnboardingFlow actually owns it. */
function ControlledHarness({
  onSignInWithPassword,
  initialEmail = '',
}: {
  onSignInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  initialEmail?: string;
}) {
  const [email, setEmail] = React.useState(initialEmail);
  return (
    <EmailFormStep
      email={email}
      onChangeEmail={setEmail}
      error={null}
      selectedCount={0}
      isSending={false}
      onSendLink={() => {}}
      onSignInWithPassword={onSignInWithPassword}
      onBack={() => {}}
    />
  );
}

describe('EmailFormStep — default (magic link) mode', () => {
  it('shows only the magic-link CTA, and the secondary link to switch modes', async () => {
    const { ui } = await renderStep();
    expect(ui.getByLabelText('Send sign-in link')).toBeTruthy();
    expect(ui.getByLabelText('Sign in with email and password')).toBeTruthy();
    expect(ui.queryByLabelText('Password')).toBeNull();
    expect(ui.queryByLabelText('Sign in')).toBeNull();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — mode switching', () => {
  it('switching to password mode hides the magic-link CTA and shows exactly one primary button', async () => {
    const { ui } = await renderStep({ email: 'reviewer@example.com' });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });

    expect(ui.queryByLabelText('Send sign-in link')).toBeNull();
    expect(ui.getByLabelText('Sign in')).toBeTruthy();
    expect(ui.getByLabelText('Email').props.value).toBe('reviewer@example.com'); // preserved across the switch
    expect(ui.getByLabelText('Password')).toBeTruthy();
    await act(async () => {
      ui.unmount();
    });
  });

  it('"Use a sign-in link instead" switches back to magic-link mode, preserving email', async () => {
    const { ui } = await renderStep({ email: 'reviewer@example.com' });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Use a sign-in link instead'));
    });

    expect(ui.getByLabelText('Send sign-in link')).toBeTruthy();
    expect(ui.queryByLabelText('Sign in')).toBeNull();
    expect(ui.getByLabelText('Email').props.value).toBe('reviewer@example.com');
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — password field wiring', () => {
  it('the Password field is a real secureTextEntry TextInput, and typing reaches component state', async () => {
    const { ui } = await renderStep({ email: 'reviewer@example.com' });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });

    const passwordField = ui.getByLabelText('Password');
    expect(passwordField.props.secureTextEntry).toBe(true);

    await act(async () => {
      fireEvent.changeText(passwordField, 'correct-horse-battery-staple');
    });
    expect(ui.getByLabelText('Password').props.value).toBe('correct-horse-battery-staple');
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — empty-field validation', () => {
  it('pressing Sign in with an empty password shows a visible message and never calls onSignInWithPassword', async () => {
    const { ui, onSignInWithPassword } = await renderStep({ email: 'reviewer@example.com' });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    expect(ui.getByText('Enter your email and password to continue.')).toBeTruthy();
    expect(onSignInWithPassword).not.toHaveBeenCalled();
    await act(async () => {
      ui.unmount();
    });
  });

  it('pressing Sign in with no email typed shows the same message and never calls onSignInWithPassword', async () => {
    const { ui, onSignInWithPassword } = await renderStep({ email: '' });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), 'some-password');
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    expect(ui.getByText('Enter your email and password to continue.')).toBeTruthy();
    expect(onSignInWithPassword).not.toHaveBeenCalled();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — invalid credentials', () => {
  it('a rejected sign-in shows the server error message visibly and stops the loading state', async () => {
    const onSignInWithPassword = jest.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    const { ui } = await renderStep({ email: 'reviewer@example.com', onSignInWithPassword });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), 'wrong-password');
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    await waitFor(() => expect(ui.getByText('Invalid login credentials')).toBeTruthy());
    expect(onSignInWithPassword).toHaveBeenCalledWith('reviewer@example.com', 'wrong-password');
    // Not stuck showing a loading state after the failure.
    expect(ui.getByLabelText('Sign in')).toBeTruthy();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — successful sign-in', () => {
  it('calls onSignInWithPassword with the trimmed email and exact password typed', async () => {
    const onSignInWithPassword = jest.fn().mockResolvedValue({ error: null });
    const ui = await render(<ControlledHarness onSignInWithPassword={onSignInWithPassword} initialEmail="  reviewer@example.com  " />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), 'correct-password');
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });

    await waitFor(() => expect(onSignInWithPassword).toHaveBeenCalledTimes(1));
    expect(onSignInWithPassword).toHaveBeenCalledWith('reviewer@example.com', 'correct-password');
    // Navigation itself happens outside this component (a successful sign-in updates the auth
    // session, which AppPhaseProvider reacts to — see authPasswordSignIn.test.tsx for that layer);
    // this component's job ends at calling the prop with the right values and not showing an error.
    expect(ui.queryByText('Enter your email and password to continue.')).toBeNull();
    await act(async () => {
      ui.unmount();
    });
  });
});

describe('EmailFormStep — passwords never appear in logs', () => {
  it('no console.log/warn/error call ever includes the raw password string', async () => {
    const SECRET_PASSWORD = 'super-secret-do-not-log-me';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const onSignInWithPassword = jest.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    const { ui } = await renderStep({ email: 'reviewer@example.com', onSignInWithPassword });
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in with email and password'));
    });
    await act(async () => {
      fireEvent.changeText(ui.getByLabelText('Password'), SECRET_PASSWORD);
    });

    await act(async () => {
      fireEvent.press(ui.getByLabelText('Sign in'));
    });
    await waitFor(() => expect(onSignInWithPassword).toHaveBeenCalledTimes(1));

    const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
    const flattened = allCalls.flat().map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
    expect(flattened.some((text) => text.includes(SECRET_PASSWORD))).toBe(false);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    await act(async () => {
      ui.unmount();
    });
  });
});
