/** Types and labels shared by the social-auth modules. Kept free of runtime imports so UI helpers and tests
 *  can use them without loading the Supabase client. */
export type SocialProvider = 'apple' | 'google';

export type SocialSignInResult =
  | { status: 'success'; userId: string }
  /** The athlete closed the provider sheet. Not an error; callers return quietly. */
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export type LinkProviderResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  /** The provider account is already connected to a DIFFERENT RaceSignal account. Nothing changed. */
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string };

export type AppleRevocationCodeResult =
  | { status: 'code'; authorizationCode: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error' };

export interface ConnectedProvider {
  provider: string;
  /** The provider's own stable user id (Apple's `sub`), when Supabase has it. */
  providerUserId: string | null;
  email: string | null;
}

export const PROVIDER_LABEL: Record<SocialProvider, string> = { apple: 'Apple', google: 'Google' };
