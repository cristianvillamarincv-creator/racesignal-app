import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { AchievementPill } from '@/components/AchievementPill';
import type { Race } from '@/fixtures/races';
import { formatRaceDate } from '@/lib/format';
import type { Highlight } from '@/lib/highlights';
import { AppIcon } from '@/lib/icons';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
import { spacing } from '@/lib/theme';

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
  /** Suppresses the divider below the last row in a group, so it doesn't double up against the
   *  group's own bottom edge. */
  isLast?: boolean;
}

/**
 * A completed race reads as an accomplishment, not a database row: the AchievementPill (secondary
 * variant, gold-on-quiet) is the row's only achievement signal — no extra row-level rail/accent on
 * top of it, so gold stays reserved for that one meaning instead of doubling up into something that
 * reads like a timeline down the list. At most one pill shows per row (Races is a browse surface,
 * not a second Stats screen). The pill slot is only rendered at all when there's a highlight to
 * show — a fixed-height reserved slot for the common no-achievement case left a visible dead gap
 * under the location line; height is content-driven instead, so a row with a highlight naturally
 * grows a little taller than one without, rather than every row being forced to the same height.
 *
 * Reading order matches results/[id].tsx's own hierarchy — date, then race identity, then
 * result/category — but the date column is deliberately quieter (smaller, inkSecondary) than the
 * race name (bolder, ink) so identity reads as the strongest thing in the row, not the date. A
 * completed row drops the "Completed" status suffix entirely: the year divider and the Completed
 * section header above it already say that once, so repeating it per row was redundant noise —
 * only upcoming rows (which mix Registered/Considering under one Upcoming header) still need it.
 */
export function RaceRow({ race, primaryHighlight, onPress, isLast = false }: RaceRowProps) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const dateDisplay = formatRaceDate(race.eventDate);
  const showLock = race.status === 'completed' && race.locked;
  const metaLine = race.status === 'completed' ? race.location : `${race.location} · ${STATUS_LABEL[race.status]}`;

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
          {metaLine}
        </Text>
        {primaryHighlight ? (
          <View style={styles.pillSlot}>
            <AchievementPill
              icon={primaryHighlight.icon}
              label={primaryHighlight.label}
              variant="secondary"
              colors={{
                gold: palette.medalGold,
                goldFill: palette.medalGoldFill,
                onGold: palette.onMedalGold,
                inkSecondary: palette.inkSecondary,
                hairline: palette.hairline,
                canvasElevated: palette.canvasElevated,
              }}
            />
          </View>
        ) : null}
      </View>
      {showLock ? (
        <AppIcon name="lock" size={18} color={palette.inkSecondary} />
      ) : (
        <Text style={styles.distanceLabel}>{race.distanceLabel}</Text>
      )}
    </Pressable>
  );
}

function createStyles(palette: BrandPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 44,
      paddingVertical: spacing.md,
    } as ViewStyle,
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.hairline,
    } as ViewStyle,
    dateBlock: {
      width: 40,
      alignItems: 'center',
    } as ViewStyle,
    dateMonth: {
      fontSize: 11,
      fontWeight: '600',
      color: palette.inkSecondary,
    } as TextStyle,
    dateDay: {
      fontSize: 17,
      fontWeight: '700',
      color: palette.inkSecondary,
      ...tabularNumerals,
    } as TextStyle,
    dateYear: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.inkSecondary,
      ...tabularNumerals,
    } as TextStyle,
    details: {
      flex: 1,
      gap: 3,
    } as ViewStyle,
    name: {
      fontSize: 18,
      fontWeight: '700',
      color: palette.ink,
    } as TextStyle,
    location: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
    } as TextStyle,
    pillSlot: {
      height: 24,
      marginTop: spacing.xs,
      justifyContent: 'center',
    } as ViewStyle,
    distanceLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.inkSecondary,
      ...tabularNumerals,
    } as TextStyle,
  });
}
