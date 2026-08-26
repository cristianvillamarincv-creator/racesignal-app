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
import { formatFinishTime } from '@/lib/format';
import { getAllHighlights, getAllHighlightsUnfiltered, pickTopHighlights } from '@/lib/highlights';
import { getAvailableSports, getAvailableYears, getCompletedRaces } from '@/lib/races';
import { getAggregateStats, getAverageAgeGroupPercentile, getBestAgeGroupPercentile, getPersonalBests } from '@/lib/stats';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

const OVERALL = 'overall' as const;
const ALL_TIME = 'all_time' as const;

// The source's "5K" section entry is this race's 5K split, not a standalone race — see the split's
// own note on the race for the full explanation. Surfaced here as a one-off, not part of the
// generic Personal Bests ladder (see fixtures/races.ts).
const FIVE_K_SPLIT_SOURCE_RACE_ID = 'sporting-life-10k-2024';
const FIVE_K_SPLIT_YEAR = 2024;

export default function StatsScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const [sportFilter, setSportFilter] = useState<SportCategory | typeof OVERALL>(OVERALL);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL_TIME>(ALL_TIME);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);

  const sport = sportFilter === OVERALL ? undefined : sportFilter;
  const year = yearFilter === ALL_TIME ? undefined : yearFilter;

  const aggregate = useMemo(() => getAggregateStats(races.data, sport, year), [races.data, sport, year]);
  const bestAgeGroupPercentile = useMemo(
    () => getBestAgeGroupPercentile(races.data, sport, year),
    [races.data, sport, year],
  );
  const averageAgeGroup = useMemo(
    () => getAverageAgeGroupPercentile(races.data, sport, year),
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
  const history = useMemo(() => {
    const completed = getCompletedRaces(races.data, year);
    return sport ? completed.filter((race) => race.sport === sport) : completed;
  }, [races.data, sport, year]);
  const allHighlights = useMemo(() => getAllHighlightsUnfiltered(races.data), [races.data]);

  const fiveKSplitRace = races.data.find((race) => race.id === FIVE_K_SPLIT_SOURCE_RACE_ID);
  const fiveKSplit = fiveKSplitRace?.result?.splits.find((split) => split.label === '5K');
  const showFiveKCallout =
    fiveKSplit !== undefined &&
    (sportFilter === OVERALL || sportFilter === 'running') &&
    (yearFilter === ALL_TIME || yearFilter === FIVE_K_SPLIT_YEAR);

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
                <HeadlineStat label="Personal Bests" value={`${personalBestsCount}`} />
              </View>
              <View style={styles.headlineRow}>
                <HeadlineStat
                  label="Average AG finish"
                  value={averageAgeGroup.percentile !== null ? `Top ${averageAgeGroup.percentile}%` : '—'}
                />
                <HeadlineStat
                  label="Best AG finish"
                  value={bestAgeGroupPercentile !== null ? `Top ${bestAgeGroupPercentile}%` : '—'}
                />
              </View>
              {averageAgeGroup.raceCount > 0 ? (
                <Text style={styles.headlineFootnote}>
                  Average AG finish is based on {averageAgeGroup.raceCount} race
                  {averageAgeGroup.raceCount === 1 ? '' : 's'} with complete AG fields.
                </Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Personal bests" />
              {personalBests.length === 0 && !showFiveKCallout ? (
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
                  {showFiveKCallout && fiveKSplitRace ? (
                    <Pressable
                      onPress={() => openRace(fiveKSplitRace)}
                      accessibilityRole="button"
                      accessibilityLabel={`5K best, split from ${fiveKSplitRace.name}`}
                      style={[styles.prRow, styles.splitRow]}>
                      <Text style={styles.prDistance}>5K best (split)</Text>
                      <Text style={styles.prTime}>{formatFinishTime(fiveKSplit!.elapsedSeconds)}</Text>
                    </Pressable>
                  ) : null}
                </Card>
              )}
              {showFiveKCallout ? (
                <Text style={styles.splitNote}>
                  Not a standalone race — the 5K split from {fiveKSplitRace?.name},{' '}
                  {fiveKSplitRace?.eventDate.slice(0, 4)}.
                </Text>
              ) : null}
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

            <View style={styles.section}>
              <SectionHeader title="Race history" />
              {history.length === 0 ? (
                <EmptyState title="No races" subtitle="Nothing matches this filter yet." />
              ) : (
                history.map((race) => (
                  <RaceHistoryRow
                    key={race.id}
                    race={race}
                    highlights={pickTopHighlights(
                      allHighlights.filter((highlight) => highlight.race.id === race.id),
                      2,
                    )}
                    onPress={() => openRace(race)}
                  />
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
  splitRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
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
  splitNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  highlightsList: {
    gap: spacing.sm,
  },
});
