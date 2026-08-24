import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceCountdownCard } from '@/components/race/RaceCountdownCard';
import { SectionHeader } from '@/components/SectionHeader';
import { SeasonRaceRow } from '@/components/season/SeasonRaceRow';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { raceSignalEmpty, raceSignalPopulated } from '@/fixtures/raceSignal';
import { racesEmpty, racesPopulated, type Race } from '@/fixtures/races';
import {
  recentActivitiesEmpty,
  recentActivitiesPopulated,
  trainingBlocksEmpty,
  trainingBlocksPopulated,
  trainingMilestonesEmpty,
  trainingMilestonesPopulated,
} from '@/fixtures/training';
import { checklistProgress } from '@/lib/format';
import type { Discipline } from '@/lib/icons';
import { AppIcon, DisciplineIcon } from '@/lib/icons';
import { getAvailableYears, getCompletedRaces, getNextRace } from '@/lib/races';
import { colors, spacing, typography } from '@/lib/theme';
import { getLinkedRaceForYear, getTrainingTotals } from '@/lib/training';
import { useFixtureData } from '@/lib/useSimulatedLoad';

export default function HomeScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const blocks = useFixtureData(trainingBlocksPopulated, trainingBlocksEmpty);
  const activities = useFixtureData(recentActivitiesPopulated, recentActivitiesEmpty);
  const milestones = useFixtureData(trainingMilestonesPopulated, trainingMilestonesEmpty);
  const raceSignal = useFixtureData(raceSignalPopulated, raceSignalEmpty);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const isLoading =
    races.isLoading || blocks.isLoading || activities.isLoading || milestones.isLoading || raceSignal.isLoading;
  const isError =
    races.isError || blocks.isError || activities.isError || milestones.isError || raceSignal.isError;

  const years = useMemo(() => getAvailableYears(races.data), [races.data]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const activeYear = selectedYear ?? years[0] ?? new Date().getFullYear();
  const isCurrentYear = activeYear === years[0];
  const yearIndex = years.indexOf(activeYear);
  const canGoOlder = yearIndex >= 0 && yearIndex < years.length - 1;
  const canGoNewer = yearIndex > 0;

  const nextRace = getNextRace(races.data);
  const yearTotals = useMemo(
    () => getTrainingTotals(blocks.data, { year: activeYear }),
    [blocks.data, activeYear],
  );
  const linkedRace = useMemo(
    () => getLinkedRaceForYear(blocks.data, races.data, activeYear),
    [blocks.data, races.data, activeYear],
  );
  const trainingSectionTitle = isCurrentYear && linkedRace ? `Road to ${linkedRace.name}` : 'Training';
  const hasTrainingForYear = yearTotals.hours > 0 || yearTotals.sessions > 0;

  const yearMilestones = useMemo(
    () => milestones.data.filter((milestone) => milestone.year === activeYear),
    [milestones.data, activeYear],
  );
  const yearRaces = useMemo(
    () => getCompletedRaces(races.data, activeYear),
    [races.data, activeYear],
  );

  function openRace(race: Race) {
    if (race.locked) {
      setPremiumHint(`${race.name} — full result is Premium.`);
      return;
    }
    router.push(`/results/${race.id}`);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : isError ? (
          <ErrorState />
        ) : (
          <>
            <YearStepper
              year={activeYear}
              onOlder={() => canGoOlder && setSelectedYear(years[yearIndex + 1])}
              onNewer={() => canGoNewer && setSelectedYear(years[yearIndex - 1])}
              canGoOlder={canGoOlder}
              canGoNewer={canGoNewer}
            />

            {isCurrentYear ? (
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

                {raceSignal.data ? (
                  <Card style={styles.raceSignalCard}>
                    <View style={styles.raceSignalHeader}>
                      <Text style={typography.label}>RACE SIGNAL</Text>
                      <Text style={styles.raceSignalHint}>Momentum, not a fitness score</Text>
                    </View>
                    <View style={styles.raceSignalRow}>
                      <Text style={styles.raceSignalScore}>{raceSignal.data.score}</Text>
                      <View style={styles.raceSignalMeta}>
                        <Text style={styles.raceSignalDelta}>{raceSignal.data.deltaLabel}</Text>
                        <Text style={styles.raceSignalMomentum}>{raceSignal.data.momentumLabel}</Text>
                      </View>
                    </View>
                  </Card>
                ) : null}
              </>
            ) : (
              <View style={styles.historicalHeading}>
                <Text style={typography.display}>{activeYear}</Text>
                <Text style={styles.historicalSubcopy}>Historical season</Text>
              </View>
            )}

            <View style={styles.section}>
              <SectionHeader title={trainingSectionTitle} />
              {!hasTrainingForYear ? (
                <EmptyState title="No training logged" subtitle={`Nothing recorded for ${activeYear} yet.`} />
              ) : (
                <Card style={styles.roadToCard}>
                  <View style={styles.roadToTopRow}>
                    <BlockStat label="Hours" value={`${yearTotals.hours}`} />
                    <BlockStat label="Sessions" value={`${yearTotals.sessions}`} />
                  </View>
                  <View style={styles.roadToDisciplineRow}>
                    {(['swim', 'bike', 'run'] as Discipline[])
                      .map((discipline) => ({
                        discipline,
                        km:
                          discipline === 'swim'
                            ? yearTotals.swimKm
                            : discipline === 'bike'
                              ? yearTotals.bikeKm
                              : yearTotals.runKm,
                      }))
                      .filter(({ km }) => km > 0)
                      .map(({ discipline, km }) => (
                        <View key={discipline} style={styles.disciplineStat}>
                          <DisciplineIcon discipline={discipline} size={20} color={colors.accent} />
                          <Text style={styles.disciplineValue}>{km} km</Text>
                        </View>
                      ))}
                  </View>
                </Card>
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Milestones" />
              {yearMilestones.length === 0 ? (
                <EmptyState title="No milestones yet" subtitle={`Nothing logged for ${activeYear} yet.`} />
              ) : (
                <Card style={styles.listCard}>
                  {yearMilestones.map((milestone) => (
                    <View key={milestone.id} style={styles.milestoneRow}>
                      <AppIcon name={milestone.icon} size={18} color={colors.accent} />
                      <Text style={styles.milestoneLabel}>{milestone.label}</Text>
                      <Text style={styles.milestoneValue}>{milestone.value}</Text>
                    </View>
                  ))}
                </Card>
              )}
            </View>

            {isCurrentYear ? (
              <View style={styles.section}>
                <SectionHeader title="Last 7 days" />
                {activities.data.length === 0 ? (
                  <EmptyState title="No recent activity" subtitle="Recent training will show up here." />
                ) : (
                  <Card style={styles.listCard}>
                    {activities.data.map((activity) => (
                      <View key={activity.id} style={styles.activityRow}>
                        {activity.sport === 'swim' || activity.sport === 'bike' || activity.sport === 'run' ? (
                          <DisciplineIcon discipline={activity.sport} size={18} color={colors.accent} />
                        ) : (
                          <AppIcon name="dumbbell" size={18} color={colors.accent} />
                        )}
                        <View style={styles.activityText}>
                          <Text style={typography.body}>
                            {activity.distanceLabel ? `${activity.distanceLabel} ` : ''}
                            {activity.label.toLowerCase()}
                          </Text>
                          <Text style={styles.activityMeta}>
                            {activity.durationLabel} · {activity.whenLabel}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </Card>
                )}
              </View>
            ) : (
              <View style={styles.section}>
                <SectionHeader title={`${activeYear} races`} />
                {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}
                {yearRaces.length === 0 ? (
                  <EmptyState title="No races" subtitle={`Nothing completed in ${activeYear}.`} />
                ) : (
                  yearRaces.map((race) => (
                    <SeasonRaceRow key={race.id} race={race} onPress={() => openRace(race)} />
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function YearStepper({
  year,
  onOlder,
  onNewer,
  canGoOlder,
  canGoNewer,
}: {
  year: number;
  onOlder: () => void;
  onNewer: () => void;
  canGoOlder: boolean;
  canGoNewer: boolean;
}) {
  return (
    <View style={styles.yearStepper}>
      <Pressable
        onPress={onOlder}
        disabled={!canGoOlder}
        accessibilityRole="button"
        accessibilityLabel="Previous year"
        style={styles.yearStepButton}>
        <Text style={[styles.yearStepArrow, !canGoOlder && styles.yearStepArrowDisabled]}>‹</Text>
      </Pressable>
      <Text style={styles.yearLabel}>{year}</Text>
      <Pressable
        onPress={onNewer}
        disabled={!canGoNewer}
        accessibilityRole="button"
        accessibilityLabel="Next year"
        style={styles.yearStepButton}>
        <Text style={[styles.yearStepArrow, !canGoNewer && styles.yearStepArrowDisabled]}>›</Text>
      </Pressable>
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
  yearStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
  },
  yearStepButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearStepArrow: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.accent,
  },
  yearStepArrowDisabled: {
    color: colors.textMuted,
  },
  yearLabel: {
    ...typography.subtitle,
  },
  historicalHeading: {
    gap: 2,
  },
  historicalSubcopy: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  raceSignalCard: {
    gap: spacing.sm,
  },
  raceSignalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  raceSignalHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  raceSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  raceSignalScore: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.accent,
  },
  raceSignalMeta: {
    gap: 2,
  },
  raceSignalDelta: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
  raceSignalMomentum: {
    ...typography.caption,
  },
  section: {
    gap: spacing.sm,
  },
  premiumHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  roadToCard: {
    gap: spacing.sm,
  },
  roadToTopRow: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  roadToDisciplineRow: {
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
  disciplineStat: {
    alignItems: 'center',
    gap: 4,
  },
  disciplineValue: {
    ...typography.subtitle,
  },
  listCard: {
    gap: spacing.md,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  milestoneLabel: {
    ...typography.body,
    flex: 1,
  },
  milestoneValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activityText: {
    gap: 2,
  },
  activityMeta: {
    ...typography.caption,
  },
});
