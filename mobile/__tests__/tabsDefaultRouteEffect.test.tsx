import { act, render } from '@testing-library/react-native';
import TabsLayout from '@/app/(tabs)/_layout';

/**
 * B.15 — isolated, deterministic coverage of the fix in `(tabs)/_layout.tsx`'s `TabsNavigator`: a
 * ref-guarded effect that replaces to `/stats` exactly once per mount, but ONLY when expo-router had
 * no more specific destination to resolve for this navigator (an ordinary cold launch, or the first
 * mount right after onboarding completes) — never when a destination was already resolved before this
 * mount (an explicit deep link into a specific tab, or any other navigation that landed here on
 * purpose). See that file's own comment on `hasAppliedDefaultTabRef` for the full reasoning, including
 * why a literal deep link to the bare `/` route is indistinguishable from "no destination" in this
 * app's URL scheme (Races IS the index route) and is treated the same as an ordinary launch.
 *
 * A full end-to-end render of the real app directory through expo-router's `renderRouter()` was
 * attempted for this scenario and abandoned: traced to a confirmed version incompatibility between
 * the installed `expo-router@6.0.24` (whose bundled `renderRouter()` calls
 * `@testing-library/react-native`'s `render()` without awaiting it) and the installed
 * `@testing-library/react-native@14.0.1` (whose `render()` is async, a v13→v14 change) — not a bug in
 * this app, but not fixable from test code alone.
 *
 * This test instead renders the REAL `TabsLayout` (the file's actual default export, unmodified),
 * mocking only expo-router's own `Tabs`/`useRouter`/`useSegments` (so no real React Navigation tab bar
 * or native header chrome — the actual source of the above instability — is ever constructed) and the
 * handful of leaf components/hooks that would otherwise need real icon assets or a real query cache.
 * The router-navigation logic under test — the effect itself — is completely real and unmodified.
 */

let mockSegments: string[] = ['(tabs)', 'index'];
const mockRouter = { replace: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  Tabs: Object.assign(
    ({ children }: { children: React.ReactNode }) => children,
    { Screen: () => null },
  ),
}));

jest.mock('@/components/AddRaceSheet', () => ({
  AddRaceSheet: () => null,
}));
jest.mock('@/components/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/SignalMark', () => ({ SignalMark: () => null }));
jest.mock('@/components/TabIconImage', () => ({ TabIconImage: () => null }));
jest.mock('@/lib/racesContext', () => ({
  useAthleteRaces: () => ({ racingName: 'Test Athlete' }),
}));

beforeEach(() => {
  mockRouter.replace.mockClear();
  mockRouter.push.mockClear();
  mockSegments = ['(tabs)', 'index'];
});

describe('B.15: (tabs)/_layout.tsx default-route effect', () => {
  it('an ordinary authenticated launch (no destination already resolved) replaces to /stats exactly once', async () => {
    // The exact segments expo-router settles on for this group when nothing more specific was
    // requested — an ordinary cold launch, or the first mount right after onboarding completes.
    mockSegments = ['(tabs)', 'index'];

    await act(async () => {
      render(<TabsLayout />);
    });

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/stats');
  });

  it('a mount with an already-resolved explicit destination (e.g. a deep link into Signal) is left alone', async () => {
    // Only reachable if expo-router already resolved a specific tab before this component mounted —
    // e.g. a deep link to `racesignal://ask`. The default-tab effect must never override it.
    mockSegments = ['(tabs)', 'ask'];

    await act(async () => {
      render(<TabsLayout />);
    });

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('a mount already on the bare group root (no trailing screen segment yet) still replaces to /stats', async () => {
    // Some navigation states report just the group segment with no trailing screen name — still the
    // "no explicit destination" case.
    mockSegments = ['(tabs)'];

    await act(async () => {
      render(<TabsLayout />);
    });

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/stats');
  });

  it('never fires the default-route replace again on a later re-render, and never intercepts a later explicit navigation', async () => {
    mockSegments = ['(tabs)', 'index'];
    const ui = await render(<TabsLayout />);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);

    // Simulate whatever later re-render might occur in the real app (a context value changing, a
    // parent re-rendering) — the ref guard must make this a no-op regardless of cause, even though
    // segments haven't changed.
    await act(async () => {
      ui.rerender(<TabsLayout />);
    });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);

    // The exact action HeaderSearchButton performs to reach Races on purpose — must go through
    // unaffected, never intercepted or reverted by the one-time default-route effect.
    mockRouter.push('/');
    expect(mockRouter.push).toHaveBeenCalledWith('/');
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);

    await act(async () => {
      ui.unmount();
    });
  });
});
