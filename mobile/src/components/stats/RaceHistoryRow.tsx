import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import type { Race } from '@/fixtures/races';
import { formatFinishTime } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

interface RaceHistoryRowProps {
  race: Race;
  onPress: () => void;
}

export function RaceHistoryRow({ race, onPress }: RaceHistoryRowProps) {
  const result = race.result;
  const eventDate = new Date(`${race.eventDate}T00:00:00`);
  const dateLabel = eventDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

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
          {race.locked ? <Badge label="🔒 Premium" tone="warning" /> : null}
        </View>
        <Text style={styles.name}>{race.name}</Text>
        {result ? <Text style={styles.finishTime}>{formatFinishTime(result.finishSeconds)}</Text> : null}
        <Text style={styles.meta}>
          {dateLabel} · {race.location}
        </Text>

        {!race.locked && result && result.achievements.length > 0 ? (
          <View style={styles.badgeRow}>
            {result.achievements.map((achievement) => (
              <Badge key={achievement} label={achievement} tone="accent" />
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
