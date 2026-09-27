import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { HairlineRule } from '@/components/HairlineRule';
import { SectionHeader } from '@/components/SectionHeader';
import { useAppPhase } from '@/lib/appPhase';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { deleteAccount } from '@/lib/deleteAccount';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import { AppIcon } from '@/lib/icons';
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_USE_URL } from '@/lib/legalLinks';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

// Subscription (Step 8 RevenueCat work) and Blocked Users (not a genuine V1 requirement) stay
// fully hidden until they're real. Privacy/Support each become a real functioning link the moment
// their URL is filled in (lib/legalLinks.ts) — until then they fall back to the same visibly
// subdued, clearly non-interactive InertRow used since Step 6, rather than reading as broken.
const ACCOUNT_ROWS: { label: string; url: string }[] = [
  { label: 'Privacy', url: PRIVACY_POLICY_URL },
  { label: 'Terms of Use', url: TERMS_OF_USE_URL },
  { label: 'Support', url: SUPPORT_URL },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { resetToOnboarding } = useAppPhase();
  const { session, signOut } = useAuth();
  const { racingName } = useAthleteRaces();
  const displayName = racingName ?? session?.user.email ?? 'Athlete';
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { enterOnboardingReplayFromSettings } = useDevPreview();
  const showDevTools = isDevPreviewAvailable();

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      resetToOnboarding();
    } catch (err) {
      console.warn('[Settings] sign out failed:', err);
      setIsSigningOut(false);
    }
  }

  async function handleDeleteAccountConfirmed() {
    if (isDeletingAccount) return;
    setIsDeletingAccount(true);
    setDeleteError(null);
    const result = await deleteAccount();
    if (!result.available) {
      console.warn('[Settings] account deletion failed:', result.reason);
      setDeleteError('Something went wrong deleting your account. Please try again.');
      setIsDeletingAccount(false);
      return;
    }
    // The server-side account is gone; clear the local session/state the same way sign-out does
    // so the app returns to a genuinely signed-out state regardless of what supabase-js's own
    // client-side session cache still holds.
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
      'This permanently deletes your RaceSignal account and all of your race history, Signal conversations, and account data. This can’t be undone.',
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
          <SectionHeader title="Account" />
          <HairlineRule color={palette.hairline} />
          {ACCOUNT_ROWS.map((row, index) => (
            <View key={row.label}>
              {row.url ? (
                <ActionRow label={row.label} onPress={() => Linking.openURL(row.url)} styles={styles} palette={palette} />
              ) : (
                <InertRow label={row.label} styles={styles} />
              )}
              {index < ACCOUNT_ROWS.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
            </View>
          ))}
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

        {/* Delete account — Apple 5.1.1(v): account creation requires an in-app path to delete
            it, not merely sign out. Kept as its own quiet destructive row (same visual language
            as Sign out, not a heavier button) but clearly separate from it, with an explicit
            destructive confirmation before anything happens. */}
        <View>
          <Pressable
            onPress={handleDeleteAccountPress}
            disabled={isDeletingAccount}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            style={styles.signOutRow}>
            <Text style={[styles.signOutLabel, isDeletingAccount && styles.signOutLabelDisabled]}>
              {isDeletingAccount ? 'Deleting account…' : 'Delete account'}
            </Text>
          </Pressable>
          {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}
        </View>

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
  onPress,
  styles,
  palette,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  palette: BrandPalette;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.actionRow}>
      <Text style={styles.actionLabel}>{label}</Text>
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

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  identity: ViewStyle;
  identityName: TextStyle;
  identityEmail: TextStyle;
  section: ViewStyle;
  actionRow: ViewStyle;
  actionLabel: TextStyle;
  inertRow: ViewStyle;
  inertLabel: TextStyle;
  inertValue: TextStyle;
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
