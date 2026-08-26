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
import { HighlightCard } from '@/components/stats/HighlightCard';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { racesEmpty, racesPopulated, type Race } from '@/fixtures/races';
import { checklistProgress } from '@/lib/format';
import {
  getAllHighlights,
  getAllHighlightsUnfiltered,
  getPRPerformancesInYear,
  pickTopHighlights,
} from '@/lib/highlights';
import { getAvailableYears, getCompletedRaces, getNextRace } from '@/lib/races';
import { getBestAgeGroupPercentile } from '@/lib/stats';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

export default function HomeScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const years = useMemo(() => getAvailableYears(races.data), [races.data]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const activeYear = selectedYear ?? years[0] ?? new Date().getFullYear();
  const isCurrentYear = activeYear === years[0];
  const yearIndex = years.indexOf(activeYear);
  const canGoOlder = yearIndex >= 0 && yearIndex < years.length - 1;
  const canGoNewer = yearIndex > 0;

  const nextRace = getNextRace(races.data);
  const yearRaces = useMemo(
    () => getCompletedRaces(races.data, activeYear),
    [races.data, activeYear],
  );
  const prPerformancesThisYear = useMemo(
    () => getPRPerformancesInYear(races.data, activeYear),
    [races.data, activeYear],
  );
  const bestAgeGroupPercentile = useMemo(
    () => getBestAgeGroupPercentile(races.data, undefined, activeYear),
    [races.data, activeYear],
  );
  const yearHighlights = useMemo(
    () => pickTopHighlights(getAllHighlights(races.data, undefined, activeYear), 4),
    [races.data, activeYear],
  );
  const allHighlights = useMemo(() => getAllHighlightsUnfiltered(races.data), [races.data]);

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
              nextRace ? (
                <RaceCountdownCard
                  race={nextRace}
                  checklistPercent={checklistProgress(checklistItemsPopulated)}
                  onOpenRace={() => router.push(`/race/${nextRace.id}`)}
                />
              ) : (
                <EmptyState
                  title="Add your next race"
                  subtitle="Nothing confirmed by your imported race history yet."
                />
              )
            ) : null}

            <View style={styles.statsRow}>
              <Stat label="Races" value={`${yearRaces.length}`} />
              <Stat label="PRs this year" value={`${prPerformancesThisYear.length}`} />
              <Stat
                label="Best AG finish"
                value={bestAgeGroupPercentile !== null ? `Top ${bestAgeGroupPercentile}%` : '—'}
              />
            </View>

            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            <View style={styles.section}>
              <SectionHeader title="Highlights" />
              {yearHighlights.length === 0 ? (
                <EmptyState title="No highlights yet" subtitle={`Nothing notable recorded for ${activeYear} yet.`} />
              ) : (
                <View style={styles.highlightsList}>
                  {yearHighlights.map((highlight) => (
                    <HighlightCard
                      key={`${highlight.race.id}-${highlight.label}`}
                      highlight={highlight}
                      onPress={() => openRace(highlight.race)}
                    />
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title={`${activeYear} races`} />
              {yearRaces.length === 0 ? (
                <EmptyState title="No races" subtitle={`Nothing completed in ${activeYear}.`} />
              ) : (
                yearRaces.map((race) => (
                  <SeasonRaceRow
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

            {isCurrentYear ? (
              <Card style={styles.stravaCard}>
                <Text style={typography.subtitle}>Connect Strava to see your training</Text>
                <Text style={styles.stravaCopy}>
                  A future connection would add recent activities, annual swim/bike/run totals,
                  training time, gear mileage, and training milestones — not connected yet.
                </Text>
              </Card>
            ) : null}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
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
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    gap: 2,
  },
  statValue: {
    ...typography.title,
    color: colors.accent,
  },
  premiumHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  section: {
    gap: spacing.sm,
  },
  highlightsList: {
    gap: spacing.sm,
  },
  stravaCard: {
    gap: spacing.xs,
  },
  stravaCopy: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
