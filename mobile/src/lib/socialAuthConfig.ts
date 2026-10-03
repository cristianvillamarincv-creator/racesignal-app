import Constants from 'expo-constants';

/**
 * Which native sign-in providers this build offers. Written by app.config.js from
 * config/environments.json `features` (plus the Google client IDs), so a build can never show a
 * provider its backend project isn't configured for: production stays off until the owner turns it on.
 */
export interface SocialAuthConfig {
  apple: boolean;
  google: boolean;
}

const OFF: SocialAuthConfig = { apple: false, google: false };

export function getSocialAuthConfig(): SocialAuthConfig {
  const raw = Constants.expoConfig?.extra?.auth as Partial<SocialAuthConfig> | undefined;
  if (!raw || typeof raw !== 'object') return OFF;
  return { apple: raw.apple === true, google: raw.google === true };
}
