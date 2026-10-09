import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ActionRow, DestructiveRow, InertRow, SettingsScroll, SettingsSection, useSettingsStyles } from '@/components/settings/SettingsRows';
import { useAppPhase } from '@/lib/appPhase';
import { appearanceLabel, useAppearancePreference } from '@/lib/appearance';
import { useAuth } from '@/lib/auth';
import { APPLE_MANUAL_REMOVAL_MESSAGE, needsManualAppleRemovalNotice, planAppleRevocation } from '@/lib/accountDeletion';
import { deleteAccount } from '@/lib/deleteAccount';
import { isDevPreviewAvailable } from '@/lib/devPreview';
import { getAppVariant } from '@/lib/environment';
import { clearFindRacesRetryDraft } from '@/lib/findRacesRetryDraft';
import type { IconName } from '@/lib/icons';
import { openFeedbackEmail } from '@/lib/feedback';
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_USE_URL } from '@/lib/legalLinks';
import { useNotifications } from '@/lib/notifications/NotificationsProvider';
import { clearNotificationState } from '@/lib/notifications/prefsStorage';
import { clearOnboardingDraft } from '@/lib/onboardingDraft';
import { usePremium } from '@/lib/premium';
import { useAthleteRaces } from '@/lib/racesContext';
import { clearSignalConsent } from '@/lib/signalConsent';
import { clearSignalDraft } from '@/lib/signalDraft';
import { requestAppleRevocationCode } from '@/lib/socialAuth';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';
import { spacing } from '@/lib/theme';

// Privacy/Support/Terms each become a real link the moment their URL is filled in (lib/legalLinks.ts); until then they
// fall back to the visibly subdued, clearly non-interactive InertRow rather than reading as broken.
const HELP_ROWS: { label: string; url: string; icon: IconName }[] = [
  { label: 'Support', url: SUPPORT_URL, icon: 'lifebuoy' },
  { label: 'Privacy', url: PRIVACY_POLICY_URL, icon: 'lock-outline' },
  { label: 'Terms of Use', url: TERMS_OF_USE_URL, icon: 'file-document-outline' },
];

