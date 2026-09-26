import { StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

export type BadgeTone = 'neutral' | 'danger';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

/** A small pill for a distance/status chip — `neutral` reads as quiet metadata (a canvas-elevated
 *  fill with secondary ink text); `danger` is reserved for a genuinely blocking state. Recolored to
 *  the "Race Morning Precision" brand palette — the old flat theme.ts tones are gone. */
export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const palette = useBrandPalette();
  const toneColors: Record<BadgeTone, { background: string; text: string }> = {
    neutral: { background: palette.canvasElevated, text: palette.inkSecondary },
    danger: { background: palette.canvasElevated, text: palette.danger },
  };
  const resolved = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: resolved.background }]} accessibilityLabel={label}>
      <Text style={[styles.label, { color: resolved.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
