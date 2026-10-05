import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BuildHistoryEmptyState } from '@/components/BuildHistoryEmptyState';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FilterPillRows, type FilterOption } from '@/components/FilterPillRows';
import { HairlineRule } from '@/components/HairlineRule';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceRow } from '@/components/races/RaceRow';
import { UpcomingCarousel } from '@/components/races/UpcomingCarousel';
import { SectionHeader } from '@/components/SectionHeader';
import type { Race, SportCategory } from '@/fixtures/races';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
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
import { minTouchSize, spacing } from '@/lib/theme';

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
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { sportFilter, setSportFilter, yearFilter, setYearFilter, searchFocusRequestId } = useRaceFilter();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
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

  const sportOptions: FilterOption[] = [
    { key: ALL_SPORTS, label: 'All sports', selected: sportFilter === ALL_SPORTS },
    ...sports.map((option) => ({ key: option, label: capitalize(option), selected: sportFilter === option })),
  ];
  const yearOptions: FilterOption[] = [
    { key: ALL_YEARS, label: 'All years', selected: yearFilter === ALL_YEARS },
    ...years.map((option) => ({ key: `${option}`, label: `${option}`, selected: yearFilter === option })),
  ];

  function selectSport(key: string) {
    setSportFilter(key === ALL_SPORTS ? ALL_SPORTS : (key as SportCategory));
  }

  function selectYear(key: string) {
    setYearFilter(key === ALL_YEARS ? ALL_YEARS : Number(key));
  }

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
                  placeholderTextColor={palette.inkSecondary}
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

            {/* The one shared filter treatment — identical component/behavior to Stats. Two
                horizontally-scrolling rows of always-visible pills (sport, then year) — see
                components/FilterPillRows.tsx for why this was restored over a compact single-line
                picker. */}
            <FilterPillRows
              sportOptions={sportOptions}
              yearOptions={yearOptions}
              onSelectSport={selectSport}
              onSelectYear={selectYear}
            />

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
                <View style={styles.rowsGroup}>
                  {upcomingFiltered.map((race, index) => (
                    <RaceRow
                      key={race.id}
                      race={race}
                      primaryHighlight={primaryHighlightFor(race)}
                      onPress={() => openRace(race)}
                      isLast={index === upcomingFiltered.length - 1}
                    />
                  ))}
                </View>
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
                yearGroups.map((group, index) => (
                  <View key={group.year} style={[styles.yearGroup, index === 0 && styles.firstYearGroup]}>
                    <Text style={styles.yearHeader}>{group.year}</Text>
                    <View style={styles.yearHeaderRule}>
                      <HairlineRule color={palette.hairline} />
                    </View>
                    <View style={styles.rowsGroup}>
                      {group.races.map((race, index) => (
                        <RaceRow
                          key={race.id}
                          race={race}
                          primaryHighlight={primaryHighlightFor(race)}
                          onPress={() => openRace(race)}
                          isLast={index === group.races.length - 1}
                        />
                      ))}
                    </View>
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

function createStyles(palette: BrandPalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
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
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      color: palette.ink,
    },
    cancelButton: {
      minHeight: minTouchSize,
      paddingHorizontal: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButtonLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.signalBlue,
    },
    addRaceButton: {
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: palette.signalBlue,
    },
    addRaceButtonLabel: {
      color: palette.onSignalBlue,
      fontWeight: '700',
      fontSize: 15,
    },
    section: {
      gap: spacing.sm,
    },
    rowsGroup: {
      gap: 0,
    },
    yearGroup: {
      gap: 0,
      // Real editorial separation BETWEEN one year's races and the next year's — per physical-
      // device review, spacing.xxl + spacing.sm (40) read as too much dead space between the final
      // race of one year and the next year heading. spacing.xl (24) keeps a deliberate section
      // break (clearly more than a row-to-row gap, which relies on RaceRow's own internal padding
      // with no extra gap here) without the previous oversized whitespace. Individual race rows and
      // achievement-pill spacing (RaceRow.tsx) are untouched.
      marginTop: spacing.xl,
    },
    // The first year group sits directly under the "Completed" section label, which already carries
    // its own marginBottom — stacking the full inter-year gap on top of that made the top of the
    // list oversized. A large 32px/800 year number still has enough visual mass to read as its own
    // disconnected block even at a small gap, so this pulls it up slightly closer to "Completed"
    // rather than relying on the section-header spacing alone.
    firstYearGroup: {
      marginTop: -4,
    },
    // A year is a bigger structural moment than a mid-page section label (SectionHeader's 17px) —
    // sized closer to a real editorial section break, not just another line of text. Kept tight to
    // the hairline/first race below it so "Completed" → year → first race reads as one section.
    yearHeader: {
      fontSize: 32,
      fontWeight: '800',
      color: palette.ink,
      marginBottom: 2,
      ...tabularNumerals,
    },
    yearHeaderRule: {
      marginBottom: 2,
    },
  });
}
