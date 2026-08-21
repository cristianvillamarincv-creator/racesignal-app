import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import { ChecklistSectionList } from '@/components/race/ChecklistSectionList';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { racesPopulated } from '@/fixtures/races';
import { checklistProgress, daysUntil, formatCountdown } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Milestone A.1: visual only. The same generic checklist template is shown for whichever
 * upcoming race is opened — per-race custom checklists are a later (Premium) milestone.
 * Read-only: no `onPress`, no state mutation, no add-item row.
 */
export default function RacePrepScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const race = racesPopulated.find((candidate) => candidate.id === id);

  if (!race) {
    return (
      <View style={styles.screen}>
        <View style={styles.notFound}>
          <Text style={typography.subtitle}>Race not found.</Text>
        </View>
      </View>
    );
  }

  const percent = checklistProgress(checklistItemsPopulated);
  const countdownLabel = formatCountdown(daysUntil(race.eventDate));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: race.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={typography.title}>{race.name}</Text>
          <Text style={styles.countdown}>{countdownLabel}</Text>
          <Text style={typography.label}>RACE PREPARATION</Text>
          <View style={styles.progressRow}>
            <ProgressBar percent={percent} accessibilityLabel={`Preparation ${percent}% complete`} />
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
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
