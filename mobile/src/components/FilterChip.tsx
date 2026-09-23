import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/lib/theme';

interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Shared chip styling for Races and Stats filter rows — one look, not two near-identical ones. */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label}`}
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.accent,
  },
});
