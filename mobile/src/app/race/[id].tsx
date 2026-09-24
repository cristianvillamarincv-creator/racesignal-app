import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { RacePrepChecklist } from '@/components/race/RacePrepChecklist';
import { daysUntil, formatCountdown, formatRaceDate } from '@/lib/format';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Upcoming-race detail: countdown + event information + a collapsible Race Prep checklist +
 * Edit/Remove. The checklist was briefly removed in an earlier Step 4 pass (it used to be a
 * static fixture — identical for every race, nothing actually checkable) and restored once real
 * per-race persistence existed (see RacePrepChecklist + lib/checklistTemplate.ts) — RaceSignal
 * still isn't a training-plan app, so this stays a fixed, shared template, not a custom planner.
 */
export default function RacePrepScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: races, removeRace } = useAthleteRaces();
  const race = races.find((candidate) => candidate.id === id);

  // This screen is for an upcoming race — a completed race's prep view isn't meaningful (and its
  // eventDate may be a bare year, which daysUntil can't parse).
  if (!race || race.status === 'completed') {
    return (
      <View style={styles.screen}>
        <View style={styles.notFound}>
          <Text style={typography.subtitle}>Race not found.</Text>
        </View>
      </View>
    );
  }

  const countdownLabel = formatCountdown(daysUntil(race.eventDate));
  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;

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
        </Card>

        <Card style={styles.section}>
          <Text style={typography.label}>EVENT INFORMATION</Text>
          <InfoRow label="Date" value={dateLabel} />
          {race.location ? <InfoRow label="Location" value={race.location} /> : null}
          {race.distanceLabel ? <InfoRow label="Distance" value={race.distanceLabel} /> : null}
          <InfoRow label="Sport" value={capitalize(race.sport)} />
        </Card>

        <Pressable
          onPress={() => router.push({ pathname: '/signal', params: { raceId: race.id } })}
          accessibilityRole="button"
          accessibilityLabel="Ask Signal about this race"
          style={styles.askSignalButton}>
          <Text style={styles.askSignalButtonLabel}>Ask Signal</Text>
        </Pressable>

        {race.isManual ? <RacePrepChecklist race={race} /> : null}

        {race.isManual ? (
          <Pressable
            onPress={() => router.push(`/race/add?raceId=${race.id}`)}
            accessibilityRole="button"
            accessibilityLabel="Edit this race"
            style={styles.editButton}>
            <Text style={styles.editButtonLabel}>Edit this race</Text>
          </Pressable>
        ) : null}

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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  section: {
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
  },
  infoLabel: {
    ...typography.caption,
  },
  infoValue: {
    ...typography.body,
    fontWeight: '600',
  },
  askSignalButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  askSignalButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.background,
  },
  editButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  editButtonLabel: {
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
