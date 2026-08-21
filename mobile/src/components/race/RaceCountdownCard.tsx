import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import type { Race } from '@/fixtures/races';
import { daysUntil, formatCountdown } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface RaceCountdownCardProps {
  race: Race;
  checklistPercent: number;
  onOpenRace: () => void;
  actionLabel?: string;
  /** Cosmetic-only Premium hint for a secondary active race — never blocks navigation. */
  showPremiumBadge?: boolean;
}

export function RaceCountdownCard({
  race,
  checklistPercent,
  onOpenRace,
  actionLabel = 'Open race prep',
  showPremiumBadge = false,
}: RaceCountdownCardProps) {
  const countdownLabel = formatCountdown(daysUntil(race.eventDate));

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text style={typography.label}>
          {race.status === 'registered' ? 'YOUR NEXT RACE' : 'CONSIDERING'}
        </Text>
        {showPremiumBadge ? <Badge label="🔒 Premium" tone="warning" /> : null}
      </View>
      <Text style={styles.raceName}>{race.name}</Text>
      <Text style={styles.countdown}>{countdownLabel}</Text>

      <View style={styles.progressRow}>
        <ProgressBar
          percent={checklistPercent}
          accessibilityLabel={`Preparation ${checklistPercent}% complete`}
        />
        <Text style={styles.progressLabel}>Preparation: {checklistPercent}%</Text>
      </View>

      <View style={styles.footerRow}>
        <Pressable
          onPress={onOpenRace}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}: ${race.name}`}
          style={({ pressed }) => [styles.openButton, pressed && styles.openButtonPressed]}>
          <Text style={styles.openButtonLabel}>{actionLabel}</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  raceName: {
    ...typography.title,
    marginTop: spacing.xs,
  },
  countdown: {
    ...typography.display,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  progressRow: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  progressLabel: {
    ...typography.caption,
  },
  footerRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  openButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
  },
  openButtonPressed: {
    opacity: 0.8,
  },
  openButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
});
