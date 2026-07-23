import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/lib/theme';

export type BadgeTone = 'neutral' | 'accent' | 'warning' | 'danger';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

const toneColors: Record<BadgeTone, { background: string; text: string }> = {
  neutral: { background: colors.surfaceElevated, text: colors.textSecondary },
  accent: { background: colors.accentMuted, text: colors.accent },
  warning: { background: '#3A3020', text: colors.warning },
  danger: { background: '#3A2422', text: colors.danger },
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const palette = toneColors[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: palette.background }]}
      accessibilityLabel={label}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.label,
  },
});
