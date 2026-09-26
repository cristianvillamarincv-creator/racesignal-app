import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { BuildHistoryEmptyState } from '@/components/BuildHistoryEmptyState';
import { CompactFilterBar, type CompactFilterOption } from '@/components/CompactFilterBar';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { HairlineRule } from '@/components/HairlineRule';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { HighlightCard } from '@/components/stats/HighlightCard';
import type { Race, SportCategory } from '@/fixtures/races';
import { type BrandPalette, tabularNumerals, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { formatFinishTime } from '@/lib/format';
import { getAllHighlights, pickTopHighlights } from '@/lib/highlights';
import { ALL_SPORTS, ALL_YEARS, useRaceFilter } from '@/lib/raceFilterContext';
import { getAvailableSports, getAvailableYears } from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { getAggregateStats, getBestAgeGroupPercentile, getPersonalBests } from '@/lib/stats';
import { isDistanceCanonicalForStats, isHighlightCanonicalForStats } from '@/lib/statsPresentation';
import { minTouchSize, spacing } from '@/lib/theme';

export default function StatsScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const { sportFilter, setSportFilter, yearFilter, setYearFilter } = useRaceFilter();
  const [premiumHint, setPremiumHint] = useState<string | null>(null);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

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
  const highlights = useMemo(
    () => pickTopHighlights(getAllHighlights(races.data, sport, year).filter(isHighlightCanonicalForStats)),
    [races.data, sport, year],
  );

  // Presentation-only filter: only recognized standard distances render on Stats at all. A
  // noncanonical/free-typed distanceLabel (e.g. "Overall Results", "Infinite Mile") is real data —
  // untouched in the underlying race record and still visible via Races/Result Detail — but is
  // excluded from this screen's Personal Bests presentation entirely for V1, per physical-device
  // review: a premium performance report shouldn't surface an obviously questionable metric as a
  // peer of 5K/10K/Half Marathon/etc. See the allowlist's own comment above. The Snapshot's own
  // "Personal Bests" count reflects this same canonical-only set, so the two don't disagree.
  const canonicalPersonalBests = useMemo(
    () => personalBests.filter((pb) => isDistanceCanonicalForStats(pb.distanceLabel)),
    [personalBests],
  );
  const personalBestsCount = canonicalPersonalBests.length;

  // The Performance Snapshot's single hero figure — bestAgeGroupPercentile is the strongest,
  // most legible "how am I performing" fact this data can produce, so it takes the largest type
  // whenever it exists. With no age-group data at all, Races (a genuine, always-available "body of
  // work" figure) steps up as the hero instead, with Personal Bests staying secondary either way.
  const hasPercentileHero = bestAgeGroupPercentile !== null;
  const heroLabel = hasPercentileHero ? 'Best age-group finish' : 'Races logged';
  const heroValue = hasPercentileHero ? `Top ${bestAgeGroupPercentile}%` : `${aggregate.totalRaces}`;
  const supportingMetrics = hasPercentileHero
    ? [
        { label: 'Races', value: `${aggregate.totalRaces}` },
        { label: 'Personal Bests', value: `${personalBestsCount}` },
      ]
    : [{ label: 'Personal Bests', value: `${personalBestsCount}` }];

  const sportLabel = sportFilter === ALL_SPORTS ? 'All sports' : capitalize(sportFilter);
  const yearLabel = yearFilter === ALL_YEARS ? 'All years' : `${yearFilter}`;
  const sportOptions: CompactFilterOption[] = [
    { key: ALL_SPORTS, label: 'All sports', selected: sportFilter === ALL_SPORTS },
    ...sports.map((option) => ({ key: option, label: capitalize(option), selected: sportFilter === option })),
  ];
  const yearOptions: CompactFilterOption[] = [
    { key: ALL_YEARS, label: 'All years', selected: yearFilter === ALL_YEARS },
    ...years.map((option) => ({ key: `${option}`, label: `${option}`, selected: yearFilter === option })),
  ];

  function openRace(race: Race) {
    if (race.locked) {
      setPremiumHint(`${race.name} — full result is Premium.`);
      return;
    }
    router.push(`/results/${race.id}`);
  }

  function selectSport(key: string) {
    setSportFilter(key === ALL_SPORTS ? ALL_SPORTS : (key as SportCategory));
  }

  function selectYear(key: string) {
    setYearFilter(key === ALL_YEARS ? ALL_YEARS : Number(key));
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
            {/* The one shared filter treatment — identical component/behavior to Races. */}
            <CompactFilterBar
              sportLabel={sportLabel}
              yearLabel={yearLabel}
              sportOptions={sportOptions}
              yearOptions={yearOptions}
              onSelectSport={selectSport}
              onSelectYear={selectYear}
            />

            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            {/* Performance Snapshot — a genuine hero module, not three equal-weight columns. The
                strongest available fact (age-group percentile, or Races as a fallback) takes the
                largest type and the card's own tinted surface; Races/Personal Bests read as
                clearly secondary supporting figures beneath it. */}
            <View style={styles.section}>
              <SectionHeader title="Performance snapshot" />
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotHeroLabel}>{heroLabel}</Text>
                <Text style={styles.snapshotHeroValue}>{heroValue}</Text>
                <View style={styles.snapshotSupportRow}>
                  {supportingMetrics.map((metric, index) => (
                    <View
                      key={metric.label}
                      style={[styles.snapshotSupportItem, index > 0 ? styles.snapshotSupportDivider : null]}>
                      <Text style={styles.snapshotSupportValue}>{metric.value}</Text>
                      <Text style={styles.snapshotSupportLabel}>{metric.label}</Text>
                    </View>
                  ))}
                </View>
                {/* Reserved breathing room for a future course-line motif beneath the hero number —
                    intentionally left empty; no motif artwork is generated here. */}
                <View style={styles.snapshotMotifSpace} />
              </View>
            </View>

            {/* Personal Bests — a Record Board: a 2-column grid of compact record modules, each
                its own restrained bordered/tinted module. The section itself communicates
                achievement collectively, so no per-row trophy icon and no gold anywhere here.
                Only canonical distances render here at all (see lib/statsPresentation.ts's
                CANONICAL_DISTANCE_DISPLAY_LABELS) — a noncanonical PB doesn't get a quieter subsection either,
                per physical-device review; it's simply not part of this screen's presentation. */}
            <View style={styles.section}>
              <SectionHeader title="Personal bests" />
              {canonicalPersonalBests.length === 0 ? (
                <EmptyState title="No PRs for this filter" subtitle="Try a different sport or year." />
              ) : (
                <View style={styles.recordGrid}>
                  {canonicalPersonalBests.map((pb) => (
                    <Pressable
                      key={pb.race.id}
                      onPress={() => openRace(pb.race)}
                      accessibilityRole="button"
                      accessibilityLabel={`${pb.distanceLabel} personal best, ${pb.race.name}`}
                      style={styles.recordModule}>
                      <Text style={styles.recordDistance}>{pb.distanceLabel}</Text>
                      <Text style={styles.recordTime}>
                        {pb.race.result ? formatFinishTime(pb.race.result.finishSeconds) : '—'}
                      </Text>
                      <Text style={styles.recordMeta} numberOfLines={1}>
                        {pb.race.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Highlights — "Race highlights": a small number of editorial rows, hairline-separated
                like the Record Board, but each with more internal richness (the AchievementPill as
                its own kicker, generous vertical padding) — richer than Personal Bests without
                becoming a stack of identical rounded cards. */}
            {highlights.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Race highlights" />
                <View style={styles.highlightsList}>
                  {highlights.map((highlight, index) => (
                    <View key={`${highlight.race.id}-${highlight.label}`}>
                      <HighlightCard highlight={highlight} onPress={() => openRace(highlight.race)} />
                      {index < highlights.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
                    </View>
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  premiumHint: TextStyle;
  section: ViewStyle;
  snapshotCard: ViewStyle;
  snapshotHeroLabel: TextStyle;
  snapshotHeroValue: TextStyle;
  snapshotSupportRow: ViewStyle;
  snapshotSupportItem: ViewStyle;
  snapshotSupportDivider: ViewStyle;
  snapshotSupportValue: TextStyle;
  snapshotSupportLabel: TextStyle;
  snapshotMotifSpace: ViewStyle;
  recordGrid: ViewStyle;
  recordModule: ViewStyle;
  recordDistance: TextStyle;
  recordTime: TextStyle;
  recordMeta: TextStyle;
  highlightsList: ViewStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      padding: spacing.lg,
      gap: spacing.lg,
    },
    premiumHint: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
    section: {
      gap: spacing.sm,
    },
    // Performance Snapshot — one of the few surfaces on this screen where a tinted card is
    // sanctioned: it creates the hierarchy that separates the hero figure from everything below it.
    snapshotCard: {
      backgroundColor: withAlpha(palette.signalBlue, 0.06),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
      borderRadius: 20,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    snapshotHeroLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.inkSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    snapshotHeroValue: {
      // Deliberately far larger than any other figure on this screen (or the old 3-column
      // "Best AG finish" column at 24) — this is the screen's single visual focal point.
      fontSize: 56,
      fontWeight: '700',
      color: palette.ink,
      marginTop: 2,
      ...tabularNumerals,
    },
    snapshotSupportRow: {
      flexDirection: 'row',
      marginTop: spacing.sm,
    },
    snapshotSupportItem: {
      gap: 1,
    },
    snapshotSupportDivider: {
      marginLeft: spacing.lg,
      paddingLeft: spacing.lg,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: palette.hairline,
    },
    snapshotSupportValue: {
      fontSize: 19,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    snapshotSupportLabel: {
      fontSize: 12,
      color: palette.inkSecondary,
    },
    snapshotMotifSpace: {
      height: spacing.md,
    },
    recordGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    recordModule: {
      width: '48%',
      minHeight: minTouchSize,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
      backgroundColor: withAlpha(palette.ink, 0.025),
      borderRadius: 14,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
      gap: 1,
    },
    recordDistance: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.inkSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    recordTime: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.ink,
      marginTop: 1,
      ...tabularNumerals,
    },
    recordMeta: {
      fontSize: 12,
      color: palette.inkSecondary,
      marginTop: 3,
    },
    highlightsList: {
      gap: 0,
    },
  });
}
