import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RaceLineMotif } from '@/components/RaceLineMotif';
import type { Race } from '@/fixtures/races';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
import { daysUntil, formatRaceDate } from '@/lib/format';
import { spacing } from '@/lib/theme';

interface RaceCountdownCardProps {
  race: Race;
  onOpenRace: () => void;
  actionLabel?: string;
}

/** Joins meta parts (location, date) with " · ", skipping any that are missing/blank. */
function joinMeta(parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => !!part && part.trim().length > 0).join(' · ');
}

/**
 * The next-race hero — composed the same way results/[id].tsx opens its own race: a small kicker,
 * the race name at title scale, then one dominant countdown number carrying the hierarchy (not a
 * small colored digit inside a boxed dashboard widget). No card surface/border/elevation anymore
 * — this sits directly on canvas, matching the north-star screen's editorial whitespace instead of
 * a "widget." A RaceLineMotif sits very faintly behind the block, the same device results/[id].tsx
 * uses behind its own hero. The whole surface stays one tap target into the race's own detail
 * screen — the text link at the bottom is a visual affordance only, not a second touchable, so
 * there's exactly one action here, never a button wall.
 */
export function RaceCountdownCard({ race, onOpenRace, actionLabel = 'Open race prep' }: RaceCountdownCardProps) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const days = daysUntil(race.eventDate);
  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;

  return (
    <Pressable
      onPress={onOpenRace}
      accessibilityRole="button"
      accessibilityLabel={`${actionLabel}: ${race.name}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <RaceLineMotif tintColor={palette.ink} opacity={0.04} style={{ left: '30%' }} />
      <Text style={styles.kicker}>{race.status === 'registered' ? 'YOUR NEXT RACE' : 'CONSIDERING'}</Text>
      <Text style={styles.raceName} numberOfLines={2}>
        {race.name}
      </Text>

      <View style={styles.hero}>
        {days > 1 ? (
          <>
            <Text style={styles.heroNumber}>{days}</Text>
            <Text style={styles.heroUnit}>days to go</Text>
          </>
        ) : (
          <Text style={styles.heroWord}>{days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'Completed'}</Text>
        )}
      </View>

      <Text style={styles.meta}>{joinMeta([race.location, dateLabel])}</Text>

      <Text style={styles.action}>{actionLabel} ›</Text>
    </Pressable>
  );
}

function createStyles(palette: BrandPalette) {
  return StyleSheet.create({
    card: {
      position: 'relative',
      overflow: 'hidden',
      // A touch more room top/bottom than a mid-list row would get — this is meant to read as a
      // deliberately composed hero moment, not a compact list item, even without a card surface.
      paddingVertical: spacing.md,
    },
    cardPressed: {
      opacity: 0.7,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    raceName: {
      fontSize: 24,
      fontWeight: '700',
      color: palette.ink,
      marginTop: spacing.xs,
    },
    hero: {
      marginTop: spacing.lg,
    },
    heroNumber: {
      fontSize: 56,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    heroUnit: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.inkSecondary,
      marginTop: -spacing.xs,
    },
    heroWord: {
      fontSize: 40,
      fontWeight: '700',
      color: palette.ink,
    },
    meta: {
      fontSize: 14,
      color: palette.inkSecondary,
      marginTop: spacing.sm,
    },
    action: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.signalBlue,
      marginTop: spacing.lg,
    },
  });
}
