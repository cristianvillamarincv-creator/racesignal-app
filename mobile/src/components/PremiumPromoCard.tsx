import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import { EXPLORE_PREMIUM_LABEL, PREMIUM_PROMO_BODY, PREMIUM_PROMO_HEADING } from '@/lib/signalUsage';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * One compact Premium card for confirmed free athletes on the Signal tab: the existing elevated-surface card treatment, the primary
 * ink for the heading, secondary ink for the body, and a signal-blue action. No imagery, no carousel. It is deliberately quieter than
 * the "Ask Signal anything" action above it, so asking stays the primary thing on the screen. Only describes what Premium includes
 * today: more Signal asks each month.
 */
export function PremiumPromoCard({ onPress }: { onPress: () => void }) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.card} testID="premium-promo-card">
      <Text style={styles.heading} accessibilityRole="header">
        {PREMIUM_PROMO_HEADING}
      </Text>
      <Text style={styles.body}>{PREMIUM_PROMO_BODY}</Text>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={EXPLORE_PREMIUM_LABEL} style={styles.cta}>
        <Text style={styles.ctaLabel}>{EXPLORE_PREMIUM_LABEL}</Text>
        <AppIcon name="chevron-right" size={16} color={palette.signalBlue} />
      </Pressable>
    </View>
  );
}

interface Styles {
  card: ViewStyle;
  heading: TextStyle;
  body: TextStyle;
  cta: ViewStyle;
  ctaLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    card: {
      backgroundColor: palette.canvasElevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: palette.hairline,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    heading: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: palette.inkSecondary,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: minTouchSize,
      alignSelf: 'flex-start',
    },
    ctaLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: palette.signalBlue,
    },
  });
}
