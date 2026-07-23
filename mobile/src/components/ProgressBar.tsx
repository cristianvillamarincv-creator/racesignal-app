import { StyleSheet, View } from 'react-native';

import { colors, radii } from '@/lib/theme';

interface ProgressBarProps {
  percent: number;
  accessibilityLabel?: string;
}

export function ProgressBar({ percent, accessibilityLabel }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? `${clamped}% complete`}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}>
      <View style={[styles.fill, { width: `${clamped}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
