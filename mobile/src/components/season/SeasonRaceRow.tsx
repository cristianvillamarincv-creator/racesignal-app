import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AchievementBadge } from '@/components/AchievementBadge';
import { Badge } from '@/components/Badge';
import type { Race } from '@/fixtures/races';
import { formatRaceDate } from '@/lib/format';
import type { Highlight } from '@/lib/highlights';
import { colors, spacing, typography } from '@/lib/theme';

const STATUS_LABEL: Record<Race['status'], string> = {
  considering: 'Considering',
  registered: 'Registered',
  completed: 'Completed',
};

interface SeasonRaceRowProps {
  race: Race;
  /** Pre-selected (most-meaningful-first, capped) by the caller — see lib/highlights.ts. */
  highlights: Highlight[];
  onPress: () => void;
}

export function SeasonRaceRow({ race, highlights, onPress }: SeasonRaceRowProps) {
  const dateDisplay = formatRaceDate(race.eventDate);
  const showLock = race.status === 'completed' && race.locked;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${race.name}, ${STATUS_LABEL[race.status]}, ${race.location}${
        showLock ? ', locked, Premium required for full detail' : ''
      }`}
      style={styles.row}>
      <View style={styles.dateBlock}>
        {dateDisplay.precision === 'year' ? (
          <Text style={styles.dateYear}>{dateDisplay.year}</Text>
        ) : (
          <>
            <Text style={styles.dateMonth}>{dateDisplay.month}</Text>
            <Text style={styles.dateDay}>{dateDisplay.day}</Text>
          </>
        )}
      </View>
      <View style={styles.details}>
        <Text style={styles.name}>{race.name}</Text>
        <Text style={styles.location}>
          {race.location} · {STATUS_LABEL[race.status]}
        </Text>
        {highlights.length > 0 ? (
          <View style={styles.badgeRow}>
            {highlights.map((highlight) => (
              <AchievementBadge key={highlight.label} achievement={highlight} />
            ))}
          </View>
        ) : null}
      </View>
      {showLock ? <Badge label="🔒" tone="warning" /> : <Badge label={race.distanceLabel} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dateBlock: {
    width: 44,
    alignItems: 'center',
  },
  dateMonth: {
    ...typography.label,
  },
  dateDay: {
    ...typography.title,
  },
  dateYear: {
    ...typography.subtitle,
  },
  details: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.subtitle,
  },
  location: {
    ...typography.caption,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
