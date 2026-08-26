import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AchievementBadge } from '@/components/AchievementBadge';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import type { Race } from '@/fixtures/races';
import { formatFinishTime, formatRaceDate } from '@/lib/format';
import type { Highlight } from '@/lib/highlights';
import { colors, spacing, typography } from '@/lib/theme';

interface RaceHistoryRowProps {
  race: Race;
  /** Pre-selected (most-meaningful-first, capped) by the caller — see lib/highlights.ts. */
  highlights: Highlight[];
  onPress: () => void;
}

export function RaceHistoryRow({ race, highlights, onPress }: RaceHistoryRowProps) {
  const result = race.result;
  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        race.locked
          ? `${race.name}, locked, Premium required to view full result`
          : `${race.name}, ${result ? formatFinishTime(result.finishSeconds) : ''}`
      }>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={typography.label}>
            {race.sport.toUpperCase()} · {race.distanceLabel}
          </Text>
          {race.locked ? <Badge label="🔒" tone="warning" /> : null}
        </View>
        <Text style={styles.name}>{race.name}</Text>
        {result ? <Text style={styles.finishTime}>{formatFinishTime(result.finishSeconds)}</Text> : null}
        <Text style={styles.meta}>
          {dateLabel} · {race.location}
        </Text>

        {!race.locked && highlights.length > 0 ? (
          <View style={styles.badgeRow}>
            {highlights.map((highlight) => (
              <AchievementBadge key={highlight.label} achievement={highlight} />
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    ...typography.subtitle,
  },
  finishTime: {
    ...typography.title,
    color: colors.accent,
  },
  meta: {
    ...typography.caption,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
