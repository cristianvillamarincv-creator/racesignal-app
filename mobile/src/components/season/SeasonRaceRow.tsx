import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import type { Race } from '@/fixtures/races';
import { colors, spacing, typography } from '@/lib/theme';

const STATUS_LABEL: Record<Race['status'], string> = {
  considering: 'Considering',
  registered: 'Registered',
  completed: 'Completed',
};

interface SeasonRaceRowProps {
  race: Race;
  onPress: () => void;
}

export function SeasonRaceRow({ race, onPress }: SeasonRaceRowProps) {
  const eventDate = new Date(`${race.eventDate}T00:00:00`);
  const month = eventDate.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  const day = eventDate.getDate();
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
        <Text style={styles.dateMonth}>{month}</Text>
        <Text style={styles.dateDay}>{day}</Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.name}>{race.name}</Text>
        <Text style={styles.location}>
          {race.location} · {STATUS_LABEL[race.status]}
        </Text>
      </View>
      {showLock ? <Badge label="🔒 Premium" tone="warning" /> : <Badge label={race.distanceLabel} />}
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
});
