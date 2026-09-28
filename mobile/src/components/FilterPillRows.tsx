import { ScrollView, StyleSheet, View } from 'react-native';

import { FilterChip } from '@/components/FilterChip';
import { spacing } from '@/lib/theme';

export interface FilterOption {
  key: string;
  label: string;
  selected: boolean;
}

interface FilterPillRowsProps {
  sportOptions: FilterOption[];
  yearOptions: FilterOption[];
  onSelectSport: (key: string) => void;
  onSelectYear: (key: string) => void;
}

/**
 * The pre-Step-6 filter treatment, restored — two independent, horizontally-scrolling rows of
 * always-visible, directly tappable pills: "All sports · Running · Triathlon · ..." then
 * "All years · 2026 · 2025 · ...". Every option is on-screen and reachable in a single tap; unlike
 * the CompactFilterBar it replaces, nothing is tucked behind a picker sheet that has to be opened
 * first. A long year list scrolls horizontally rather than wrapping onto a second line — this
 * matches the original implementation exactly (see git history: season.tsx pre-Step-4-merge, and
 * (tabs)/index.tsx + (tabs)/stats.tsx through commit 301dbbc, before commit 5e2e956's "Race
 * Morning Precision" pass replaced it with the single-line modal picker).
 *
 * Shared by both Races and Stats so the two screens keep one identical filter treatment/behavior,
 * same as CompactFilterBar was — only the interaction pattern (visible pills vs. hidden picker)
 * has changed back.
 */
export function FilterPillRows({ sportOptions, yearOptions, onSelectSport, onSelectYear }: FilterPillRowsProps) {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {sportOptions.map((option) => (
          <FilterChip
            key={option.key}
            label={option.label}
            selected={option.selected}
            onPress={() => onSelectSport(option.key)}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {yearOptions.map((option) => (
          <FilterChip
            key={option.key}
            label={option.label}
            selected={option.selected}
            onPress={() => onSelectYear(option.key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
