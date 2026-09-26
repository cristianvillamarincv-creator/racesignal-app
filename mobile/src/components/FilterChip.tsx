import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Shared filter-selector styling for Races and Stats filter rows — one look, not two near-identical
 *  ones. A compact TEXT-based selector, not a chip/pill/box: no border or fill is ever drawn, in
 *  either state. Unselected reads as a plain, unweighted `inkSecondary` label; the selected state is
 *  communicated purely through weight/color (bold `signalBlue`) plus a thin underline beneath just
 *  that label — the underline track is always present (transparent when unselected) so toggling
 *  selection never shifts the row's height. The visual text sits in a small footprint, but the
 *  tappable area is held at the ~44pt minimum via `hitSlop`, same as before. */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  const palette = useBrandPalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label}`}
      accessibilityState={{ selected }}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      style={styles.touchTarget}>
      <Text style={[styles.label, { color: palette.inkSecondary }, selected && { color: palette.signalBlue, fontWeight: '700' }]}>{label}</Text>
      <View style={[styles.underline, { backgroundColor: selected ? palette.signalBlue : 'transparent' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    minHeight: 24,
    paddingHorizontal: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '400',
  },
  underline: {
    marginTop: 3,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
  },
});
