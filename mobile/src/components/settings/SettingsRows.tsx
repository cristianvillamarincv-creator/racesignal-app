import { Children, useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { AppIcon, type IconName } from '@/lib/icons';
import { radii, spacing } from '@/lib/theme';

/**
 * The shared building blocks of every Settings screen, so the hierarchy is the same everywhere:
 *  - a section heading (small, uppercase, secondary, outside the container, not tappable),
 *  - a rounded surface that groups its rows (a subtle step up from the page, themed for light and dark),
 *  - rows with a quiet outline icon, a primary label, an optional quieter right-aligned value and a chevron,
 *    each at least 56pt tall (growing with larger text), fully tappable, with visible pressed feedback,
 *  - thin dividers between rows, inset to line up with the row text.
 */

export const ROW_MIN_HEIGHT = 56;
const ROW_PADDING = spacing.lg;
const ICON_SIZE = 22;
const ICON_GAP = spacing.md;
/** Dividers start where the row text starts (padding + icon + gap), so they never run under the icon. */
export const ICON_DIVIDER_INSET = ROW_PADDING + ICON_SIZE + ICON_GAP;
export const TEXT_DIVIDER_INSET = ROW_PADDING;

export interface SettingsStyles {
  screen: ViewStyle;
  content: ViewStyle;
  sectionHeading: TextStyle;
  sectionHeadingBlock: ViewStyle;
  group: ViewStyle;
  groupDashed: ViewStyle;
  divider: ViewStyle;
  row: ViewStyle;
  rowPressed: ViewStyle;
  rowDisabled: ViewStyle;
  iconSlot: ViewStyle;
  rowText: ViewStyle;
  rowLabel: TextStyle;
  rowLabelDestructive: TextStyle;
  rowDetail: TextStyle;
  rowValue: TextStyle;
  statusRow: ViewStyle;
  badge: ViewStyle;
  badgeText: TextStyle;
  note: TextStyle;
  errorText: TextStyle;
  inertValue: TextStyle;
  devRowLabel: TextStyle;
}

export function createSettingsStyles(palette: BrandPalette): SettingsStyles {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.canvas },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xl },
    // A heading names a group; it is never tappable, so it is small, quiet and has no chevron or pressed state.
    sectionHeadingBlock: { gap: spacing.sm },
    sectionHeading: {
      fontSize: 12.5,
      fontWeight: '500',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: palette.inkSecondary,
      paddingHorizontal: ROW_PADDING,
    },
    group: {
      backgroundColor: palette.canvasElevated,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
      overflow: 'hidden',
    },
    groupDashed: { borderStyle: 'dashed' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: ROW_MIN_HEIGHT,
      paddingVertical: spacing.md,
      paddingHorizontal: ROW_PADDING,
      gap: ICON_GAP,
    },
    rowPressed: { backgroundColor: withAlpha(palette.ink, 0.07) },
    rowDisabled: { opacity: 0.5 },
    iconSlot: { width: ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontSize: 17, fontWeight: '500', color: palette.ink },
    rowLabelDestructive: { color: palette.danger },
    rowDetail: { fontSize: 13, lineHeight: 18, color: palette.inkSecondary },
    rowValue: { fontSize: 15, color: palette.inkSecondary, flexShrink: 1, textAlign: 'right' },
    statusRow: { minHeight: ROW_MIN_HEIGHT, paddingVertical: spacing.md, paddingHorizontal: ROW_PADDING, flexDirection: 'row', alignItems: 'center', gap: ICON_GAP },
    badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(palette.signalBlue, 0.14) },
    badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: palette.signalBlue },
    note: { fontSize: 13, lineHeight: 18, color: palette.inkSecondary, paddingHorizontal: ROW_PADDING },
    errorText: { fontSize: 13, lineHeight: 18, color: palette.danger, paddingHorizontal: ROW_PADDING, paddingVertical: spacing.sm },
    inertValue: { fontSize: 13, color: palette.inkSecondary },
    devRowLabel: { fontSize: 16, fontWeight: '500', color: palette.inkSecondary },
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

