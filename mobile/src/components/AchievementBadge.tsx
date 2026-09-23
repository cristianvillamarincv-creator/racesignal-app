import { StyleSheet, Text, View } from 'react-native';

import type { Highlight } from '@/lib/highlights';
import { AppIcon } from '@/lib/icons';
import { colors, radii, spacing, typography } from '@/lib/theme';

interface AchievementBadgeProps {
  achievement: Highlight;
}

/**
 * One consistent visual language for "something notable happened here" — used in Races rows and
 * Result detail's top highlights. Icon + label only; the achievement's
 * `value` (if any) is for contexts like Stats' Highlight cards where no finish time is already
 * shown elsewhere on screen.
 */
export function AchievementBadge({ achievement }: AchievementBadgeProps) {
  return (
    <View style={styles.badge} accessibilityLabel={achievement.label}>
      <AppIcon name={achievement.icon} size={13} color={colors.achievement} />
      <Text style={styles.label} numberOfLines={1}>
        {achievement.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
