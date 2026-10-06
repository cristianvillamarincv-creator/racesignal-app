import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { ActionRow, PlanStatusRow, SettingsNote, SettingsScroll, SettingsSection, useSettingsStyles } from '@/components/settings/SettingsRows';
import { useAuth } from '@/lib/auth';
import { buildConnectedAccountRows, feedbackForLinkResult, type ConnectFeedback } from '@/lib/connectedAccounts';
import type { ConnectedProvider, SocialProvider } from '@/lib/socialAuth';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';

/** Settings → Sign-in methods: the email, any connected Apple or Google sign-in, and connecting one to this same account. */
export default function SignInMethodsScreen() {
  const { session, linkProvider, getConnectedProviders } = useAuth();
  const socialAuth = getSocialAuthConfig();
  const showConnectedAccounts = socialAuth.apple || socialAuth.google;
  const [connectedProviders, setConnectedProviders] = useState<ConnectedProvider[] | null>(null);
  const [connectedLoaded, setConnectedLoaded] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<SocialProvider | null>(null);
  const [connectFeedback, setConnectFeedback] = useState<ConnectFeedback>({ kind: 'none' });
  const { styles } = useSettingsStyles();

  async function refreshConnectedProviders() {
    const identities = await getConnectedProviders();
    setConnectedProviders(identities);
    setConnectedLoaded(true);
  }

  useEffect(() => {
    if (!showConnectedAccounts || !session?.user.id) return;
    void refreshConnectedProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConnectedAccounts, session?.user.id]);

  /** Connects a provider to the account that is signed in now. Supabase refuses (and we report, changing
   *  neither account) if that provider already belongs to another account. */
  async function handleConnectProvider(provider: SocialProvider) {
    if (connectingProvider) return;
    setConnectingProvider(provider);
    setConnectFeedback({ kind: 'none' });
    const result = await linkProvider(provider);
    setConnectingProvider(null);
    setConnectFeedback(feedbackForLinkResult(provider, result));
    if (result.status === 'success') await refreshConnectedProviders();
  }

  return (
    <SettingsScroll>
      <SettingsSection>
        <PlanStatusRow
          title="Email"
          icon="email-outline"
          detail={session?.user.email ? `${session.user.email} · sign-in link or password` : 'Sign-in link or password'}
        />
        {connectedLoaded && connectedProviders === null ? (
          <ActionRow label="Couldn’t load connected accounts. Tap to retry" icon="refresh" onPress={refreshConnectedProviders} />
        ) : (
          buildConnectedAccountRows(connectedProviders, socialAuth).map((row) =>
            row.connected ? (
              <PlanStatusRow key={row.provider} title={row.label} badge="CONNECTED" detail="You can sign in with it." icon="check-circle-outline" />
            ) : (
              <ActionRow
                key={row.provider}
                label={connectingProvider === row.provider ? `Connecting ${row.label}…` : `Connect ${row.label}`}
                icon="link-variant"
                onPress={() => handleConnectProvider(row.provider)}
              />
            ),
          )
        )}
      </SettingsSection>
      {/* The account-linking guidance that used to sit on the sign-in screen: an Apple "Hide My Email" address, or any
          email that differs from the one you signed up with, is never matched automatically, so existing athletes connect
          the provider here instead of creating a second account. */}
      <SettingsNote>Use Apple’s Hide My Email, or a different email on Apple or Google? Connect it here so it signs in to this same account.</SettingsNote>
      {connectFeedback.kind === 'error' ? <Text style={styles.errorText}>{connectFeedback.text}</Text> : null}
      {connectFeedback.kind === 'notice' ? <SettingsNote>{connectFeedback.text}</SettingsNote> : null}
    </SettingsScroll>
  );
}
