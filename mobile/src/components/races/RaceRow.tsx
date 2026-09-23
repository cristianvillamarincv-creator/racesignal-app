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

interface RaceRowProps {
  race: Race;
  /** Pre-selected (most-meaningful, single) by the caller — see lib/highlights.ts's
   *  pickPrimaryHighlight. undefined renders as empty space, not a missing row. */
  primaryHighlight: Highlight | undefined;
  onPress: () => void;
  /** Suppresses the divider below the last row in a card, so it doesn't double up against the
   *  card's own bottom edge. */
  isLast?: boolean;
}

/**
 * A completed race reads as an accomplishment, not a database row: the AchievementBadge pill
 * (already champagne-colored for a trophy/medal highlight) is the row's only achievement signal —
 * no extra row-level rail/accent on top of it, so gold stays reserved for that one meaning instead
 * of doubling up into something that reads like a timeline down the list. At most one badge shows
 * per row (Races is a browse surface, not a second Stats screen) in a fixed-height slot, so a race
 * with several highlights doesn't grow taller than one with none — every row in a card lines up.
 */
export function RaceRow({ race, primaryHighlight, onPress, isLast = false }: RaceRowProps) {
  const dateDisplay = formatRaceDate(race.eventDate);
  const showLock = race.status === 'completed' && race.locked;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${race.name}, ${STATUS_LABEL[race.status]}, ${race.location}${
        showLock ? ', locked, Premium required for full detail' : ''
      }`}
      style={[styles.row, !isLast && styles.rowDivider]}>
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
        <Text style={styles.name} numberOfLines={1}>
          {race.name}
        </Text>
        <Text style={styles.location} numberOfLines={1}>
          {race.location} · {STATUS_LABEL[race.status]}
        </Text>
        <View style={styles.badgeSlot}>
          {primaryHighlight ? <AchievementBadge achievement={primaryHighlight} /> : null}
        </View>
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
    paddingVertical: spacing.sm,
  },
  rowDivider: {
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
  badgeSlot: {
    height: 24,
    marginTop: spacing.xs,
    justifyContent: 'center',
  },
});
