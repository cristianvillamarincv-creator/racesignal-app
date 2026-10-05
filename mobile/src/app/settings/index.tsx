import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { NotificationDevTools } from '@/components/notifications/NotificationDevTools';
import { NotificationSettingsSection } from '@/components/notifications/NotificationSettingsSection';
import { HairlineRule } from '@/components/HairlineRule';
import { SectionHeader } from '@/components/SectionHeader';
import { useAppPhase } from '@/lib/appPhase';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { APPLE_MANUAL_REMOVAL_MESSAGE, needsManualAppleRemovalNotice, planAppleRevocation } from '@/lib/accountDeletion';
import { buildConnectedAccountRows, feedbackForLinkResult, type ConnectFeedback } from '@/lib/connectedAccounts';
import { deleteAccount } from '@/lib/deleteAccount';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import { clearFindRacesRetryDraft } from '@/lib/findRacesRetryDraft';
import { AppIcon } from '@/lib/icons';
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_USE_URL } from '@/lib/legalLinks';
import { useNotifications } from '@/lib/notifications/NotificationsProvider';
import { clearNotificationState } from '@/lib/notifications/prefsStorage';
import { clearOnboardingDraft } from '@/lib/onboardingDraft';
import { usePremium } from '@/lib/premium';
import { presentPremiumPaywall } from '@/lib/purchases';
import { SETTINGS_FREE_DETAIL, SETTINGS_FREE_TITLE, SETTINGS_PREMIUM_DETAIL, SETTINGS_UPGRADE_LABEL } from '@/lib/signalUsage';
import { useAthleteRaces } from '@/lib/racesContext';
import { clearSignalConsent, hasAgreedToSignalDisclosure } from '@/lib/signalConsent';
import { clearSignalDraft } from '@/lib/signalDraft';
import { requestAppleRevocationCode, type ConnectedProvider, type SocialProvider } from '@/lib/socialAuth';
import { getSocialAuthConfig } from '@/lib/socialAuthConfig';
import { minTouchSize, spacing } from '@/lib/theme';

