import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import type { SignalUsagePayload } from '@/lib/signal';
import { buildAllowanceCardContent, EXPLORE_PREMIUM_LABEL } from '@/lib/signalUsage';
import { minTouchSize } from '@/lib/theme';

/**
 * The Signal tab's one allowance card (it replaces a separate allowance line and a separate promotional card). It shows only what the
 * server has confirmed, so it renders nothing while usage is unknown. Free athletes get the heading, their remaining count (or the used-up
 * message), what Premium includes, and "Explore Premium"; Premium athletes get their monthly count and the reset date and time in the
 * phone's timezone, with no heading and no action. Content-driven height: text wraps and the card grows at larger text sizes.
 *
 * Locked metrics: 16pt padding and corners, 18pt semibold heading, 14pt/20pt secondary body, 8pt heading to body, 12pt body to action,
 * 44pt minimum action target. The 16pt gap above and 24pt gap below the card are set by the screen that places it.
 */
export function SignalAllowanceCard({
  usage,
  onExplorePremium,
  resetFormat,
}: {
  usage: SignalUsagePayload | null;
  onExplorePremium: () => void;
  /** Test hook: pins the locale and timezone the reset line is rendered in. */
  resetFormat?: { locale?: string; timeZone?: string };
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const content = buildAllowanceCardContent(usage, resetFormat);
  if (!content) return null;

  return (
    <View style={styles.card} testID="signal-allowance-card">
      {content.heading ? (
        <Text style={styles.heading} accessibilityRole="header">
          {content.heading}
        </Text>
      ) : null}
      <View style={content.heading ? styles.bodyAfterHeading : undefined}>
        <Text style={content.heading ? styles.body : styles.bodyPrimary}>{content.status}</Text>
        {content.support ? (
          <Text style={styles.body} accessibilityLabel={content.supportAccessibilityLabel}>
            {content.support}
          </Text>
        ) : null}
      </View>
      {content.showAction ? (
        <Pressable onPress={onExplorePremium} accessibilityRole="button" accessibilityLabel={EXPLORE_PREMIUM_LABEL} style={styles.cta}>
          <Text style={styles.ctaLabel}>{EXPLORE_PREMIUM_LABEL}</Text>
          <AppIcon name="chevron-right" size={16} color={palette.signalBlue} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface Styles {
  card: ViewStyle;
  heading: TextStyle;
  bodyAfterHeading: ViewStyle;
  body: TextStyle;
  bodyPrimary: TextStyle;
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
    // Premium has no heading, so the count itself leads in the primary ink.
    bodyPrimary: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20,
      color: palette.ink,
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
