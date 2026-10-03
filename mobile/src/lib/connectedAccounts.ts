import type { ConnectedProvider, LinkProviderResult, SocialProvider } from '@/lib/socialAuthTypes';
import { PROVIDER_LABEL } from '@/lib/socialAuthTypes';

/** Rows for Settings -> Connected accounts. Pure so it is testable without rendering Settings. */
export interface ConnectedAccountRow {
  provider: SocialProvider;
  label: string;
  connected: boolean;
}

export function buildConnectedAccountRows(
  identities: ConnectedProvider[] | null,
  enabled: { apple: boolean; google: boolean },
): ConnectedAccountRow[] {
  const rows: ConnectedAccountRow[] = [];
  for (const provider of ['apple', 'google'] as const) {
    if (!enabled[provider]) continue;
    rows.push({
      provider,
      label: PROVIDER_LABEL[provider],
      connected: identities?.some((identity) => identity.provider === provider) ?? false,
    });
  }
  return rows;
}

export type ConnectFeedback = { kind: 'none' } | { kind: 'notice'; text: string } | { kind: 'error'; text: string };

export function feedbackForLinkResult(provider: SocialProvider, result: LinkProviderResult): ConnectFeedback {
  const label = PROVIDER_LABEL[provider];
  switch (result.status) {
    case 'success':
      return { kind: 'notice', text: `${label} is connected. You can now sign in with it.` };
    case 'cancelled':
      return { kind: 'none' };
    case 'unavailable':
      return { kind: 'error', text: `${label} isn’t available in this build.` };
    case 'conflict':
    case 'error':
      return { kind: 'error', text: result.message };
  }
}
