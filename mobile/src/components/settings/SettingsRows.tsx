import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * The shared building blocks of the Settings screens (the main list and each detail screen): one set of rows and one
 * scroll container so every Settings screen has the same rhythm, dividers and touch targets.
 */

export interface SettingsStyles {
  screen: ViewStyle;
  content: ViewStyle;
  section: ViewStyle;
  actionRow: ViewStyle;
  actionTextBlock: ViewStyle;
  actionLabel: TextStyle;
  actionValue: TextStyle;
  actionTrailing: ViewStyle;
  inertRow: ViewStyle;
  inertLabel: TextStyle;
  inertValue: TextStyle;
  planRow: ViewStyle;
  planTitleRow: ViewStyle;
  planTitle: TextStyle;
  planBadge: ViewStyle;
  planBadgeText: TextStyle;
  planDetail: TextStyle;
  destructiveLabel: TextStyle;
  disabledLabel: TextStyle;
  errorText: TextStyle;
  devSection: ViewStyle;
  devRow: ViewStyle;
  devRowLabel: TextStyle;
}

export function createSettingsStyles(palette: BrandPalette): SettingsStyles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.xxl,
    },
    section: {
      gap: 0,
    },
    actionTextBlock: {
      flex: 1,
      gap: 2,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
    },
    actionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    actionTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    actionValue: {
      fontSize: 14,
      color: palette.inkSecondary,
    },
    inertRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
      opacity: 0.5,
    },
    inertLabel: {
      fontSize: 16,
      color: palette.inkSecondary,
    },
    inertValue: {
      fontSize: 13,
      color: palette.inkSecondary,
    },
    planRow: {
      minHeight: minTouchSize,
      justifyContent: 'center',
      gap: 2,
    },
    planTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    planTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    planBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: withAlpha(palette.signalBlue, 0.14),
    },
    planBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      color: palette.signalBlue,
    },
    planDetail: {
      fontSize: 13,
      color: palette.inkSecondary,
    },
    destructiveLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.danger,
    },
    disabledLabel: {
      opacity: 0.5,
    },
    errorText: {
      fontSize: 13,
      color: palette.danger,
      marginTop: spacing.xs,
    },
    devSection: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderStyle: 'dashed',
      borderTopColor: palette.hairline,
      gap: spacing.xs,
    },
    devRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: minTouchSize,
    },
    devRowLabel: {
      fontSize: 15,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
  });
}

export function useSettingsStyles(): { styles: SettingsStyles; palette: BrandPalette } {
  const palette = useBrandPalette();
  const styles = useMemo(() => createSettingsStyles(palette), [palette]);
  return { styles, palette };
}

/** The scrolling page every Settings screen sits on. */
export function SettingsScroll({ children }: { children: ReactNode }) {
  const { styles } = useSettingsStyles();
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {children}
      </ScrollView>
    </View>
  );
}

/** A tappable row with a chevron, an optional supporting line under the label and an optional value on the right. */
export function ActionRow({ label, detail, value, onPress }: { label: string; detail?: string; value?: string; onPress: () => void }) {
  const { styles, palette } = useSettingsStyles();
  const accessibilityLabel = [label, value, detail].filter(Boolean).join(', ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={styles.actionRow}>
      <View style={styles.actionTextBlock}>
        <Text style={styles.actionLabel}>{label}</Text>
        {detail ? <Text style={styles.planDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.actionTrailing}>
        {value ? <Text style={styles.actionValue}>{value}</Text> : null}
        <AppIcon name="chevron-right" size={18} color={palette.signalBlue} />
      </View>
    </Pressable>
  );
}

/** A visibly present but genuinely inert row (no Pressable, no arrow, reduced opacity), used for a link whose URL is not set yet. */
export function InertRow({ label }: { label: string }) {
  const { styles } = useSettingsStyles();
  return (
    <View style={styles.inertRow} accessibilityRole="text" accessibilityLabel={`${label}, coming soon`}>
      <Text style={styles.inertLabel}>{label}</Text>
      <Text style={styles.inertValue}>Coming soon</Text>
    </View>
  );
}

/** A non-interactive status line: a title, an optional badge and a supporting line. */
export function PlanStatusRow({ title, badge, detail }: { title: string; badge?: string; detail: string }) {
  const { styles } = useSettingsStyles();
  return (
    <View style={styles.planRow} accessibilityRole="text" accessibilityLabel={badge ? `${title}, ${badge}, ${detail}` : `${title}, ${detail}`}>
      <View style={styles.planTitleRow}>
        <Text style={styles.planTitle}>{title}</Text>
        {badge ? (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.planDetail}>{detail}</Text>
    </View>
  );
}

/** A destructive action row (danger colored, no chevron) with the same height as the other rows. */
export function DestructiveRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { styles } = useSettingsStyles();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={styles.actionRow}>
      <Text style={[styles.destructiveLabel, disabled && styles.disabledLabel]}>{label}</Text>
    </Pressable>
  );
}
