import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import type { Race } from '@/fixtures/races';
import { CHECKLIST_SECTIONS, CHECKLIST_TEMPLATE } from '@/lib/checklistTemplate';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

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
 */
export function RacePrepChecklist({ race }: RacePrepChecklistProps) {
  const { setChecklistCompleted } = useAthleteRaces();
  const [expanded, setExpanded] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set(race.checklistCompleted ?? []));

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
    <Card>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`Race prep, ${doneCount} of ${total} done, ${expanded ? 'expanded' : 'collapsed'}`}
        style={styles.header}>
        <View>
          <Text style={typography.label}>RACE PREP</Text>
          <Text style={styles.progress}>
            {doneCount} / {total} done
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.sections}>
          {CHECKLIST_SECTIONS.map((section) => {
            const items = CHECKLIST_TEMPLATE.filter((item) => item.section === section);
            return (
              <View key={section} style={styles.section}>
                <Text style={styles.sectionTitle}>{section}</Text>
                {items.map((item) => {
                  const isDone = completed.has(item.id);
                  return (
                    <Pressable
                      key={item.id}
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
                  );
                })}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  progress: {
    ...typography.body,
    fontWeight: '600',
    marginTop: 2,
  },
  chevron: {
    ...typography.body,
    color: colors.textMuted,
  },
  sections: {
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 40,
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
  labelDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
});