/**
 * Settings: a compact list of grouped rows. The identity header stays here; each area with controls of its own opens a
 * detail screen (Subscription, Notifications, Signal privacy & consent, Sign-in methods, Developer tools). Sign out and
 * Delete account stay directly on this screen with their confirmations. Nothing here edits a profile.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { resetToOnboarding } = useAppPhase();
  const { session, signOut, getConnectedProviders } = useAuth();
  const { racingName } = useAthleteRaces();
  const displayName = racingName ?? session?.user.email ?? 'Athlete';
  const appearance = useAppearancePreference();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const socialAuth = getSocialAuthConfig();
  const showSignInMethods = socialAuth.apple || socialAuth.google;
  const { styles, palette } = useSettingsStyles();
  const identityStyles = useMemo(
    () =>
      StyleSheet.create({
        identity: { gap: spacing.xs, paddingVertical: spacing.md },
        identityName: { fontSize: 22, fontWeight: '700', color: palette.ink, marginTop: spacing.sm },
        identityEmail: { fontSize: 14, color: palette.inkSecondary },
      }),
    [palette],
  );
  const { isPremium } = usePremium();
  // A destination can take a moment to appear (first render, the dev bundle over a relay), and a second tap on the same row
  // would push a duplicate copy of the screen. Ignore a repeat of the same destination for a moment; other rows are unaffected.
  const lastPush = useRef<{ path: string; at: number } | null>(null);
  function go(path: '/race/add' | '/find-races' | '/settings/subscription' | '/settings/appearance' | '/settings/notifications' | '/settings/signal-privacy' | '/settings/sign-in-methods' | '/settings/developer') {
    const now = Date.now();
    if (lastPush.current && lastPush.current.path === path && now - lastPush.current.at < 800) return;
    lastPush.current = { path, at: now };
    router.push(path);
  }
  const { cancelAllForSignOut } = useNotifications();
  // Both existing gates are kept: the notification test tools need the development app variant, and Preview onboarding needs
  // the development preview opt-in. Neither is ever on in a production build, so neither is this entry.
  const showDeveloper = isDevPreviewAvailable() || getAppVariant() === 'development';

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // Nothing scheduled for this account may fire after it signs out (the next account on this device must not receive it).
      await cancelAllForSignOut().catch((err) => console.warn('[Settings] failed to cancel notifications on sign-out:', err));
      await signOut();
      resetToOnboarding();
    } catch (err) {
      console.warn('[Settings] sign out failed:', err);
      setIsSigningOut(false);
    }
  }

  /** Cancelling Apple's sheet during deletion is not a barrier: ask once whether to delete anyway. */
  function confirmDeleteWithoutApple(): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Delete without disconnecting Apple?',
        'We couldn’t confirm with Apple, so Sign in with Apple can’t be disconnected automatically. Your RaceSignal account can still be deleted now; you can remove RaceSignal later in your Apple ID settings.',
        [
          { text: 'Keep my account', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete anyway', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
  }

  async function handleDeleteAccountConfirmed() {
    if (isDeletingAccount) return;
    setIsDeletingAccount(true);
    setDeleteError(null);

    // Sign in with Apple tokens must be revoked on deletion. That needs a fresh code from Apple, which
    // can be cancelled, unavailable, or fail; none of those may stop the deletion itself.
    const identities = socialAuth.apple ? await getConnectedProviders() : null;
    const sessionProviders = (session?.user.app_metadata?.providers as string[] | undefined) ?? [];
    const applePlan = socialAuth.apple
      ? await planAppleRevocation(identities, sessionProviders, requestAppleRevocationCode)
      : ({ kind: 'none' } as const);
    if (applePlan.kind === 'cancelled' && !(await confirmDeleteWithoutApple())) {
      setIsDeletingAccount(false);
      return;
    }

    const result = await deleteAccount(applePlan.kind === 'revoke' ? { appleAuthorizationCode: applePlan.authorizationCode } : {});
    if (!result.available) {
      console.warn('[Settings] account deletion failed:', result.reason);
      setDeleteError('Something went wrong deleting your account. Please try again.');
      setIsDeletingAccount(false);
      return;
    }
    if (needsManualAppleRemovalNotice(applePlan, result.appleRevocation)) {
      Alert.alert('Account deleted', APPLE_MANUAL_REMOVAL_MESSAGE);
    }
    // The server-side account is gone; also clear any local pending-import drafts for it (Build
    // 11 — see findRacesRetryDraft.ts / onboardingDraft.ts's account-binding doc comments). Their
    // own athleteId check already refuses to resume a foreign draft for a future account, but
    // there's no reason to leave a now-permanently-orphaned draft sitting in AsyncStorage
    // indefinitely either. Best-effort: a failure here doesn't change that the account is deleted.
    const deletedAthleteId = session?.user.id;
    await Promise.all([
      clearFindRacesRetryDraft(),
      clearOnboardingDraft(),
      clearSignalConsent(),
      // This account's notifications, notification preferences and rotation, and its unsent Signal draft, do not outlive it.
      cancelAllForSignOut(),
      deletedAthleteId ? clearNotificationState(deletedAthleteId) : Promise.resolve(),
      deletedAthleteId ? clearSignalDraft(deletedAthleteId) : Promise.resolve(),
    ]).catch((err) => console.warn('[Settings] failed to clear local data after account deletion:', err));
    // Clear the local session/state the same way sign-out does so the app returns to a genuinely
    // signed-out state regardless of what supabase-js's own client-side session cache still holds.
    try {
      await signOut();
    } catch {
      // The account is already deleted server-side — a local sign-out failure here doesn't leave
      // a usable session behind, so it's safe to proceed to resetToOnboarding regardless.
    }
    resetToOnboarding();
  }

  function handleDeleteAccountPress() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your RaceSignal account and all of your race history, Signal conversations, and account data. This can’t be undone.\n\nDeleting your account does not cancel an active App Store subscription. Manage or cancel that separately in your device’s App Store settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDeleteAccountConfirmed },
      ],
    );
  }

  return (
    <SettingsScroll>
      {/* Identity: an editorial header at its everyday quiet scale, no enclosing card. */}
      <View style={identityStyles.identity}>
        <Avatar initials={initialsFor(displayName)} size={44} />
        <Text style={identityStyles.identityName}>{displayName}</Text>
        {session?.user.email ? <Text style={identityStyles.identityEmail}>{session.user.email}</Text> : null}
      </View>

      <SettingsSection title="Race history">
        <ActionRow label="Add a race manually" icon="plus-circle-outline" onPress={() => go('/race/add')} />
        <ActionRow label="Find my races" icon="magnify" onPress={() => go('/find-races')} />
      </SettingsSection>

      <SettingsSection title="Subscription">
        <ActionRow label="Plan" icon="credit-card-outline" value={isPremium ? 'Premium' : 'Free'} onPress={() => go('/settings/subscription')} />
      </SettingsSection>

      <SettingsSection title="Preferences">
        <ActionRow label="Appearance" icon="theme-light-dark" value={appearanceLabel(appearance)} onPress={() => go('/settings/appearance')} />
        <ActionRow label="Notifications" icon="bell-outline" onPress={() => go('/settings/notifications')} />
        <ActionRow label="Signal privacy & consent" icon="shield-lock-outline" onPress={() => go('/settings/signal-privacy')} />
      </SettingsSection>

      {showSignInMethods ? (
        <SettingsSection title="Account">
          <ActionRow label="Sign-in methods" icon="key-outline" onPress={() => go('/settings/sign-in-methods')} />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Help & legal">
        <ActionRow label="Share feedback" icon="message-text-outline" onPress={() => void openFeedbackEmail()} />
        {HELP_ROWS.map((row) =>
          row.url ? (
            <ActionRow key={row.label} label={row.label} icon={row.icon} onPress={() => Linking.openURL(row.url)} />
          ) : (
            <InertRow key={row.label} label={row.label} icon={row.icon} />
          ),
        )}
      </SettingsSection>

      {/* Apple 5.1.1(v): account creation requires an in-app path to delete it, not merely sign out, with an explicit
          destructive confirmation (including that deletion does not cancel an App Store subscription). Sign out is neutral;
          the destructive color is reserved for Delete account. */}
      <SettingsSection title="Account actions">
        <ActionRow label={isSigningOut ? 'Signing out…' : 'Sign out'} icon="logout" chevron={false} onPress={handleSignOut} disabled={isSigningOut} />
        <DestructiveRow label={isDeletingAccount ? 'Deleting account…' : 'Delete account'} icon="delete-outline" onPress={handleDeleteAccountPress} disabled={isDeletingAccount} />
        {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
      </SettingsSection>

      {/* Testing infrastructure, not product UI: one entry, and each tool inside keeps its own visibility gate. */}
      {showDeveloper ? (
        <SettingsSection title="Developer" dashed>
          <ActionRow label="Developer tools" icon="code-braces" onPress={() => go('/settings/developer')} />
        </SettingsSection>
      ) : null}
    </SettingsScroll>
  );
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
