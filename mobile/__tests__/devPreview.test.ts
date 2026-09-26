import { isDevPreviewAvailable } from '@/lib/devPreview';

// `__DEV__` is a React Native global (jest-expo's environment sets it to `true` by default) and
// `EXPO_PUBLIC_ENABLE_DEV_PREVIEW` is a plain env var — isDevPreviewAvailable() reads both fresh on
// every call (nothing is cached at import time), so each test can just reassign them directly and
// this file restores the originals afterward so it never leaks state into other test files.
const globalWithDev = global as unknown as { __DEV__: boolean };
const originalDev = globalWithDev.__DEV__;
const originalEnvValue = process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW;

afterEach(() => {
  globalWithDev.__DEV__ = originalDev;
  if (originalEnvValue === undefined) {
    delete process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW;
  } else {
    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = originalEnvValue;
  }
});

describe('isDevPreviewAvailable', () => {
  it('returns false when __DEV__ is false, regardless of the env var', () => {
    globalWithDev.__DEV__ = false;
    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = 'true';
    expect(isDevPreviewAvailable()).toBe(false);
  });

  it('returns false when __DEV__ is true but the env var is unset', () => {
    globalWithDev.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW;
    expect(isDevPreviewAvailable()).toBe(false);
  });

  it("returns false when __DEV__ is true but the env var is not exactly 'true'", () => {
    globalWithDev.__DEV__ = true;
    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = 'TRUE';
    expect(isDevPreviewAvailable()).toBe(false);

    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = '1';
    expect(isDevPreviewAvailable()).toBe(false);

    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = 'false';
    expect(isDevPreviewAvailable()).toBe(false);
  });

  it("returns true only when __DEV__ is true AND the env var is exactly 'true'", () => {
    globalWithDev.__DEV__ = true;
    process.env.EXPO_PUBLIC_ENABLE_DEV_PREVIEW = 'true';
    expect(isDevPreviewAvailable()).toBe(true);
  });
});
