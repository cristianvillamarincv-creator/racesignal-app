import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BuildHistoryEmptyState } from '@/components/BuildHistoryEmptyState';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FilterChip } from '@/components/FilterChip';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { HighlightCard } from '@/components/stats/HighlightCard';
import type { Race } from '@/fixtures/races';
import { formatFinishTime } from '@/lib/format';
import { getAllHighlights, pickTopHighlights } from '@/lib/highlights';
import { ALL_SPORTS, ALL_YEARS, useRaceFilter } from '@/lib/raceFilterContext';
import { getAvailableSports, getAvailableYears } from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { getAggregateStats, getBestAgeGroupPercentile, getPersonalBests } from '@/lib/stats';
import { colors, spacing, typography } from '@/lib/theme';

export default function StatsScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const { sportFilter, setSportFilter, yearFilter, setYearFilter } = useRaceFilter();
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);

  const sport = sportFilter === ALL_SPORTS ? undefined : sportFilter;
  const year = yearFilter === ALL_YEARS ? undefined : yearFilter;

  const aggregate = useMemo(() => getAggregateStats(races.data, sport, year), [races.data, sport, year]);
  const bestAgeGroupPercentile = useMemo(
    () => getBestAgeGroupPercentile(races.data, sport, year),
    [races.data, sport, year],
  );
  const personalBests = useMemo(
    () => getPersonalBests(races.data, sport, year),
    [races.data, sport, year],
  );
  const personalBestsCount = personalBests.length;
  const highlights = useMemo(
    () => pickTopHighlights(getAllHighlights(races.data, sport, year)),
    [races.data, sport, year],
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
        {races.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : races.isError ? (
          <ErrorState />
        ) : races.data.length === 0 ? (
          <BuildHistoryEmptyState />
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}>
              <FilterChip
                label="All sports"
                selected={sportFilter === ALL_SPORTS}
                onPress={() => setSportFilter(ALL_SPORTS)}
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
                label="All years"
                selected={yearFilter === ALL_YEARS}
                onPress={() => setYearFilter(ALL_YEARS)}
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
                <HeadlineStat label="Personal Bests" value={`${personalBestsCount}`} />
                <HeadlineStat
                  label="Best AG finish"
                  value={bestAgeGroupPercentile !== null ? `Top ${bestAgeGroupPercentile}%` : '—'}
                />
              </View>
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

            {highlights.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Highlights" />
                <View style={styles.highlightsList}>
                  {highlights.map((highlight) => (
                    <HighlightCard
                      key={`${highlight.race.id}-${highlight.label}`}
                      highlight={highlight}
                      onPress={() => openRace(highlight.race)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
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
  headlineFootnote: {
    ...typography.caption,
    color: colors.textMuted,
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
    color: colors.achievement,
    fontWeight: '700',
  },
  highlightsList: {
    gap: spacing.sm,
  },
});
