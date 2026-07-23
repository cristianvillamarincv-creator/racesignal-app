import { StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@/components/SectionHeader';
import { checklistSections, type ChecklistItem } from '@/fixtures/checklist';
import { colors, spacing, typography } from '@/lib/theme';

interface ChecklistSectionListProps {
  items: ChecklistItem[];
}

/**
 * Milestone A: read-only display of the standard checklist. No `onPress`, no toggling — see the
 * approved plan's "validate navigation, layout, and UX, not functionality" scope for this screen.
 */
export function ChecklistSectionList({ items }: ChecklistSectionListProps) {
  return (
    <View style={styles.container}>
      {checklistSections.map((section) => {
        const sectionItems = items.filter((item) => item.section === section);
        if (sectionItems.length === 0) return null;

        return (
          <View key={section} style={styles.section}>
            <SectionHeader title={section} />
            {sectionItems.map((item) => (
              <View
                key={item.id}
                style={styles.row}
                accessibilityRole="text"
                accessibilityLabel={`${item.label}, ${item.isComplete ? 'checked' : 'unchecked'}`}>
                <View style={[styles.checkbox, item.isComplete && styles.checkboxChecked]}>
                  {item.isComplete ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <Text style={[styles.label, item.isComplete && styles.labelComplete]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  label: {
    ...typography.body,
  },
  labelComplete: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
});
