import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { HairlineRule } from '@/components/HairlineRule';
import type { Race } from '@/fixtures/races';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
import { CHECKLIST_SECTIONS, CHECKLIST_TEMPLATE } from '@/lib/checklistTemplate';
import { AppIcon } from '@/lib/icons';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

interface RacePrepChecklistProps {
  race: Race;
}

/**
 * Persisted per-race Race Prep checklist — restored after physical-device testing showed the
 * earlier static, non-toggleable version (identical checked/unchecked state for every race, never
 * savable) was actually useful once real persistence was expected of it. Local `completed` state
 * is optimistic — it updates immediately on tap and persists in the background — since this
 * screen only ever mounts fresh per race (see race/[id].tsx), it always starts from that race's
 * own saved state. Collapsed by default: a utility inside the upcoming-race screen, not the
 * screen's main focus.
 *
 * Styled as a plain hairline-separated section (matching race/[id].tsx's Event Information block
 * and results/[id].tsx's own sections) rather than a bordered Card — each item is its own
 * hairline-separated row, and subsection titles use the same uppercase/tracked kicker typography
 * as the rest of the screen, so this reads as one more editorial section rather than a bolted-on
 * to-do widget.
 */
export function RacePrepChecklist({ race }: RacePrepChecklistProps) {
  const { setChecklistCompleted } = useAthleteRaces();
  const [expanded, setExpanded] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set(race.checklistCompleted ?? []));
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const total = CHECKLIST_TEMPLATE.length;
  const doneCount = completed.size;

  function toggle(itemId: string) {
    const next = new Set(completed);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setCompleted(next);
    setChecklistCompleted(race.id, Array.from(next)).catch((err) => {
      console.warn('[RacePrep] checklist save failed:', err);
    });
  }

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`Race prep, ${doneCount} of ${total} done, ${expanded ? 'expanded' : 'collapsed'}`}
        style={styles.header}>
        <View>
          <Text style={styles.sectionLabel}>Race Prep</Text>
          <Text style={styles.progress}>
            {doneCount} / {total} done
          </Text>
        </View>
        <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={palette.inkSecondary} />
      </Pressable>
      <HairlineRule color={palette.hairline} />

      {expanded ? (
        <View style={styles.sections}>
          {CHECKLIST_SECTIONS.map((section) => {
            const items = CHECKLIST_TEMPLATE.filter((item) => item.section === section);
            return (
              <View key={section} style={styles.subsection}>
                <Text style={styles.subsectionTitle}>{section}</Text>
                {items.map((item, index) => {
                  const isDone = completed.has(item.id);
                  return (
                    <View key={item.id}>
                      <Pressable
                        onPress={() => toggle(item.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isDone }}
                        accessibilityLabel={item.label}
                        style={styles.row}>
                        <View style={[styles.checkbox, isDone && styles.checkboxChecked]}>
                          {isDone ? <Text style={styles.checkmark}>✓</Text> : null}
                        </View>
                        <Text style={[styles.label, isDone && styles.labelDone]}>{item.label}</Text>
                      </Pressable>
                      {index < items.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface Styles {
  section: ViewStyle;
  header: ViewStyle;
  sectionLabel: TextStyle;
  progress: TextStyle;
  sections: ViewStyle;
  subsection: ViewStyle;
  subsectionTitle: TextStyle;
  row: ViewStyle;
  checkbox: ViewStyle;
  checkboxChecked: ViewStyle;
  checkmark: TextStyle;
  label: TextStyle;
  labelDone: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    section: {
      gap: 0,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 44,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.ink,
    },
    progress: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.inkSecondary,
      marginTop: 2,
      ...tabularNumerals,
    },
    sections: {
      marginTop: spacing.lg,
      gap: spacing.lg,
    },
    subsection: {
      gap: 0,
    },
    subsectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: palette.inkSecondary,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      minHeight: minTouchSize,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: palette.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: palette.signalBlue,
      borderColor: palette.signalBlue,
    },
    checkmark: {
      color: palette.onSignalBlue,
      fontSize: 14,
      fontWeight: '700',
    },
    label: {
      fontSize: 15,
      color: palette.ink,
    },
    labelDone: {
      color: palette.inkSecondary,
      textDecorationLine: 'line-through',
    },
  });
}
