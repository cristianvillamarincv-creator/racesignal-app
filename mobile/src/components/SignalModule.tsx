import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RaceLineMotif } from '@/components/RaceLineMotif';
import { SignalMark } from '@/components/SignalMark';
import { AppIcon } from '@/lib/icons';

interface SignalModuleColors {
  ink: string;
  inkSecondary: string;
  signalBlue: string;
  surfaceTint: string;
  /** The icon badge's own fill — kept a bit stronger than `borderTint` so the badge stays clearly
   *  visible even when the card's outline is very subtle. */
  badgeTint: string;
  /** The card's outline — deliberately weaker than `badgeTint` (see the Light-mode refinement:
   *  the tinted surface should carry the component, not a heavy border). */
  borderTint: string;
  onSignalBlue: string;
}

interface SignalModuleProps {
  title: string;
  supportingText: string;
  onPress: () => void;
  colors: SignalModuleColors;
}

/**
 * RaceSignal's distinctive entry point into Signal from a race's detail screen — deliberately built
 * as a real, proprietary-feeling component rather than a plain text link, so it reads as a
 * RaceSignal feature rather than a generic "ask AI" affordance. A restrained race-line/timing-signal
 * motif sits behind the content at very low opacity (tinted to signalBlue, the one interactive
 * color) — no gradients, glow, sparkles, or robot/AI iconography anywhere.
 */
export function SignalModule({ title, supportingText, onPress, colors }: SignalModuleProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Ask Signal about this race"
      style={[styles.container, { backgroundColor: colors.surfaceTint, borderColor: colors.borderTint }]}>
      <RaceLineMotif tintColor={colors.signalBlue} opacity={0.07} style={styles.motif} />
      <View style={[styles.iconBadge, { backgroundColor: colors.badgeTint }]}>
        {/* 24 of the badge's 36pt width — the mark's own asset fills ~84% of its canvas
            (bbox-normalized, not the full nominal square), so this lands the visible ink at
            roughly 56% of the badge width, matching the target ~55-65% range. */}
        <SignalMark color={colors.signalBlue} size={24} />
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.supporting, { color: colors.inkSecondary }]}>{supportingText}</Text>
      </View>
      <View style={[styles.ctaCircle, { backgroundColor: colors.signalBlue }]}>
        <AppIcon name="arrow-right" size={16} color={colors.onSignalBlue} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  motif: {
    borderRadius: 18,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  supporting: {
    fontSize: 13,
    lineHeight: 17,
  },
  ctaCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
