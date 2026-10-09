import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Text } from 'react-native';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';

import AppearanceScreen from '@/app/settings/appearance';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  loadAppearance,
  parseAppearancePreference,
  resetAppearanceForTests,
  setAppearancePreference,
  useAppearanceLoaded,
  useAppearancePreference,
  useColorScheme,
} from '@/lib/appearance';
import { useBrandPalette } from '@/lib/brandTheme';

/**
 * Appearance: Dark is the default when nothing valid is saved, a saved Dark/Light/System choice is always honored (never replaced by the
 * default), a change applies at once and survives a restart, and it only changes presentation (palette + native scheme).
 */

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
let mockSystemScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockSystemScheme }));

const setNative = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});

async function read<T>(hook: () => T): Promise<T> {
  const { result } = await renderHook(hook);
  return result.current;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetAppearanceForTests();
  setNative.mockClear();
  mockSystemScheme = 'light';
});

describe('parseAppearancePreference', () => {
  it('accepts only the three known values', () => {
    expect(parseAppearancePreference('dark')).toBe('dark');
    expect(parseAppearancePreference('light')).toBe('light');
    expect(parseAppearancePreference('system')).toBe('system');
    for (const bad of [null, undefined, '', 'Dark', 'auto', 1, {}]) expect(parseAppearancePreference(bad)).toBeNull();
  });
});

describe('loading the saved choice', () => {
  it('defaults to Dark when nothing is saved, without writing the default to storage', async () => {
    await loadAppearance();
    const { result } = await renderHook(() => ({ pref: useAppearancePreference(), scheme: useColorScheme(), loaded: useAppearanceLoaded() }));
    expect(DEFAULT_APPEARANCE).toBe('dark');
    expect(result.current).toEqual({ pref: 'dark', scheme: 'dark', loaded: true });
    expect(setNative).toHaveBeenLastCalledWith('dark');
    expect(await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it('defaults to Dark when the saved value is not one of the three choices', async () => {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'sepia');
    await loadAppearance();
    expect((await read(() => useAppearancePreference()))).toBe('dark');
  });

  it('keeps an explicit Light choice instead of the Dark default', async () => {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');
    mockSystemScheme = 'dark';
    await loadAppearance();
    const { result } = await renderHook(() => ({ pref: useAppearancePreference(), scheme: useColorScheme() }));
    expect(result.current).toEqual({ pref: 'light', scheme: 'light' });
    expect(setNative).toHaveBeenLastCalledWith('light');
  });

  it('keeps an explicit System choice and follows the device, clearing the native override', async () => {
    await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'system');
    mockSystemScheme = 'light';
    await loadAppearance();
    const { result } = await renderHook(() => ({ pref: useAppearancePreference(), scheme: useColorScheme() }));
    expect(result.current).toEqual({ pref: 'system', scheme: 'light' });
    expect(setNative).toHaveBeenLastCalledWith(null);
  });

  it('falls back to Dark if storage cannot be read, and still reports loaded', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    await loadAppearance();
    expect((await read(() => useAppearancePreference()))).toBe('dark');
    expect((await read(() => useAppearanceLoaded()))).toBe(true);
  });

  it('does not let a slow read overwrite a choice made while it was in flight', async () => {
    const pending = loadAppearance();
    await setAppearancePreference('light');
    await pending;
    expect((await read(() => useAppearancePreference()))).toBe('light');
  });
});

describe('palette selection', () => {
  it('draws with the dark palette for Dark and the light palette for Light regardless of the device', async () => {
    mockSystemScheme = 'light';
    await setAppearancePreference('dark');
    const { result } = await renderHook(() => useBrandPalette());
    expect(result.current.statusBarStyle).toBe('light');
    await act(async () => {
      await setAppearancePreference('light');
    });
    expect(result.current.statusBarStyle).toBe('dark');
  });

  it('follows the device only for System', async () => {
    await setAppearancePreference('system');
    mockSystemScheme = 'dark';
    expect((await read(() => useBrandPalette())).statusBarStyle).toBe('light');
  });
});

describe('Settings → Appearance', () => {
  it('lists Dark, Light and System, marks the current choice, applies a change at once and saves it', async () => {
    await loadAppearance();
    const screen = await render(<AppearanceScreen />);
    expect(screen.getByRole('radio', { name: /^Dark,/ }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('radio', { name: /^Light,/ }).props.accessibilityState.selected).toBe(false);
    expect(screen.getByRole('radio', { name: /^System,/ })).toBeTruthy();

    fireEvent.press(screen.getByRole('radio', { name: /^Light,/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Light,/ }).props.accessibilityState.selected).toBe(true));
    expect(screen.getByRole('radio', { name: /^Dark,/ }).props.accessibilityState.selected).toBe(false);
    expect(setNative).toHaveBeenLastCalledWith('light');
    expect(await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
  });

  it('persists across a restart: a fresh launch reads back what was chosen', async () => {
    await setAppearancePreference('system');
    resetAppearanceForTests(); // the app process restarts; storage stays
    await loadAppearance();
    expect((await read(() => useAppearancePreference()))).toBe('system');
    setNative.mockClear();
    resetAppearanceForTests();
    await setAppearancePreference('dark');
    resetAppearanceForTests();
    await loadAppearance();
    expect((await read(() => useAppearancePreference()))).toBe('dark');
  });

  it('says it changes presentation only', async () => {
    const screen = await render(<AppearanceScreen />);
    expect(screen.getByText(/only changes how RaceSignal looks/)).toBeTruthy();
    expect(Text).toBeDefined();
  });
});
