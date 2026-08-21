import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceCountdownCard } from '@/components/race/RaceCountdownCard';
import { SectionHeader } from '@/components/SectionHeader';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { racesEmpty, racesPopulated } from '@/fixtures/races';
import {
  recentActivitiesEmpty,
  recentActivitiesPopulated,
  trainingBlocksEmpty,
  trainingBlocksPopulated,
  trainingMilestonesEmpty,
  trainingMilestonesPopulated,
} from '@/fixtures/training';
import { checklistProgress } from '@/lib/format';
import { getNextRace } from '@/lib/races';
import { colors, spacing, typography } from '@/lib/theme';
import { getCurrentTrainingBlock } from '@/lib/training';
import { useFixtureData } from '@/lib/useSimulatedLoad';

export default function HomeScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const blocks = useFixtureData(trainingBlocksPopulated, trainingBlocksEmpty);
  const activities = useFixtureData(recentActivitiesPopulated, recentActivitiesEmpty);
  const milestones = useFixtureData(trainingMilestonesPopulated, trainingMilestonesEmpty);

  const isLoading = races.isLoading || blocks.isLoading || activities.isLoading || milestones.isLoading;
  const isError = races.isError || blocks.isError || activities.isError || milestones.isError;

  const nextRace = getNextRace(races.data);
  const currentBlock = nextRace ? getCurrentTrainingBlock(blocks.data, nextRace.id) : null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : isError ? (
          <ErrorState />
        ) : (
          <>
            {nextRace ? (
              <RaceCountdownCard
                race={nextRace}
                checklistPercent={checklistProgress(checklistItemsPopulated)}
                onOpenRace={() => router.push(`/race/${nextRace.id}`)}
              />
            ) : (
              <EmptyState
                title="No upcoming race yet"
                subtitle="Add a race to see your countdown and preparation here."
              />
            )}

            {currentBlock ? (
              <Card style={styles.section}>
                <SectionHeader title="This training block" />
                <View style={styles.blockTopRow}>
                  <BlockStat label="Sessions" value={`${currentBlock.sessions}`} />
                  <BlockStat label="Hours" value={`${currentBlock.hours}`} />
                </View>
                <View style={styles.blockDisciplineRow}>
                  <BlockStat label="Swim" value={`${currentBlock.swimKm} km`} />
                  <BlockStat label="Bike" value={`${currentBlock.bikeKm} km`} />
                  <BlockStat label="Run" value={`${currentBlock.runKm} km`} />
                </View>
              </Card>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Recent" />
              {activities.data.length === 0 ? (
                <EmptyState title="No recent activity" subtitle="Recent training will show up here." />
              ) : (
                <Card style={styles.listCard}>
                  {activities.data.map((activity) => (
                    <View key={activity.id} style={styles.activityRow}>
                      <Text style={typography.body}>
                        {activity.distanceLabel ? `${activity.distanceLabel} ` : ''}
                        {activity.label.toLowerCase()}
                      </Text>
                      <Text style={styles.activityMeta}>
                        {activity.durationLabel} · {activity.whenLabel}
                      </Text>
                    </View>
                  ))}
                </Card>
              )}
            </View>

            {milestones.data.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Milestones" />
                <Card style={styles.listCard}>
                  {milestones.data.map((milestone) => (
                    <Text key={milestone.id} style={styles.milestoneText}>
                      {milestone.label}
                    </Text>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BlockStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.blockStat}>
      <Text style={styles.blockStatValue}>{value}</Text>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
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
  section: {
    gap: spacing.sm,
  },
  blockTopRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  blockDisciplineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  blockStat: {
    gap: 2,
  },
  blockStatValue: {
    ...typography.title,
    color: colors.accent,
  },
  listCard: {
    gap: spacing.sm,
  },
  activityRow: {
    gap: 2,
  },
  activityMeta: {
    ...typography.caption,
  },
  milestoneText: {
    ...typography.body,
  },
});
