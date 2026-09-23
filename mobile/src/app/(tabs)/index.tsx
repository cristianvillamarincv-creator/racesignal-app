import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BuildHistoryEmptyState } from '@/components/BuildHistoryEmptyState';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FilterChip } from '@/components/FilterChip';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceRow } from '@/components/races/RaceRow';
import { UpcomingCarousel } from '@/components/races/UpcomingCarousel';
import { SectionHeader } from '@/components/SectionHeader';
import type { Race } from '@/fixtures/races';
import { getAllHighlightsUnfiltered, pickPrimaryHighlight } from '@/lib/highlights';
import { ALL_SPORTS, ALL_YEARS, useRaceFilter } from '@/lib/raceFilterContext';
import {
  filterRacesByName,
  getAvailableSports,
  getAvailableYears,
  getCompletedRaces,
  getUpcomingRaces,
  groupCompletedRacesByYear,
  yearOf,
} from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAROUSEL_CARD_WIDTH = SCREEN_WIDTH - spacing.lg * 2;

/**
 * Races — "what I've done / what's next" (Step 4). Replaces the old three-way Home/Season/Stats
 * split: Home added a year-scoped remix of the other two tabs plus a placeholder Strava card, all
 * cut. This is now the single canonical place race history is browsed; Stats never lists raw
 * races (see stats.tsx) — it only ever deep-links back here. Kept as `index.tsx` so it's the tab
 * group's default/first screen, including immediately after onboarding.
 */
export default function RacesScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const { sportFilter, setSportFilter, yearFilter, setYearFilter, searchFocusRequestId } = useRaceFilter();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  // The header search icon is the one global entry point (reachable from Stats too, which has no
  // search field of its own) — this bumps a counter rather than navigating with a param, so it
  // reliably reveals + refocuses even when Races is already the active, already-mounted tab.
  useEffect(() => {
    if (searchFocusRequestId === 0) return;
    setIsSearchVisible(true);
    // Already visible (e.g. tapped again from Stats after an earlier reveal) — the field already
    // exists, so focus it directly. If it's newly revealed this render, the ref isn't mounted yet;
    // the effect below (keyed on isSearchVisible) catches that case once the row actually renders.
    searchInputRef.current?.focus();
  }, [searchFocusRequestId]);

  useEffect(() => {
    if (isSearchVisible) searchInputRef.current?.focus();
  }, [isSearchVisible]);

  function closeSearch() {
    setSearchQuery('');
    setIsSearchVisible(false);
    Keyboard.dismiss();
  }

  const sports = useMemo(() => getAvailableSports(races.data), [races.data]);
  const years = useMemo(() => getAvailableYears(races.data), [races.data]);
  const allHighlights = useMemo(() => getAllHighlightsUnfiltered(races.data), [races.data]);
  const isSearching = searchQuery.trim().length > 0;

  const upcomingAll = useMemo(() => getUpcomingRaces(races.data), [races.data]);
  const upcomingFiltered = useMemo(() => {
    let list = upcomingAll;
    if (sportFilter !== ALL_SPORTS) list = list.filter((race) => race.sport === sportFilter);
    if (yearFilter !== ALL_YEARS) list = list.filter((race) => yearOf(race.eventDate) === yearFilter);
    if (isSearching) list = filterRacesByName(list, searchQuery);
    return list;
  }, [upcomingAll, sportFilter, yearFilter, searchQuery, isSearching]);

  const completedFiltered = useMemo(() => {
    let list = getCompletedRaces(races.data);
    if (sportFilter !== ALL_SPORTS) list = list.filter((race) => race.sport === sportFilter);
    if (yearFilter !== ALL_YEARS) list = list.filter((race) => yearOf(race.eventDate) === yearFilter);
    if (isSearching) list = filterRacesByName(list, searchQuery);
    return list;
  }, [races.data, sportFilter, yearFilter, searchQuery, isSearching]);

  const yearGroups = useMemo(() => groupCompletedRacesByYear(completedFiltered), [completedFiltered]);

  function primaryHighlightFor(race: Race) {
    return pickPrimaryHighlight(allHighlights.filter((highlight) => highlight.race.id === race.id));
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
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled">
        {races.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : races.isError ? (
          <ErrorState />
        ) : races.data.length === 0 ? (
          <BuildHistoryEmptyState />
        ) : (
          <>
            {isSearchVisible ? (
              <View style={styles.searchRow}>
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search races by name"
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  accessibilityLabel="Search races by name"
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <Pressable
                  onPress={closeSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel search"
                  hitSlop={8}
                  style={styles.cancelButton}>
                  <Text style={styles.cancelButtonLabel}>Cancel</Text>
                </Pressable>
              </View>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}>
              <FilterChip
                label="All sports"
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

            {!isSearching ? (
              upcomingFiltered.length > 0 ? (
                <View style={styles.section}>
                  <SectionHeader title="Upcoming" />
                  <UpcomingCarousel
                    races={upcomingFiltered}
                    cardWidth={CAROUSEL_CARD_WIDTH}
                    onOpenRace={(race) => router.push(`/race/${race.id}`)}
                  />
                </View>
              ) : upcomingAll.length === 0 ? (
                <EmptyState title="Add your next race" subtitle="Nothing on your calendar yet.">
                  <Pressable
                    onPress={() => router.push('/race/add')}
                    accessibilityRole="button"
                    accessibilityLabel="Add your next race"
                    style={styles.addRaceButton}>
                    <Text style={styles.addRaceButtonLabel}>+ Add next race</Text>
                  </Pressable>
                </EmptyState>
              ) : null
            ) : upcomingFiltered.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Upcoming" />
                <Card>
                  {upcomingFiltered.map((race, index) => (
                    <RaceRow
                      key={race.id}
                      race={race}
                      primaryHighlight={primaryHighlightFor(race)}
                      onPress={() => openRace(race)}
                      isLast={index === upcomingFiltered.length - 1}
                    />
                  ))}
                </Card>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Completed" />
              {completedFiltered.length === 0 ? (
                <EmptyState
                  title={isSearching ? 'No matching races' : 'No completed races'}
                  subtitle={isSearching ? 'Try a different name.' : 'Nothing matches this filter yet.'}
                />
              ) : (
                yearGroups.map((group) => (
                  <View key={group.year} style={styles.yearGroup}>
                    <Text style={styles.yearHeader}>{group.year}</Text>
                    <Card>
                      {group.races.map((race, index) => (
                        <RaceRow
                          key={race.id}
                          race={race}
                          primaryHighlight={primaryHighlightFor(race)}
                          onPress={() => openRace(race)}
                          isLast={index === group.races.length - 1}
                        />
                      ))}
                    </Card>
                  </View>
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: minTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
  cancelButton: {
    minHeight: minTouchSize,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonLabel: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
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
    gap: spacing.sm,
  },
  yearGroup: {
    gap: spacing.xs,
  },
  yearHeader: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
});
