import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceCountdownCard } from '@/components/race/RaceCountdownCard';
import { SectionHeader } from '@/components/SectionHeader';
import { SeasonRaceRow } from '@/components/season/SeasonRaceRow';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { nextRaceEmpty, nextRacePopulated } from '@/fixtures/race';
import {
  friendsSeasonEmpty,
  friendsSeasonPopulated,
  mySeasonCompletedEmpty,
  mySeasonCompletedPopulated,
  mySeasonUpcomingEmpty,
  mySeasonUpcomingPopulated,
  seasonYears,
  type SeasonSportFilter,
} from '@/fixtures/season';
import { checklistProgress } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

const SPORT_FILTERS: { key: SeasonSportFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'triathlon', label: 'Triathlon' },
  { key: 'running', label: 'Running' },
  { key: 'cycling', label: 'Cycling' },
  { key: 'swimming', label: 'Swimming' },
  { key: 'duathlon', label: 'Duathlon' },
  { key: 'other', label: 'Other' },
];

export default function SeasonScreen() {
  const router = useRouter();
  const [segment, setSegment] = useState<'mine' | 'friends'>('mine');
  const [sportFilter, setSportFilter] = useState<SeasonSportFilter>('all');
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const race = useFixtureData(nextRacePopulated, nextRaceEmpty);
  const upcoming = useFixtureData(mySeasonUpcomingPopulated, mySeasonUpcomingEmpty);
  const completed = useFixtureData(mySeasonCompletedPopulated, mySeasonCompletedEmpty);
  const friends = useFixtureData(friendsSeasonPopulated, friendsSeasonEmpty);

  const isLoading = race.isLoading || upcoming.isLoading || completed.isLoading || friends.isLoading;
  const isError = race.isError || upcoming.isError || completed.isError || friends.isError;

  const filteredUpcoming = useMemo(
    () => filterBySport(upcoming.data, sportFilter),
    [upcoming.data, sportFilter],
  );
  const filteredCompleted = useMemo(
    () => filterBySport(completed.data, sportFilter),
    [completed.data, sportFilter],
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : isError ? (
          <ErrorState />
        ) : (
          <>
            {race.data ? (
              <RaceCountdownCard
                race={race.data}
                checklistPercent={checklistProgress(checklistItemsPopulated)}
                onOpenRace={() => router.push(`/race/${race.data!.id}`)}
                actionLabel="Prepare"
              />
            ) : null}

            <View style={styles.segmentedControl}>
              <SegmentButton
                label="My Season"
                active={segment === 'mine'}
                onPress={() => setSegment('mine')}
              />
              <SegmentButton
                label="Friends' Season"
                active={segment === 'friends'}
                onPress={() => setSegment('friends')}
              />
            </View>

            <View style={styles.yearRow}>
              {seasonYears.map((option) => (
                <Pressable
                  key={option.year}
                  onPress={() =>
                    option.locked
                      ? setPremiumHint('Previous seasons are part of Premium.')
                      : setPremiumHint(null)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    option.locked ? `${option.year}, locked, Premium required` : `${option.year}`
                  }
                  style={styles.yearChip}>
                  <Text style={[typography.caption, option.locked && styles.yearLocked]}>
                    {option.year}
                    {option.locked ? ' 🔒' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            {segment === 'mine' ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}>
                  {SPORT_FILTERS.map((filter) => (
                    <Pressable
                      key={filter.key}
                      onPress={() => setSportFilter(filter.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${filter.label}`}
                      accessibilityState={{ selected: sportFilter === filter.key }}
                      style={[
                        styles.filterChip,
                        sportFilter === filter.key && styles.filterChipActive,
                      ]}>
                      <Text
                        style={[
                          styles.filterLabel,
                          sportFilter === filter.key && styles.filterLabelActive,
                        ]}>
                        {filter.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.section}>
                  <SectionHeader title="Upcoming" />
                  {filteredUpcoming.length === 0 ? (
                    <EmptyState title="No upcoming races" subtitle="Nothing matches this filter yet." />
                  ) : (
                    filteredUpcoming.map((race) => <SeasonRaceRow key={race.id} race={race} />)
                  )}
                </View>

                <View style={styles.section}>
                  <SectionHeader title="Completed" />
                  {filteredCompleted.length === 0 ? (
                    <EmptyState title="No completed races" subtitle="Completed races will show up here." />
                  ) : (
                    filteredCompleted.map((race) => <SeasonRaceRow key={race.id} race={race} />)
                  )}
                </View>
              </>
            ) : (
              <View style={styles.section}>
                <SectionHeader title="Friends racing" />
                {friends.data.length === 0 ? (
                  <EmptyState
                    title="No shared races yet"
                    subtitle="Races your Circle shares will show up here."
                  />
                ) : (
                  friends.data.map((entry) => (
                    <View key={entry.raceId} style={styles.friendEntry}>
                      <Text style={typography.subtitle}>{entry.raceName}</Text>
                      <Text style={styles.friendMeta}>{entry.location}</Text>
                      <View style={styles.friendMembers}>
                        {entry.members.map((member) => (
                          <Badge
                            key={member.name}
                            label={`${member.name} · ${member.status === 'registered' ? 'Registered' : 'Considering'}`}
                          />
                        ))}
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
      <FloatingActionButton onPress={() => router.push('/signal/new')} />
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function filterBySport<T extends { sport: string }>(races: T[], filter: SeasonSportFilter): T[] {
  if (filter === 'all') return races;
  return races.filter((race) => race.sport === filter);
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
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: 999,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  segmentButtonActive: {
    backgroundColor: colors.accent,
  },
  segmentLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  segmentLabelActive: {
    color: colors.background,
  },
  yearRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  yearChip: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  yearLocked: {
    color: colors.textMuted,
  },
  premiumHint: {
    ...typography.caption,
    color: colors.warning,
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
  section: {
    gap: spacing.xs,
  },
  friendEntry: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  friendMeta: {
    ...typography.caption,
  },
  friendMembers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
});
