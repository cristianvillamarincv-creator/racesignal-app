import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HairlineRule } from '@/components/HairlineRule';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { AppIcon } from '@/lib/icons';
import { spacing } from '@/lib/theme';

export interface CompactFilterOption {
  key: string;
  label: string;
  selected: boolean;
}

interface CompactFilterBarProps {
  sportLabel: string;
  yearLabel: string;
  sportOptions: CompactFilterOption[];
  yearOptions: CompactFilterOption[];
  onSelectSport: (key: string) => void;
  onSelectYear: (key: string) => void;
}

type ActiveModal = 'sport' | 'year' | null;

/**
 * The one shared filter treatment for both Races and Stats — "All sports · All years" as two
 * tappable text segments with a chevron, each opening a small bottom-sheet picker. A prior pass
 * left Races on a horizontally-scrolling text-tab row and Stats on this compact bar; having two
 * different filter interaction systems in the same app was the actual defect, not either one on
 * its own — so this is now the single implementation both screens render, byte-for-byte identical
 * typography/spacing/active-treatment/picker behavior. Filtering logic/state stays with the
 * caller (sportFilter/yearFilter and their setters) — this component only owns which picker sheet,
 * if any, is currently open.
 */
export function CompactFilterBar({ sportLabel, yearLabel, sportOptions, yearOptions, onSelectSport, onSelectYear }: CompactFilterBarProps) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  return (
    <>
      <View style={styles.bar}>
        <Pressable
          onPress={() => setActiveModal('sport')}
          accessibilityRole="button"
          accessibilityLabel={`Sport filter, currently ${sportLabel}`}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={styles.segment}>
          <Text style={styles.segmentText}>{sportLabel}</Text>
          <AppIcon name="chevron-down" size={13} color={palette.inkSecondary} />
        </Pressable>
        <Text style={styles.divider}>·</Text>
        <Pressable
          onPress={() => setActiveModal('year')}
          accessibilityRole="button"
          accessibilityLabel={`Year filter, currently ${yearLabel}`}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={styles.segment}>
          <Text style={styles.segmentText}>{yearLabel}</Text>
          <AppIcon name="chevron-down" size={13} color={palette.inkSecondary} />
        </Pressable>
      </View>

      <FilterPickerModal
        visible={activeModal === 'sport'}
        title="Sport"
        options={sportOptions}
        onSelect={onSelectSport}
        onClose={() => setActiveModal(null)}
        palette={palette}
        styles={styles}
      />
      <FilterPickerModal
        visible={activeModal === 'year'}
        title="Year"
        options={yearOptions}
        onSelect={onSelectYear}
        onClose={() => setActiveModal(null)}
        palette={palette}
        styles={styles}
      />
    </>
  );
}

/** Mirrors AddRaceSheet's own bottom-sheet pattern (same overlay/sheet/hairline-row shape) so this
 *  reads as the app's existing sheet convention rather than a one-off. */
function FilterPickerModal({
  visible,
  title,
  options,
  onSelect,
  onClose,
  palette,
  styles,
}: {
  visible: boolean;
  title: string;
  options: CompactFilterOption[];
  onSelect: (key: string) => void;
  onClose: () => void;
  palette: BrandPalette;
  styles: Styles;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.modalHeading}>{title}</Text>
          {options.map((option, index) => (
            <View key={option.key}>
              <Pressable
                onPress={() => {
                  onSelect(option.key);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: option.selected }}
                accessibilityLabel={option.label}
                style={styles.modalRow}>
                <Text style={[styles.modalRowLabel, option.selected ? { color: palette.signalBlue, fontWeight: '700' as const } : null]}>
                  {option.label}
                </Text>
                {option.selected ? <AppIcon name="check" size={18} color={palette.signalBlue} /> : null}
              </Pressable>
              {index < options.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

interface Styles {
  bar: ViewStyle;
  segment: ViewStyle;
  segmentText: TextStyle;
  divider: TextStyle;
  modalOverlay: ViewStyle;
  modalSheet: ViewStyle;
  modalHeading: TextStyle;
  modalRow: ViewStyle;
  modalRowLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    segment: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 4,
    },
    segmentText: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    divider: {
      fontSize: 13,
      color: palette.hairline,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalSheet: {
      backgroundColor: palette.canvasElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    modalHeading: {
      fontSize: 19,
      fontWeight: '700',
      color: palette.ink,
      marginBottom: spacing.xs,
    },
    modalRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    modalRowLabel: {
      fontSize: 16,
      fontWeight: '500',
      color: palette.ink,
    },
  });
}
