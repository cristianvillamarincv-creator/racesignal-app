import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';

/** The URL scheme of the build that is actually running — `racesignal` for production,
 *  `racesignal-dev` for the development app (see app.config.js). Taken from the Expo config so a
 *  magic link or OAuth return always lands in the SAME app that requested it, even when both are installed. */
const APP_SCHEME = typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'racesignal';

/** The exact redirect used for the magic-link email AND Google OAuth, so there is only ever one URL per
 *  environment to register in Supabase's Auth > URL Configuration allowlist. */
export function getAuthRedirectUri(): string {
  return makeRedirectUri({ scheme: APP_SCHEME, path: 'auth-callback' });
}
