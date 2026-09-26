import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { AchievementPill } from '@/components/AchievementPill';
import type { Highlight } from '@/lib/highlights';
import { AppIcon } from '@/lib/icons';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
import { minTouchSize, spacing } from '@/lib/theme';

interface HighlightCardProps {
  highlight: Highlight;
  onPress: () => void;
}

/**
 * A single "Racing Moments" row — editorial and compact, not a giant rounded card per item. A
 * prior pass gave each item its own bordered/tinted rounded surface, which read as a heavy,
 * generic "dashboard card stack" on physical device — this drops the per-item container in favor
 * of hairline rhythm (dividers between rows live in stats.tsx, matching the Record Board's own
 * row-separator pattern), while still reading richer than a plain Personal Bests row: the
 * `AchievementPill` sits as a genuine kicker above the race name (not squeezed onto one line with
 * it), generous vertical padding, and the pill's own gold accent still carries real visual weight.
 * No gradient/glow, no enclosing card — just spacing, hierarchy, and one earned-achievement pill.
 */
export function HighlightCard({ highlight, onPress }: HighlightCardProps) {
  const { race, icon, label, value } = highlight;
  const year = race.eventDate.slice(0, 4);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const pillColors = {
    gold: palette.medalGold,
    goldFill: palette.medalGoldFill,
    onGold: palette.onMedalGold,
    inkSecondary: palette.inkSecondary,
    hairline: palette.hairline,
    canvasElevated: palette.canvasElevated,
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? `, ${value}` : ''}, ${race.name}, ${year}`}
      style={styles.row}>
      <View style={styles.body}>
        <AchievementPill icon={icon} label={label} variant="secondary" colors={pillColors} />
        <Text style={styles.raceName} numberOfLines={1}>
          {race.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.year}>{year}</Text>
          {value ? <Text style={styles.value}>{value}</Text> : null}
        </View>
      </View>
      <AppIcon name="chevron-right" size={16} color={palette.inkSecondary} />
    </Pressable>
  );
}

interface Styles {
  row: ViewStyle;
  body: ViewStyle;
  raceName: TextStyle;
  metaRow: ViewStyle;
  year: TextStyle;
  value: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: minTouchSize,
      paddingVertical: spacing.md,
    },
    body: {
      flex: 1,
      gap: spacing.xs,
    },
    raceName: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.ink,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.sm,
    },
    year: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    value: {
      fontSize: 13,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
  });
}
