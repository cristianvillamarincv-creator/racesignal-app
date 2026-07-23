import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing } from '@/lib/theme';

interface FloatingActionButtonProps {
  onPress: () => void;
  label?: string;
}

export function FloatingActionButton({ onPress, label = 'Signal' }: FloatingActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Send a ${label}`}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}>
      <Text style={styles.plus}>+</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pressed: {
    opacity: 0.85,
  },
  plus: {
    color: colors.background,
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '700',
  },
});
