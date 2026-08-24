import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { athlete } from '@/fixtures/athlete';
import { useOnboarding } from '@/lib/onboarding';
import { colors, spacing, typography } from '@/lib/theme';

const PLACEHOLDER_ROWS = ['Privacy', 'Subscription', 'Support', 'Blocked Users'];

export default function SettingsScreen() {
  const { replayOnboarding } = useOnboarding();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profileCard}>
          <Avatar initials={athlete.avatarInitials} size={56} />
          <View style={styles.profileText}>
            <Text style={typography.subtitle}>{athlete.displayName}</Text>
            <Text style={styles.profileMeta}>
              {capitalize(athlete.primarySport)} · {athlete.unitSystem === 'metric' ? 'Metric' : 'Imperial'}
            </Text>
          </View>
        </Card>

        <View style={styles.section}>
          <SectionHeader title="Race history" />
          <Pressable
            onPress={replayOnboarding}
            accessibilityRole="button"
            accessibilityLabel="Replay race-history setup"
            style={styles.actionRow}>
            <Text style={styles.actionLabel}>Replay race-history setup</Text>
            <Text style={styles.actionArrow}>→</Text>
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
