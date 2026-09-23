import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { useAppPhase } from '@/lib/appPhase';
import { useAuth } from '@/lib/auth';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

const PLACEHOLDER_ROWS = ['Privacy', 'Subscription', 'Support', 'Blocked Users'];

export default function SettingsScreen() {
  const router = useRouter();
  const { resetToOnboarding } = useAppPhase();
  const { session, signOut } = useAuth();
  const { racingName } = useAthleteRaces();
  const displayName = racingName ?? session?.user.email ?? 'Athlete';
  const [isSigningOut, setIsSigningOut] = useState(false);

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

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Card style={styles.profileCard}>
          <Avatar initials={initialsFor(displayName)} size={56} />
          <View style={styles.profileText}>
            <Text style={typography.subtitle}>{displayName}</Text>
            {session?.user.email ? <Text style={styles.profileMeta}>{session.user.email}</Text> : null}
          </View>
        </Card>

        <View style={styles.section}>
          <SectionHeader title="Race history" />
          <Pressable
            onPress={() => router.push('/race/add')}
            accessibilityRole="button"
            accessibilityLabel="Add a race manually"
            style={styles.actionRow}>
            <Text style={styles.actionLabel}>Add a race manually</Text>
            <Text style={styles.actionArrow}>→</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/find-races')}
            accessibilityRole="button"
            accessibilityLabel="Find my races"
            style={styles.actionRow}>
            <Text style={styles.actionLabel}>Find my races</Text>
            <Text style={styles.actionArrow}>→</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Pressable
            onPress={handleSignOut}
            disabled={isSigningOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={[styles.actionRow, isSigningOut && styles.actionRowDisabled]}>
            <Text style={styles.signOutLabel}>{isSigningOut ? 'Signing out…' : 'Sign out'}</Text>
          </Pressable>
        </View>

        <View style={styles.rows}>
          {PLACEHOLDER_ROWS.map((row) => (
            <View
              key={row}
              style={styles.row}
              accessibilityRole="text"
              accessibilityLabel={`${row}, coming soon`}>
              <Text style={typography.body}>{row}</Text>
              <Text style={styles.comingSoon}>Coming soon</Text>
            </View>
          ))}
        </View>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileText: {
    gap: 2,
  },
  profileMeta: {
    ...typography.caption,
  },
  section: {
    gap: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  signOutLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.danger,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
  actionArrow: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
  rows: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  comingSoon: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