// Blocked Users (not a genuine V1 requirement) stays fully hidden until it's real. Privacy/Support
// each become a real functioning link the moment their URL is filled in (lib/legalLinks.ts) —
// until then they fall back to the same visibly
// subdued, clearly non-interactive InertRow used since Step 6, rather than reading as broken.
const ACCOUNT_ROWS: { label: string; url: string }[] = [
  { label: 'Privacy', url: PRIVACY_POLICY_URL },
  { label: 'Terms of Use', url: TERMS_OF_USE_URL },
  { label: 'Support', url: SUPPORT_URL },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { resetToOnboarding } = useAppPhase();
  const { session, signOut, linkProvider, getConnectedProviders } = useAuth();
  const { racingName } = useAthleteRaces();
  const displayName = racingName ?? session?.user.email ?? 'Athlete';
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const socialAuth = getSocialAuthConfig();
  const showConnectedAccounts = socialAuth.apple || socialAuth.google;
  const [connectedProviders, setConnectedProviders] = useState<ConnectedProvider[] | null>(null);
  const [connectedLoaded, setConnectedLoaded] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<SocialProvider | null>(null);
  const [connectFeedback, setConnectFeedback] = useState<ConnectFeedback>({ kind: 'none' });
  const [hasSignalConsent, setHasSignalConsent] = useState(false);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { enterOnboardingReplayFromSettings } = useDevPreview();
  const showDevTools = isDevPreviewAvailable();
  const { isPremium, refresh: refreshPremiumStatus, restorePurchases } = usePremium();
  const { cancelAllForSignOut } = useNotifications();

  useEffect(() => {
    const athleteId = session?.user.id;
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const agreed = await hasAgreedToSignalDisclosure(athleteId);
      if (!cancelled) setHasSignalConsent(agreed);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

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

  async function handleWithdrawSignalConsent() {
    await clearSignalConsent();
    setHasSignalConsent(false);
  }

  async function handleUpgradePress() {
    await presentPremiumPaywall();
    await refreshPremiumStatus();
  }

  async function handleRestorePress() {
    if (isRestoring) return;
    setIsRestoring(true);
    const restored = await restorePurchases();
    setIsRestoring(false);
    Alert.alert(
      restored ? 'Purchases restored' : 'Nothing to restore',
      restored ? 'Your RaceSignal Premium subscription is active on this device.' : 'No active RaceSignal Premium purchase was found for this account.',
    );
  }

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
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {/* Identity — an editorial header, not a profile widget. The name leads; the avatar stays
            at its everyday quiet scale (never enlarged into a hero photo placeholder); no
            enclosing card — the athlete is the subject of the screen, not a record inside a box. */}
        <View style={styles.identity}>
          <Avatar initials={initialsFor(displayName)} size={44} />
          <Text style={styles.identityName}>{displayName}</Text>
          {session?.user.email ? <Text style={styles.identityEmail}>{session.user.email}</Text> : null}
        </View>

        <View style={styles.section}>
          <SectionHeader title="Race history" />
          <HairlineRule color={palette.hairline} />
          <ActionRow
            label="Add a race manually"
            onPress={() => router.push('/race/add')}
            styles={styles}
            palette={palette}
          />
          <HairlineRule color={palette.hairline} />
          <ActionRow
            label="Find my races"
            onPress={() => router.push('/find-races')}
            styles={styles}
            palette={palette}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader title="Subscription" />
          <HairlineRule color={palette.hairline} />
          {isPremium ? (
            <PlanStatusRow title="RaceSignal Premium" badge="ACTIVE" detail={SETTINGS_PREMIUM_DETAIL} styles={styles} />
          ) : (
            <>
              <PlanStatusRow title={SETTINGS_FREE_TITLE} detail={SETTINGS_FREE_DETAIL} styles={styles} />
              <HairlineRule color={palette.hairline} />
              <ActionRow
                label={SETTINGS_UPGRADE_LABEL}
                detail={SETTINGS_PREMIUM_DETAIL}
                onPress={handleUpgradePress}
                styles={styles}
                palette={palette}
              />
            </>
          )}
          <HairlineRule color={palette.hairline} />
          <ActionRow
            label={isRestoring ? 'Restoring…' : 'Restore Purchases'}
            onPress={handleRestorePress}
            styles={styles}
            palette={palette}
          />
        </View>

        <NotificationSettingsSection />

        <NotificationDevTools />

        {showConnectedAccounts ? (
          <View style={styles.section}>
            <SectionHeader title="Connected accounts" />
            <HairlineRule color={palette.hairline} />
            <PlanStatusRow
              title="Email"
              detail={session?.user.email ? `${session.user.email} · sign-in link or password` : 'Sign-in link or password'}
              styles={styles}
            />
            {connectedLoaded && connectedProviders === null ? (
              <>
                <HairlineRule color={palette.hairline} />
                <ActionRow label="Couldn’t load connected accounts. Tap to retry" onPress={refreshConnectedProviders} styles={styles} palette={palette} />
              </>
            ) : (
              buildConnectedAccountRows(connectedProviders, socialAuth).map((row) => (
                <View key={row.provider}>
                  <HairlineRule color={palette.hairline} />
                  {row.connected ? (
                    <PlanStatusRow title={row.label} badge="CONNECTED" detail="You can sign in with it." styles={styles} />
                  ) : (
                    <ActionRow
                      label={connectingProvider === row.provider ? `Connecting ${row.label}…` : `Connect ${row.label}`}
                      onPress={() => handleConnectProvider(row.provider)}
                      styles={styles}
                      palette={palette}
                    />
                  )}
                </View>
              ))
            )}
            <HairlineRule color={palette.hairline} />
            {/* The account-linking guidance that used to sit on the sign-in screen: an Apple "Hide My Email"
                address, or any email that differs from the one you signed up with, is never matched
                automatically, so existing athletes connect the provider here instead of creating a second account. */}
            <Text style={styles.planDetail}>
              Use Apple’s Hide My Email, or a different email on Apple or Google? Connect it here so it signs in to this same account.
            </Text>
            {connectFeedback.kind === 'error' ? <Text style={styles.deleteErrorText}>{connectFeedback.text}</Text> : null}
            {connectFeedback.kind === 'notice' ? <Text style={styles.planDetail}>{connectFeedback.text}</Text> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Account" />
          <HairlineRule color={palette.hairline} />
          {ACCOUNT_ROWS.map((row) => (
            <View key={row.label}>
              {row.url ? (
                <ActionRow label={row.label} onPress={() => Linking.openURL(row.url)} styles={styles} palette={palette} />
              ) : (
                <InertRow label={row.label} styles={styles} />
              )}
              <HairlineRule color={palette.hairline} />
            </View>
          ))}
          {/* Signal/Anthropic consent withdrawal (B.12) — the sheet at src/components/
              SignalConsentSheet.tsx re-prompts the very next time Signal would send anything,
              once this is withdrawn. Nothing to withdraw before the athlete has ever agreed, so
              this reads as a quiet status line rather than an action in that case. */}
          <PlanStatusRow
            title="Signal & Anthropic"
            detail={hasSignalConsent ? 'You’ve agreed to share race data with Anthropic for Signal.' : 'Not yet agreed — you’ll be asked before your first Signal question.'}
            styles={styles}
          />
          {hasSignalConsent ? (
            <>
              <HairlineRule color={palette.hairline} />
              <ActionRow label="Withdraw Signal consent" onPress={handleWithdrawSignalConsent} styles={styles} palette={palette} />
            </>
          ) : null}
          <HairlineRule color={palette.hairline} />
          {/* Apple 5.1.1(v): account creation requires an in-app path to delete it, not merely sign
              out. Grouped under Account (not a trailing, easy-to-miss link after Sign out) so it's
              where an athlete actually looks for it, with an explicit destructive confirmation —
              including that deletion doesn't itself cancel an active App Store subscription —
              before anything happens. */}
          <DestructiveRow
            label={isDeletingAccount ? 'Deleting account…' : 'Delete account'}
            onPress={handleDeleteAccountPress}
            disabled={isDeletingAccount}
            styles={styles}
          />
          {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}
        </View>

        {/* Sign out — a quiet destructive utility link, exactly like results/[id].tsx's "Remove
            this race": plain Pressable+Text, danger-colored, no button chrome. */}
        <Pressable
          onPress={handleSignOut}
          disabled={isSigningOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={styles.signOutRow}>
          <Text style={[styles.signOutLabel, isSigningOut && styles.signOutLabelDisabled]}>
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Text>
        </Pressable>

        {/* Testing infrastructure, not V1 product UI — gated by isDevPreviewAvailable() (both
            __DEV__ and the explicit EXPO_PUBLIC_ENABLE_DEV_PREVIEW opt-in), so this can never render
            in a TestFlight/release build regardless of anything else. A dashed border (matching the
            same dev-only visual cue used on OnboardingFlow's "Simulate tapping the magic link"
            button) keeps it visually distinct from every real settings row above. Tapping "Preview
            onboarding" replays the real onboarding UI in the existing Developer Preview's simulated
            mode (see lib/devPreview.tsx) — the real signed-in session is never touched: it's simply
            not rendered while the preview is showing, and _layout.tsx's RootNavigator re-authenticates
            the same real session and returns here to Settings the moment the preview exits. */}
        {showDevTools ? (
          <View style={styles.devSection}>
            <Text style={styles.devSectionLabel}>Developer tools</Text>
            <Pressable
              onPress={enterOnboardingReplayFromSettings}
              accessibilityRole="button"
              accessibilityLabel="Preview onboarding"
              style={styles.devRow}>
              <Text style={styles.devRowLabel}>Preview onboarding</Text>
              <AppIcon name="chevron-right" size={16} color={palette.inkSecondary} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
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

function ActionRow({
  label,
  detail,
  onPress,
  styles,
  palette,
}: {
  label: string;
  /** Optional supporting line under the label (for example what Premium includes). */
  detail?: string;
  onPress: () => void;
  styles: Styles;
  palette: BrandPalette;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={detail ? `${label}, ${detail}` : label} style={styles.actionRow}>
      <View style={styles.actionTextBlock}>
        <Text style={styles.actionLabel}>{label}</Text>
        {detail ? <Text style={styles.planDetail}>{detail}</Text> : null}
      </View>
      <AppIcon name="chevron-right" size={18} color={palette.signalBlue} />
    </Pressable>
  );
}

/** A visibly present but genuinely inert row — no Pressable, no arrow, reduced opacity — so it
 *  reads as a clear placeholder rather than a broken button. */
function InertRow({ label, styles }: { label: string; styles: Styles }) {
  return (
    <View style={styles.inertRow} accessibilityRole="text" accessibilityLabel={`${label}, coming soon`}>
      <Text style={styles.inertLabel}>{label}</Text>
      <Text style={styles.inertValue}>Coming soon</Text>
    </View>
  );
}

/** A non-interactive plan-status line — the athlete's current Free/Premium state (Step 8.8, Build
 *  10 polish). Deliberately not a full subscription-management screen; that's handled by Apple's
 *  own App Store subscription settings, reachable from Restore Purchases if needed. */
function PlanStatusRow({ title, badge, detail, styles }: { title: string; badge?: string; detail: string; styles: Styles }) {
  return (
    <View style={styles.planRow} accessibilityRole="text" accessibilityLabel={badge ? `${title}, ${badge}, ${detail}` : `${title}, ${detail}`}>
      <View style={styles.planTitleRow}>
        <Text style={styles.planTitle}>{title}</Text>
        {badge ? (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.planDetail}>{detail}</Text>
    </View>
  );
}

/** A destructive row grouped inside a titled section (unlike Sign out's standalone quiet link
 *  below) — same row layout/height as ActionRow so it reads as belonging to the Account section,
 *  distinguished only by its danger color, matching the "visually destructive/red" requirement. */
function DestructiveRow({
  label,
  onPress,
  disabled,
  styles,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  styles: Styles;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={styles.actionRow}>
      <Text style={[styles.destructiveLabel, disabled && styles.signOutLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  identity: ViewStyle;
  identityName: TextStyle;
  identityEmail: TextStyle;
  section: ViewStyle;
  actionRow: ViewStyle;
  actionTextBlock: ViewStyle;
  actionLabel: TextStyle;
  inertRow: ViewStyle;
  inertLabel: TextStyle;
  inertValue: TextStyle;
  planRow: ViewStyle;
  planTitleRow: ViewStyle;
  planTitle: TextStyle;
  planBadge: ViewStyle;
  planBadgeText: TextStyle;
  planDetail: TextStyle;
  destructiveLabel: TextStyle;
  signOutRow: ViewStyle;
  signOutLabel: TextStyle;
  signOutLabelDisabled: TextStyle;
  deleteErrorText: TextStyle;
  devSection: ViewStyle;
  devSectionLabel: TextStyle;
  devRow: ViewStyle;
  devRowLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.xxl,
    },
    identity: {
      gap: spacing.xs,
      paddingVertical: spacing.md,
    },
    identityName: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.ink,
      marginTop: spacing.sm,
    },
    identityEmail: {
      fontSize: 14,
      color: palette.inkSecondary,
    },
    section: {
      gap: 0,
    },
    actionTextBlock: {
      flex: 1,
      gap: 2,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
    },
    actionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    inertRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
      opacity: 0.5,
    },
    inertLabel: {
      fontSize: 16,
      color: palette.inkSecondary,
    },
    inertValue: {
      fontSize: 13,
      color: palette.inkSecondary,
    },
    planRow: {
      minHeight: minTouchSize,
      justifyContent: 'center',
      gap: 2,
    },
    planTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    planTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    planBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: withAlpha(palette.signalBlue, 0.14),
    },
    planBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      color: palette.signalBlue,
    },
    planDetail: {
      fontSize: 13,
      color: palette.inkSecondary,
    },
    destructiveLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.danger,
    },
    signOutRow: {
      minHeight: minTouchSize,
      justifyContent: 'center',
    },
    signOutLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.danger,
    },
    signOutLabelDisabled: {
      opacity: 0.5,
    },
    deleteErrorText: {
      fontSize: 13,
      color: palette.danger,
      marginTop: spacing.xs,
    },
    devSection: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderStyle: 'dashed',
      borderTopColor: palette.hairline,
      gap: spacing.xs,
    },
    devSectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
      textTransform: 'uppercase',
    },
    devRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
    },
    devRowLabel: {
      fontSize: 15,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
  });
}
