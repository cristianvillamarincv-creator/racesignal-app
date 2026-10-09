import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme as useSystemColorScheme, type ColorSchemeName } from 'react-native';

/**
 * The athlete's Appearance choice (Settings → Appearance). Presentation only: it picks which of the two existing palettes the app
 * draws with and never touches race data, accounts or any server state.
 *
 *  - `dark` / `light` force that palette; `system` follows the iPhone's own setting.
 *  - With nothing saved the default is Dark. The default is never written to storage, so only an explicit choice is ever saved, and a
 *    saved choice (including System) is always honored over the default.
 *  - The preference is kept in this module so every screen sees a change at once, and is mirrored to the native layer
 *    (`Appearance.setColorScheme`) so native chrome (alerts, keyboard, system sheets) agrees with the app.
 */
export type AppearancePreference = 'dark' | 'light' | 'system';

export const APPEARANCE_STORAGE_KEY = 'racesignal.appearance.preference';
export const DEFAULT_APPEARANCE: AppearancePreference = 'dark';

export const APPEARANCE_OPTIONS: { value: AppearancePreference; label: string; detail: string }[] = [
  { value: 'dark', label: 'Dark', detail: 'A dark canvas with light text.' },
  { value: 'light', label: 'Light', detail: 'A warm light canvas with dark text.' },
  { value: 'system', label: 'System', detail: 'Match your iPhone’s Light or Dark setting.' },
];

export function appearanceLabel(preference: AppearancePreference): string {
  return APPEARANCE_OPTIONS.find((option) => option.value === preference)?.label ?? 'Dark';
}

/** Only the three known values are accepted; anything else (missing, corrupt, from some other version) means "nothing saved". */
export function parseAppearancePreference(raw: unknown): AppearancePreference | null {
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : null;
}

// Loaded on demand so that every screen importing the palette hook (through brandTheme) does not also pull in the native storage module.
function storage(): typeof import('@react-native-async-storage/async-storage').default {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loadedModule = require('@react-native-async-storage/async-storage');
  return loadedModule.default ?? loadedModule;
}

// `null` until the saved value has been read. Until then screens follow the system scheme; the splash screen is held until the read
// finishes (see the root layout), so nothing is ever drawn in the wrong appearance.
let current: AppearancePreference | null = null;
let loaded = false;
let touched = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyNative(preference: AppearancePreference) {
  try {
    Appearance.setColorScheme(preference === 'system' ? null : preference);
  } catch {
    // Best effort: the app's own palette selection does not depend on the native override.
  }
}

/** Reads the saved choice once (safe to call repeatedly) and applies it, or the Dark default when nothing valid is saved. */
export function loadAppearance(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    let saved: AppearancePreference | null = null;
    try {
      saved = parseAppearancePreference(await storage().getItem(APPEARANCE_STORAGE_KEY));
    } catch {
      saved = null;
    }
    // A choice made while the read was in flight is newer than whatever was stored.
    if (!touched) {
      current = saved ?? DEFAULT_APPEARANCE;
      applyNative(current);
    }
    loaded = true;
    emit();
  })();
  return loading;
}

/** Applies a new choice immediately and saves it so it survives restarts. */
export async function setAppearancePreference(preference: AppearancePreference): Promise<void> {
  touched = true;
  current = preference;
  applyNative(preference);
  emit();
  try {
    await storage().setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this session; it just was not saved.
  }
}

/** The effective choice: the saved one, or Dark when nothing is saved. */
export function useAppearancePreference(): AppearancePreference {
  const value = useSyncExternalStore(subscribe, () => current);
  return value ?? DEFAULT_APPEARANCE;
}

/** True once the saved choice has been read (or failed to read and fallen back to the default). */
export function useAppearanceLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded);
}

/** Drop-in replacement for react-native's `useColorScheme`: the forced scheme when Dark/Light is chosen, otherwise the system's. */
export function useColorScheme(): ColorSchemeName {
  const system = useSystemColorScheme();
  const value = useSyncExternalStore(subscribe, () => current);
  return value === 'dark' || value === 'light' ? value : system;
}

/** Test helper: returns the module to its just-launched state. */
export function resetAppearanceForTests() {
  current = null;
  loaded = false;
  touched = false;
  loading = null;
  listeners.clear();
}
