import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import type { SignalUsagePayload } from '@/lib/signal';
import { buildAllowanceCardContent, EXPLORE_PREMIUM_LABEL } from '@/lib/signalUsage';
import { minTouchSize } from '@/lib/theme';

/**
 * The Signal tab's one allowance card, for confirmed free athletes only (Premium athletes see their count in the conversation, beside
 * the composer; unknown usage shows nothing, so the plan and count are never guessed). It shows the heading, the remaining count (or the
 * used-up message), what Premium includes, and "Explore Premium". Content-driven height: text wraps and the card grows at larger text sizes.
 *
 * Locked metrics: 16pt padding and corners, 18pt semibold heading, 14pt/20pt secondary body, 8pt heading to body, 12pt body to action,
 * 44pt minimum action target. The 16pt gap above and 24pt gap below the card are set by the screen that places it.
 */
export function SignalAllowanceCard({ usage, onExplorePremium }: { usage: SignalUsagePayload | null; onExplorePremium: () => void }) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const content = buildAllowanceCardContent(usage);
  if (!content) return null;

  return (
    <View style={styles.card} testID="signal-allowance-card">
      <Text style={styles.heading} accessibilityRole="header">
        {content.heading}
      </Text>
      <View style={styles.bodyAfterHeading}>
        <Text style={styles.body}>{content.status}</Text>
        <Text style={styles.body}>{content.support}</Text>
      </View>
      <Pressable onPress={onExplorePremium} accessibilityRole="button" accessibilityLabel={EXPLORE_PREMIUM_LABEL} style={styles.cta}>
        <Text style={styles.ctaLabel}>{EXPLORE_PREMIUM_LABEL}</Text>
        <AppIcon name="chevron-right" size={16} color={palette.signalBlue} />
      </Pressable>
    </View>
  );
}

interface Styles {
  card: ViewStyle;
  heading: TextStyle;
  bodyAfterHeading: ViewStyle;
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
      padding: 16,
    },
    heading: {
      fontSize: 18,
      fontWeight: '600',
      color: palette.ink,
    },
    bodyAfterHeading: {
      marginTop: 8,
    },
    body: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20,
      color: palette.inkSecondary,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      minHeight: minTouchSize,
      marginTop: 12,
    },
    ctaLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.signalBlue,
    },
  });
}
