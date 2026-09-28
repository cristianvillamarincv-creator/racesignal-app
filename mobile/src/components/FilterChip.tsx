import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { radii, spacing } from '@/lib/theme';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * A real pill/chip — bordered capsule, tinted + filled when selected — restored to match the
 * app's pre-"Race Morning Precision" filter treatment (see git history: this component circa the
 * Step 4 V1 UX pass, commit 301dbbc, itself carried over from the original Season tab). A later
 * Step 6 design-system pass (commit 5e2e956) quietly turned this into a borderless
 * text-plus-underline selector and, in the same pass, introduced CompactFilterBar — which hid
 * every non-active sport/year option behind a picker sheet instead of showing them as a row of
 * pills. Restored here on the CURRENT brand palette (useBrandPalette/withAlpha), not the old flat
 * `colors` token set, so it reads consistently with the rest of the redesigned app. Shared by both
 * Races and Stats (via FilterPillRows) so the two screens keep one identical filter treatment.
 */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label}`}
      accessibilityState={{ selected }}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(palette: BrandPalette) {
  return StyleSheet.create({
    chip: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      borderRadius: radii.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
    },
    chipSelected: {
      borderColor: palette.signalBlue,
      backgroundColor: withAlpha(palette.signalBlue, 0.1),
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    labelSelected: {
      color: palette.signalBlue,
      fontWeight: '700',
    },
  });
}
