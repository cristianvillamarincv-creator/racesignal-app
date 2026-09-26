import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HairlineRule } from '@/components/HairlineRule';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import { spacing } from '@/lib/theme';

export type AddRaceChoice = 'find' | 'upcoming' | 'manual';

interface AddRaceOption {
  choice: AddRaceChoice;
  label: string;
  description: string;
}

const OPTIONS: AddRaceOption[] = [
  { choice: 'find', label: 'Find past races', description: 'Recover results under your racing name.' },
  { choice: 'upcoming', label: 'Add upcoming race', description: 'Put your next start line on the calendar.' },
  { choice: 'manual', label: 'Add manually', description: "Record a race you couldn't find." },
];

/**
 * The brand-themed replacement for ActionSheetIOS's native chooser (P0-7's global "add a race"
 * entry point) — a custom bottom sheet so this reads as RaceSignal's own design system rather than
 * the OS's default action-sheet styling, and renders consistently cross-platform. Presentation
 * only: the three destinations and their order/behavior are unchanged from the previous
 * ActionSheetIOS call — the caller still owns navigation via `onSelect`.
 */
export function AddRaceSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (choice: AddRaceChoice) => void;
}) {
  const palette = useBrandPalette();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Full-bleed backdrop behind the sheet — tapping anywhere outside the sheet's own bounds
            dismisses it, matching a standard bottom-sheet pattern. */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.heading}>Add a race</Text>
          {OPTIONS.map((option, index) => (
            <View key={option.choice}>
              <Pressable
                onPress={() => onSelect(option.choice)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Text style={styles.rowDescription}>{option.description}</Text>
                </View>
                <AppIcon name="chevron-right" size={18} color={palette.signalBlue} />
              </Pressable>
              {index < OPTIONS.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

interface Styles {
  overlay: ViewStyle;
  sheet: ViewStyle;
  heading: TextStyle;
  row: ViewStyle;
  rowText: ViewStyle;
  rowLabel: TextStyle;
  rowDescription: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      // A standard modal scrim — deliberately not a palette token, since a dimming backdrop reads
      // the same dark tint in both light and dark mode rather than tracking ink/canvas.
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    sheet: {
      backgroundColor: palette.canvasElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    heading: {
      fontSize: 19,
      fontWeight: '700',
      color: palette.ink,
      marginBottom: spacing.xs,
    },
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    rowDescription: {
      fontSize: 13,
      fontWeight: '400',
      color: palette.inkSecondary,
    },
  });
}
