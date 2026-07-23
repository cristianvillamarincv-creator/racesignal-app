import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import type { NextRace } from '@/fixtures/race';
import { daysUntil, formatCountdown } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface RaceCountdownCardProps {
  race: NextRace;
  checklistPercent: number;
  onOpenRace: () => void;
  actionLabel?: string;
}

export function RaceCountdownCard({
  race,
  checklistPercent,
  onOpenRace,
  actionLabel = 'Open race',
}: RaceCountdownCardProps) {
  const countdownLabel = formatCountdown(daysUntil(race.eventDate));

  return (
    <Card>
      <Text style={typography.label}>YOUR NEXT RACE</Text>
      <Text style={styles.raceName}>{race.name}</Text>
      <Text style={styles.countdown}>{countdownLabel}</Text>

      <View style={styles.progressRow}>
        <ProgressBar
          percent={checklistPercent}
          accessibilityLabel={`Checklist ${checklistPercent}% complete`}
        />
        <Text style={styles.progressLabel}>{checklistPercent}% ready</Text>
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.friendCount}>
          {race.friendCount > 0
            ? `${race.friendCount} friends racing or considering`
            : 'No friends signed up yet'}
        </Text>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  friendCount: {
    ...typography.caption,
    flexShrink: 1,
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
