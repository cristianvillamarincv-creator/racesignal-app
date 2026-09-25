import { StyleSheet, Text, View } from 'react-native';

import { AppIcon, type IconName } from '@/lib/icons';

interface AchievementPillColors {
  /** Foreground gold — the icon color in both variants, and the secondary variant's fill-adjacent
   *  accent. Never used as the primary pill's own background (see `goldFill`). */
  gold: string;
  /** The primary (PR) pill's solid background — a brighter/warmer brass than `gold`, since a single
   *  gold value can't read well as both a filled pill and a small foreground icon. */
  goldFill: string;
  onGold: string;
  inkSecondary: string;
  hairline: string;
  canvasElevated: string;
}

interface AchievementPillProps {
  icon: IconName;
  label: string;
  /** `primary` (a current PR) gets a solid medal-gold fill with strong on-gold contrast — the
   *  single strongest visual moment on the screen after the hero time itself. `secondary` (anything
   *  else notable — an age-group percentile, a fastest split) stays clearly quieter: a neutral
   *  tinted fill with a thin hairline border, gold icon, ink-secondary label — visible, but never
   *  equal weight to the earned PR. Never a third generic variant — this component exists only for
   *  real, computed achievements (see highlights.ts), never as a general-purpose pill/chip
   *  container. */
  variant: 'primary' | 'secondary';
  colors: AchievementPillColors;
}

/**
 * A small "earned achievement" pill for quick-scan recognition directly under a race's hero result
 * — restored from the pre-redesign AchievementBadge because it's the fastest way to read "this race
 * mattered" at a glance, without the athlete having to read every stat.
 */
export function AchievementPill({ icon, label, variant, colors }: AchievementPillProps) {
  const isPrimary = variant === 'primary';
  return (
    <View
      style={[
        styles.pill,
        isPrimary
          ? { backgroundColor: colors.goldFill, borderColor: colors.goldFill }
          : { backgroundColor: colors.canvasElevated, borderColor: colors.hairline },
      ]}
      accessibilityLabel={label}>
      <AppIcon name={icon} size={13} color={isPrimary ? colors.onGold : colors.gold} />
      <Text style={[styles.label, { color: isPrimary ? colors.onGold : colors.inkSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
});
