import { useCallback, useEffect, useState, type RefObject } from 'react';
import { AppState, InteractionManager } from 'react-native';

/**
 * Focuses a text input reliably after a navigation, instead of firing one timer and hoping. iOS ignores a programmatic focus when the app is not
 * yet active (a notification tap launches or resumes the app while it is still inactive) and while the screen transition is running, so a single
 * delayed `focus()` can silently do nothing. This waits for: the screen to be focused, running interactions (the transition) to finish, and the
 * app to be ACTIVE; then it tries, checks `isFocused()`, and retries a few times (and again whenever the app becomes active) until the input really
 * holds focus or the attempts run out. `status` reports what happened, from the input itself, so a device test does not rely on the timer.
 */
export interface FocusStatus {
  attempts: number;
  /** null while still trying or not requested; true once the input reported focus; false if it never did. */
  focused: boolean | null;
}

export interface FocusableInput {
  focus(): void;
  isFocused(): boolean;
}

const RETRY_DELAYS_MS = [300, 700, 1300, 2200];
const VERIFY_DELAY_MS = 150;

export function useInputFocusRequest(inputRef: RefObject<FocusableInput | null>, screenFocused: boolean) {
  const [request, setRequest] = useState(0);
  const [status, setStatus] = useState<FocusStatus>({ attempts: 0, focused: null });
  const requestFocus = useCallback(() => setRequest((count) => count + 1), []);

  useEffect(() => {
    if (request === 0 || !screenFocused) return;
    let cancelled = false;
    let attempts = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const isFocused = () => inputRef.current?.isFocused() === true;

    const attempt = () => {
      if (cancelled) return;
      if (isFocused()) {
        setStatus({ attempts, focused: true });
        return;
      }
      if (AppState.currentState !== 'active') return; // iOS would ignore it; wait for activation (see the listener below)
      attempts += 1;
      inputRef.current?.focus();
      setStatus({ attempts, focused: null });
      timers.push(
        setTimeout(() => {
          if (!cancelled) setStatus({ attempts, focused: isFocused() });
        }, VERIFY_DELAY_MS),
      );
    };

    const interaction = InteractionManager.runAfterInteractions(() => {
      attempt();
      for (const delay of RETRY_DELAYS_MS) timers.push(setTimeout(attempt, delay));
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        attempt();
        timers.push(setTimeout(attempt, 400));
      }
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
      timers.forEach(clearTimeout);
      subscription.remove();
    };
  }, [request, screenFocused, inputRef]);

  return { requestFocus, status };
}
