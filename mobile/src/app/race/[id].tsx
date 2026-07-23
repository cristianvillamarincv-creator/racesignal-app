import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import { ChecklistSectionList } from '@/components/race/ChecklistSectionList';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { nextRacePopulated } from '@/fixtures/race';
import { checklistProgress, daysUntil, formatCountdown } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Milestone A: visual only, backed by the single mock next race regardless of the `id` param.
 * Read-only checklist — see the approved plan for why editing is deferred.
 */
export default function RaceChecklistScreen() {
  const race = nextRacePopulated;
  const percent = checklistProgress(checklistItemsPopulated);
  const countdownLabel = formatCountdown(daysUntil(race.eventDate));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: race.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={typography.title}>{race.name}</Text>
          <Text style={styles.countdown}>{countdownLabel}</Text>
          <Text style={typography.label}>RACE CHECKLIST</Text>
          <View style={styles.progressRow}>
            <ProgressBar percent={percent} accessibilityLabel={`Checklist ${percent}% complete`} />
            <Text style={styles.progressLabel}>{percent}% ready</Text>
          </View>
        </Card>

        <ChecklistSectionList items={checklistItemsPopulated} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  countdown: {
    ...typography.display,
    fontSize: 28,
    color: colors.accent,
    marginVertical: spacing.xs,
  },
  progressRow: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  progressLabel: {
    ...typography.caption,
  },
});
