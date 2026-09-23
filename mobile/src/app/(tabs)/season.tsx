import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BuildHistoryEmptyState } from '@/components/BuildHistoryEmptyState';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FilterChip } from '@/components/FilterChip';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { SeasonRaceRow } from '@/components/season/SeasonRaceRow';
import type { Race, SportCategory } from '@/fixtures/races';
import { getAllHighlightsUnfiltered, pickTopHighlights } from '@/lib/highlights';
import { getAvailableSports, getAvailableYears, getCompletedRaces, getUpcomingRaces } from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

const ALL_SPORTS = 'all' as const;
const ALL_YEARS = 'all' as const;

export default function SeasonScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const [sportFilter, setSportFilter] = useState<SportCategory | typeof ALL_SPORTS>(ALL_SPORTS);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL_YEARS>(ALL_YEARS);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);
  const allHighlights = useMemo(() => getAllHighlightsUnfiltered(races.data), [races.data]);

  const upcoming = useMemo(() => {
    const all = getUpcomingRaces(races.data);
    return sportFilter === ALL_SPORTS ? all : all.filter((race) => race.sport === sportFilter);
  }, [races.data, sportFilter]);

  const completed = useMemo(() => {
    const all = getCompletedRaces(races.data, yearFilter === ALL_YEARS ? undefined : yearFilter);
    return sportFilter === ALL_SPORTS ? all : all.filter((race) => race.sport === sportFilter);
  }, [races.data, sportFilter, yearFilter]);

  function highlightsFor(race: Race) {
    return pickTopHighlights(allHighlights.filter((highlight) => highlight.race.id === race.id), 2);
  }

  function openRace(race: Race) {
    if (race.status === 'completed') {
      if (race.locked) {
        setPremiumHint(`${race.name} — full result is Premium.`);
        return;
      }
      router.push(`/results/${race.id}`);
    } else {
      router.push(`/race/${race.id}`);
    }
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
                label="All"
                selected={sportFilter === ALL_SPORTS}
                onPress={() => setSportFilter(ALL_SPORTS)}
              />
              {sports.map((sport) => (
                <FilterChip
                  key={sport}
                  label={capitalize(sport)}
                  selected={sportFilter === sport}
                  onPress={() => setSportFilter(sport)}
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
              {years.map((year) => (
                <FilterChip
                  key={year}
                  label={`${year}`}
                  selected={yearFilter === year}
                  onPress={() => setYearFilter(year)}
                />
              ))}
            </ScrollView>

            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            <View style={styles.section}>
              <SectionHeader title="Upcoming" />
              {upcoming.length === 0 ? (
                <EmptyState title="Add your next race" subtitle="Nothing on your calendar yet.">
                  <Pressable
                    onPress={() => router.push('/race/add')}
                    accessibilityRole="button"
                    accessibilityLabel="Add your next race"
                    style={styles.addRaceButton}>
                    <Text style={styles.addRaceButtonLabel}>+ Add next race</Text>
                  </Pressable>
                </EmptyState>
              ) : (
                upcoming.map((race) => (
                  <SeasonRaceRow
                    key={race.id}
                    race={race}
                    highlights={highlightsFor(race)}
                    onPress={() => openRace(race)}
                  />
                ))
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Completed" />
              {completed.length === 0 ? (
                <EmptyState title="No completed races" subtitle="Nothing matches this filter yet." />
              ) : (
                completed.map((race) => (
                  <SeasonRaceRow
                    key={race.id}
                    race={race}
                    highlights={highlightsFor(race)}
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
  addRaceButton: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  addRaceButtonLabel: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 15,
  },
  section: {
    gap: spacing.xs,
  },
});
