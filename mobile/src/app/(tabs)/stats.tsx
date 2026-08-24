import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FilterChip } from '@/components/FilterChip';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { HighlightCard } from '@/components/stats/HighlightCard';
import { RaceHistoryRow } from '@/components/stats/RaceHistoryRow';
import { racesEmpty, racesPopulated, type Race, type SportCategory } from '@/fixtures/races';
import { trainingBlocksEmpty, trainingBlocksPopulated } from '@/fixtures/training';
import { formatFinishTime } from '@/lib/format';
import type { Discipline } from '@/lib/icons';
import { DISCIPLINE_LABEL, DisciplineIcon } from '@/lib/icons';
import { getAvailableSports, getAvailableYears, getCompletedRaces } from '@/lib/races';
import {
  getAchievementHighlights,
  getAggregateStats,
  getBestAgeGroupPercentile,
  getPersonalBests,
  pickTopHighlights,
} from '@/lib/stats';
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
  const bestAgeGroupPercentile = useMemo(
    () => getBestAgeGroupPercentile(races.data, sport, year),
    [races.data, sport, year],
  );
  const trainingTotals = useMemo(
    () => getTrainingTotals(blocks.data, { sportCategory: sport, year }),
    [blocks.data, sport, year],
  );
  const personalBests = useMemo(
    () => getPersonalBests(races.data, sport, year),
    [races.data, sport, year],
  );
  const highlights = useMemo(
    () => pickTopHighlights(getAchievementHighlights(races.data, sport, year)),
    [races.data, sport, year],
  );
  const history = useMemo(() => {
    const completed = getCompletedRaces(races.data, year);
    return sport ? completed.filter((race) => race.sport === sport) : completed;
  }, [races.data, sport, year]);

  const disciplineTotals = (['swim', 'bike', 'run'] as Discipline[])
    .map((discipline) => ({
      discipline,
      km:
        discipline === 'swim'
          ? trainingTotals.swimKm
          : discipline === 'bike'
            ? trainingTotals.bikeKm
            : trainingTotals.runKm,
    }))
    .filter(({ km }) => km > 0);

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

            <View style={styles.headlineGrid}>
              <View style={styles.headlineRow}>
                <HeadlineStat label="Races" value={`${aggregate.totalRaces}`} />
                <HeadlineStat label="PRs" value={`${aggregate.prCount}`} />
              </View>
              <View style={styles.headlineRow}>
                <HeadlineStat
                  label="Best AG finish"
                  value={bestAgeGroupPercentile !== null ? `Top ${bestAgeGroupPercentile}%` : '—'}
                />
                <HeadlineStat label="Training" value={`${trainingTotals.hours}h`} />
              </View>
            </View>

            {disciplineTotals.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Training totals" />
                <Card style={styles.disciplineCard}>
                  {disciplineTotals.map(({ discipline, km }) => (
                    <View key={discipline} style={styles.disciplineRow}>
                      <View style={styles.disciplineLabelRow}>
                        <DisciplineIcon discipline={discipline} size={16} color={colors.textPrimary} />
                        <Text style={styles.disciplineLabel}>{DISCIPLINE_LABEL[discipline]}</Text>
                      </View>
                      <Text style={styles.disciplineValue}>{km} km</Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

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

            {highlights.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Highlights" />
                <View style={styles.highlightsList}>
                  {highlights.map(({ race, achievement }) => (
                    <HighlightCard
                      key={`${race.id}-${achievement.label}`}
                      highlight={{ race, achievement }}
                      onPress={() => openRace(race)}
                    />
                  ))}
                </View>
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

function HeadlineStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.headlineStat}>
      <Text style={styles.headlineValue}>{value}</Text>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
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
  filterRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  premiumHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  headlineGrid: {
    gap: spacing.md,
  },
  headlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headlineStat: {
    gap: 2,
  },
  headlineValue: {
    ...typography.display,
    fontSize: 28,
    color: colors.accent,
  },
  section: {
    gap: spacing.sm,
  },
  disciplineCard: {
    gap: spacing.sm,
  },
  disciplineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  disciplineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  disciplineLabel: {
    ...typography.body,
  },
  disciplineValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.accent,
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
  highlightsList: {
    gap: spacing.sm,
  },
});