/** A thin divider between two rows. */
export function RowDivider({ inset = ICON_DIVIDER_INSET }: { inset?: number }) {
  const { styles } = useSettingsStyles();
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A rounded surface holding rows, with a divider (inset to the text) between each pair. */
export function SettingsGroup({ children, inset = ICON_DIVIDER_INSET, dashed = false }: { children: ReactNode; inset?: number; dashed?: boolean }) {
  const { styles } = useSettingsStyles();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.group, dashed && styles.groupDashed]}>
      {rows.map((row, index) => (
        <View key={index}>
          {index > 0 ? <RowDivider inset={inset} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

/** A titled group: the small uppercase heading sits outside and above the rounded surface. */
export function SettingsSection({ title, children, note, dashed = false }: { title?: string; children: ReactNode; note?: string; dashed?: boolean }) {
  const { styles } = useSettingsStyles();
  return (
    <View style={styles.sectionHeadingBlock}>
      {title ? (
        <Text style={styles.sectionHeading} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <SettingsGroup dashed={dashed}>{children}</SettingsGroup>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/** Explanatory text under a group, aligned with the row text. */
export function SettingsNote({ children }: { children: ReactNode }) {
  const { styles } = useSettingsStyles();
  return <Text style={styles.note}>{children}</Text>;
}

function LeadingIcon({ icon, color }: { icon?: IconName; color: string }) {
  const { styles } = useSettingsStyles();
  if (!icon) return null;
  return (
    <View style={styles.iconSlot} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <AppIcon name={icon} size={ICON_SIZE} color={color} />
    </View>
  );
}

interface ActionRowProps {
  label: string;
  detail?: string;
  /** A quiet value on the right (for example Free or Premium). */
  value?: string;
  icon?: IconName;
  onPress: () => void;
  /** Show the trailing chevron (default true). Rows that act in place (Sign out, Delete account) have none. */
  chevron?: boolean;
  /** The destructive color, reserved for Delete account. */
  destructive?: boolean;
  disabled?: boolean;
}

/** A fully tappable row (the whole 56pt-plus row, not just its text) with visible pressed feedback. */
export function ActionRow({ label, detail, value, icon, onPress, chevron = true, destructive = false, disabled = false }: ActionRowProps) {
  const { styles, palette } = useSettingsStyles();
  const accessibilityLabel = [label, value, detail].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}>
      <LeadingIcon icon={icon} color={destructive ? palette.danger : palette.inkSecondary} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {chevron ? <AppIcon name="chevron-right" size={20} color={withAlpha(palette.inkSecondary, 0.7)} /> : null}
    </Pressable>
  );
}

/** The destructive action row (danger colored, no chevron). */
export function DestructiveRow({ label, onPress, disabled, icon }: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName }) {
  return <ActionRow label={label} onPress={onPress} icon={icon} chevron={false} destructive disabled={disabled} />;
}

/** A visibly present but genuinely inert row (no press, reduced opacity), used for a link whose URL is not set yet. */
export function InertRow({ label, icon }: { label: string; icon?: IconName }) {
  const { styles, palette } = useSettingsStyles();
  return (
    <View style={[styles.row, styles.rowDisabled]} accessibilityRole="text" accessibilityLabel={`${label}, coming soon`}>
      <LeadingIcon icon={icon} color={palette.inkSecondary} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.inertValue}>Coming soon</Text>
    </View>
  );
}

/** A non-interactive status line: a title, an optional badge and a supporting line. */
export function PlanStatusRow({ title, badge, detail, icon }: { title: string; badge?: string; detail: string; icon?: IconName }) {
  const { styles, palette } = useSettingsStyles();
  return (
    <View style={styles.statusRow} accessibilityRole="text" accessibilityLabel={badge ? `${title}, ${badge}, ${detail}` : `${title}, ${detail}`}>
      <LeadingIcon icon={icon} color={palette.inkSecondary} />
      <View style={styles.rowText}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
          <Text style={styles.rowLabel}>{title}</Text>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
    </View>
  );
}
