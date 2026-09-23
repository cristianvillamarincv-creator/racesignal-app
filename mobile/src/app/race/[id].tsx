import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import { ChecklistSectionList } from '@/components/race/ChecklistSectionList';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { checklistProgress, daysUntil, formatCountdown } from '@/lib/format';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Milestone A.1: visual only. The same generic checklist template is shown for whichever
 * upcoming race is opened — per-race custom checklists are a later (Premium) milestone.
 * Read-only: no `onPress`, no state mutation, no add-item row.
 */
export default function RacePrepScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: races, removeRace } = useAthleteRaces();
  const race = races.find((candidate) => candidate.id === id);

  // This screen is for an upcoming race's preparation checklist — a completed race's prep view
  // isn't meaningful (and its eventDate may be a bare year, which daysUntil can't parse).
  if (!race || race.status === 'completed') {
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

  function confirmRemove() {
    if (!race) return;
    Alert.alert('Remove this race?', `${race.name} will no longer appear in your history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeRace(race.id);
            router.back();
          } catch (err) {
            console.warn('[RacePrep] removeRace failed:', err);
            Alert.alert('Couldn’t remove that race', 'Please try again.');
          }
        },
      },
    ]);
  }

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
          {race.isManual ? (
            <Pressable
              onPress={() => router.push(`/race/add?raceId=${race.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Edit this race"
              style={styles.editLink}>
              <Text style={styles.editLinkLabel}>Edit this race</Text>
            </Pressable>
          ) : null}
        </Card>

        <ChecklistSectionList items={checklistItemsPopulated} />

        {race.isManual ? (
          <Pressable
            onPress={confirmRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove this race"
            style={styles.removeButton}>
            <Text style={styles.removeButtonLabel}>Remove this race</Text>
          </Pressable>
        ) : null}
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
  editLink: {
    marginTop: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  editLinkLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
  removeButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  removeButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.danger,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
