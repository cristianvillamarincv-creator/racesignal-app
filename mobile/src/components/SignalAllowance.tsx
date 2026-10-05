import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import type { SignalUsagePayload } from '@/lib/signal';
import {
  EXHAUSTED_SUPPORT,
  EXPLORE_PREMIUM_LABEL,
  formatAllowanceHeadline,
  formatExhaustedHeadline,
  formatResetLine,
  isFreeExhausted,
  PREMIUM_INCLUDES_LINE,
} from '@/lib/signalUsage';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * The Signal allowance as the server reports it, in the compact two-line area above the conversation composer (null renders nothing:
 * unknown usage is never shown as a count). Free shows the remaining count and what Premium includes with an "Explore Premium" action;
 * a confirmed-exhausted free balance shows the exhausted message instead; Premium shows the monthly count and the reset date and time
 * in the phone's timezone, with no upgrade action. Text wraps and the action drops below it at larger text sizes; nothing has a fixed
 * height. (The Signal tab has its own single card: see SignalAllowanceCard.)
 */
export function SignalAllowance({
  usage,
  onExplorePremium,
  resetFormat,
}: {
  usage: SignalUsagePayload | null;
  onExplorePremium?: () => void;
  /** Test hook: pins the locale and timezone the reset line is rendered in. */
  resetFormat?: { locale?: string; timeZone?: string };
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  if (!usage) return null;

  const reset = usage.isPremium ? formatResetLine(usage.resetsAt, resetFormat) : null;
  const exhaustedFree = isFreeExhausted(usage);
  const headline = exhaustedFree ? formatExhaustedHeadline(usage) : formatAllowanceHeadline(usage);
  const support = exhaustedFree ? EXHAUSTED_SUPPORT : usage.isPremium ? (reset?.text ?? null) : PREMIUM_INCLUDES_LINE;
  const supportLabel = usage.isPremium ? reset?.accessibilityLabel : undefined;
  const showAction = !usage.isPremium && !!onExplorePremium;

  return (
    <View style={styles.strip} testID="signal-allowance-conversation">
      <View style={styles.textBlock}>
        <Text style={styles.stripHeadline}>{headline}</Text>
        {support ? (
          <Text style={styles.stripSupport} accessibilityLabel={supportLabel}>
            {support}
          </Text>
        ) : null}
      </View>
      {showAction ? (
        <Pressable onPress={onExplorePremium} accessibilityRole="button" accessibilityLabel={EXPLORE_PREMIUM_LABEL} hitSlop={6} style={styles.action}>
          <Text style={styles.actionLabel}>{EXPLORE_PREMIUM_LABEL}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface Styles {
  strip: ViewStyle;
  textBlock: ViewStyle;
  stripHeadline: TextStyle;
  stripSupport: TextStyle;
  action: ViewStyle;
  actionLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    // Compact, but never a fixed height: two lines of text plus the action wrap and grow with larger text sizes.
    strip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      columnGap: spacing.md,
      rowGap: spacing.xs,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 10,
      backgroundColor: withAlpha(palette.signalBlue, 0.08),
    },
    textBlock: {
      flexShrink: 1,
      flexGrow: 1,
      gap: 2,
    },
    stripHeadline: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.signalBlue,
    },
    stripSupport: {
      fontSize: 12,
      color: palette.inkSecondary,
    },
    action: {
      minHeight: minTouchSize,
      justifyContent: 'center',
    },
    actionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: palette.signalBlue,
      textDecorationLine: 'underline',
    },
  });
}
