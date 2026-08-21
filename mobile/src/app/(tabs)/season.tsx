import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { SeasonRaceRow } from '@/components/season/SeasonRaceRow';
import { racesEmpty, racesPopulated, type Race, type SportCategory } from '@/fixtures/races';
import { getAvailableSports, getAvailableYears, getCompletedRaces, getUpcomingRaces } from '@/lib/races';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

const ALL_SPORTS = 'all' as const;
const ALL_YEARS = 'all' as const;

export default function SeasonScreen() {
  const router = useRouter();
  const races = useFixtureData(racesPopulated, racesEmpty);
  const [sportFilter, setSportFilter] = useState<SportCategory | typeof ALL_SPORTS>(ALL_SPORTS);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL_YEARS>(ALL_YEARS);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);

  const upcoming = useMemo(() => {
    const all = getUpcomingRaces(races.data);
    return sportFilter === ALL_SPORTS ? all : all.filter((race) => race.sport === sportFilter);
  }, [races.data, sportFilter]);

  const completed = useMemo(() => {
    const all = getCompletedRaces(races.data, yearFilter === ALL_YEARS ? undefined : yearFilter);
    return sportFilter === ALL_SPORTS ? all : all.filter((race) => race.sport === sportFilter);
  }, [races.data, sportFilter, yearFilter]);

  function openRace(race: Race) {
    if (race.status === 'completed') {
      if (race.locked) {
        setPremiumHint(`${race.name} is a detailed result — unlock it with Premium.`);
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
                <EmptyState title="No upcoming races" subtitle="Nothing matches this filter yet." />
              ) : (
                upcoming.map((race) => (
                  <SeasonRaceRow key={race.id} race={race} onPress={() => openRace(race)} />
                ))
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader title="Completed" />
              {completed.length === 0 ? (
                <EmptyState title="No completed races" subtitle="Nothing matches this filter yet." />
              ) : (
                completed.map((race) => (
                  <SeasonRaceRow key={race.id} race={race} onPress={() => openRace(race)} />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
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
  section: {
    gap: spacing.xs,
  },
});
