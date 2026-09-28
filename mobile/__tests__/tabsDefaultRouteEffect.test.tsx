import { act, render } from '@testing-library/react-native';
import TabsLayout from '@/app/(tabs)/_layout';

/**
 * B.15 — isolated, deterministic coverage of the actual fix in
 * `(tabs)/_layout.tsx`'s `TabsNavigator`: the ref-guarded effect that calls `router.replace('/stats')`
 * exactly once per mount, which is what makes a cold launch land on Stats instead of Races (see that
 * file's own comment on `hasAppliedDefaultTabRef` for why the declarative `initialRouteName` settings
 * alone don't do this).
 *
 * A full end-to-end render of the real app directory through expo-router's `renderRouter()` was
 * attempted for this scenario and abandoned: traced to a confirmed version incompatibility between
 * the installed `expo-router@6.0.24` (whose bundled `renderRouter()` calls
 * `@testing-library/react-native`'s `render()` without awaiting it) and the installed
 * `@testing-library/react-native@14.0.1` (whose `render()` is async, a v13→v14 change) — not a bug in
 * this app. That combination produced non-deterministic renders (a blank tree, a mid-render crash
 * reading `Platform.OS` from a still-initializing module, or occasionally a fully-settled render) that
 * couldn't be made reliable from test code alone.
 *
 * This test instead renders the REAL `TabsLayout` (the file's actual default export, unmodified),
 * mocking only expo-router's own `Tabs`/`useRouter` (so no real React Navigation tab bar or native
 * header chrome — the actual source of the above instability — is ever constructed) and the handful
 * of leaf components/hooks that would otherwise need real icon assets or a real query cache. The
 * router-navigation logic under test — the effect itself — is completely real and unmodified.
 */

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Tabs: Object.assign(
    ({ children }: { children: React.ReactNode }) => children,
    { Screen: () => null },
  ),
}));

const mockRouter = { replace: jest.fn(), push: jest.fn() };

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
});

describe('B.15: (tabs)/_layout.tsx default-route effect', () => {
  it('replaces to /stats exactly once when the tabs navigator mounts', async () => {
    await act(async () => {
      render(<TabsLayout />);
    });

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/stats');
  });

  it('never fires the default-route replace again on a later re-render (a deliberate navigation elsewhere is never overridden)', async () => {
    const ui = await render(<TabsLayout />);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);

    // Simulate whatever later re-render might occur in the real app (a context value changing, a
    // parent re-rendering) — the ref guard must make this a no-op regardless of cause.
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
