import Constants from 'expo-constants';

/**
 * Which native sign-in providers this build offers. Written by app.config.js from
 * config/environments.json `features` (plus the Google client IDs), so a build can never show a
 * provider its backend project isn't configured for: production stays off until the owner turns it on.
 */
export interface SocialAuthConfig {
  apple: boolean;
  google: boolean;
  googleWebClientId: string | null;
  googleIosClientId: string | null;
}

const OFF: SocialAuthConfig = { apple: false, google: false, googleWebClientId: null, googleIosClientId: null };

export function getSocialAuthConfig(): SocialAuthConfig {
  const raw = Constants.expoConfig?.extra?.auth as Partial<SocialAuthConfig> | undefined;
  if (!raw || typeof raw !== 'object') return OFF;
  return {
    apple: raw.apple === true,
    google: raw.google === true && typeof raw.googleWebClientId === 'string' && typeof raw.googleIosClientId === 'string',
    googleWebClientId: typeof raw.googleWebClientId === 'string' ? raw.googleWebClientId : null,
    googleIosClientId: typeof raw.googleIosClientId === 'string' ? raw.googleIosClientId : null,
  };
}
