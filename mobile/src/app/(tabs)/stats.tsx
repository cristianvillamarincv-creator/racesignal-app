import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { RaceHistoryRow } from '@/components/stats/RaceHistoryRow';
import { racesEmpty, racesPopulated, type Race, type SportCategory } from '@/fixtures/races';
import {
  trainingBlocksEmpty,
  trainingBlocksPopulated,
} from '@/fixtures/training';
import { formatFinishTime } from '@/lib/format';
import { getAvailableSports, getAvailableYears, getCompletedRaces } from '@/lib/races';
import { getAchievementHighlights, getAggregateStats, getPersonalBests } from '@/lib/stats';
import { colors, spacing, typography } from '@/lib/theme';
import { getTrainingTotals } from '@/lib/training';
import { useFixtureData } from '@/lib/useSimulatedLoad';

const OVERALL = 'overall' as const;
const ALL_TIME = 'all_time' as const;

export default function StatsScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const blocks = useFixtureData(trainingBlocksPopulated, trainingBlocksEmpty);
  const [sportFilter, setSportFilter] = useState<SportCategory | typeof OVERALL>(OVERALL);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL_TIME>(ALL_TIME);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const isLoading = races.isLoading || blocks.isLoading;
  const isError = races.isError || blocks.isError;

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);

  const sport = sportFilter === OVERALL ? undefined : sportFilter;
  const year = yearFilter === ALL_TIME ? undefined : yearFilter;

  const aggregate = useMemo(() => getAggregateStats(races.data, sport, year), [races.data, sport, year]);
  const trainingTotals = useMemo(
    () => getTrainingTotals(blocks.data, { sportCategory: sport, year }),
    [blocks.data, sport, year],
  );
  const personalBests = useMemo(
    () => getPersonalBests(races.data, sport, year),
    [races.data, sport, year],
  );
  const achievements = useMemo(
    () => getAchievementHighlights(races.data, sport, year),
    [races.data, sport, year],
  );
  const history = useMemo(() => {
    const completed = getCompletedRaces(races.data, year);
    return sport ? completed.filter((race) => race.sport === sport) : completed;
  }, [races.data, sport, year]);

  function openRace(race: Race) {
    if (race.locked) {
      setPremiumHint(`${race.name} is a detailed result — unlock it with Premium.`);
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
        ) : races.data.length === 0 ? (
          <EmptyState
            title="No races yet"
            subtitle="Recover a past result to start building your stats."
          />
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}>
              <FilterChip
                label="Overall"
                selected={sportFilter === OVERALL}
                onPress={() => setSportFilter(OVERALL)}
              />
              {sports.map((option) => (
                <FilterChip
                  key={option}
                  label={capitalize(option)}
                  selected={sportFilter === option}
                  onPress={() => setSportFilter(option)}
                />
              ))}
            </ScrollView>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}>
              <FilterChip
                label="All Time"
                selected={yearFilter === ALL_TIME}
                onPress={() => setYearFilter(ALL_TIME)}
              />
              {years.map((option) => (
                <FilterChip
                  key={option}
                  label={`${option}`}
                  selected={yearFilter === option}
                  onPress={() => setYearFilter(option)}
                />
              ))}
            </ScrollView>

            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            <View style={styles.metricsRow}>
              <MetricStat label="Races" value={`${aggregate.totalRaces}`} />
              <MetricStat label="Podiums" value={`${aggregate.podiums}`} />
              <MetricStat label="PRs" value={`${aggregate.prCount}`} />
            </View>
            <View style={styles.metricsRow}>
              <MetricStat label="Training time" value={`${trainingTotals.hours}h`} />
              <MetricStat label="Training distance" value={`${trainingTotals.totalDistanceKm} km`} />
            </View>

            <View style={styles.section}>
              <SectionHeader title="Personal bests" />
              {personalBests.length === 0 ? (
                <EmptyState title="No PRs for this filter" subtitle="Try a different sport or year." />
              ) : (
                <Card style={styles.listCard}>
                  {personalBests.map((pb) => (
                    <Pressable
                      key={pb.race.id}
                      onPress={() => openRace(pb.race)}
                      accessibilityRole="button"
                      accessibilityLabel={`${pb.distanceLabel} PR, ${pb.race.name}`}
                      style={styles.prRow}>
                      <Text style={styles.prDistance}>{pb.distanceLabel}</Text>
                      <Text style={styles.prTime}>
                        {pb.race.result ? formatFinishTime(pb.race.result.finishSeconds) : '—'}
                      </Text>
                    </Pressable>
                  ))}
                </Card>
              )}
            </View>

            {achievements.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Notable performances" />
                <Card style={styles.listCard}>
                  {achievements.map(({ race, achievement }) => (
                    <View key={`${race.id}-${achievement}`} style={styles.achievementRow}>
                      <Text style={typography.body}>{achievement}</Text>
                      <Text style={styles.achievementMeta}>
                        {race.name} · {race.eventDate.slice(0, 4)}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Race history" />
              {history.length === 0 ? (
                <EmptyState title="No races" subtitle="Nothing matches this filter yet." />
              ) : (
                history.map((race) => (
                  <RaceHistoryRow key={race.id} race={race} onPress={() => openRace(race)} />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricStat}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Filter by ${label}`}
      accessibilityState={{ selected }}
      style={[styles.filterChip, selected && styles.filterChipActive]}>
      <Text style={[styles.filterLabel, selected && styles.filterLabelActive]}>{label}</Text>
    </Pressable>
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
  filterRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  filterLabel: {
    ...typography.caption,
    fontWeight: '600',
  },
  filterLabelActive: {
    color: colors.accent,
  },
  premiumHint: {
    ...typography.caption,
    color: colors.warning,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricStat: {
    alignItems: 'center',
    gap: 2,
  },
  metricValue: {
    ...typography.title,
    color: colors.accent,
  },
  section: {
    gap: spacing.sm,
  },
  listCard: {
    gap: spacing.sm,
  },
  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  prDistance: {
    ...typography.body,
    fontWeight: '600',
  },
  prTime: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
  achievementRow: {
    gap: 2,
  },
  achievementMeta: {
    ...typography.caption,
  },
});
