import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import type { Race } from '@/fixtures/races';
import { daysUntil, formatCountdown } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface RaceCountdownCardProps {
  race: Race;
  onOpenRace: () => void;
  actionLabel?: string;
}

/**
 * The next-race hero — countdown + event info. The whole card is one tap target into that race's
 * own detail screen (not just the "Open race prep" pill) — physical-device testing showed reaching
 * for that small pill specifically, inside an otherwise inert card, felt fiddly. The pill stays as
 * a visual affordance only, no longer its own touchable. No preparation-progress bar here: it used
 * to show a percentage from a static, non-persisted checklist fixture, identical regardless of
 * which race or what the athlete had actually done — removed as unfinished filler (see
 * race/[id].tsx, which now has a real persisted Race Prep checklist instead).
 */
export function RaceCountdownCard({ race, onOpenRace, actionLabel = 'Open race prep' }: RaceCountdownCardProps) {
  const countdownLabel = formatCountdown(daysUntil(race.eventDate));

  return (
    <Pressable
      onPress={onOpenRace}
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel}: ${race.name}`}
      style={({ pressed }) => pressed && styles.cardPressed}>
      <Card>
        <Text style={typography.label}>
          {race.status === 'registered' ? 'YOUR NEXT RACE' : 'CONSIDERING'}
        </Text>
        <Text style={styles.raceName}>{race.name}</Text>
        <Text style={styles.countdown}>{countdownLabel}</Text>
        {race.location ? <Text style={styles.meta}>{race.location}</Text> : null}

        <View style={styles.footerRow}>
          <View style={styles.openButton}>
            <Text style={styles.openButtonLabel}>{actionLabel}</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardPressed: {
    opacity: 0.85,
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
  meta: {
    ...typography.caption,
    marginTop: spacing.xs,
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
  openButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
});
