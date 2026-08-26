import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AchievementBadge } from '@/components/AchievementBadge';
import { Card } from '@/components/Card';
import { racesPopulated, type Race, type RaceRank } from '@/fixtures/races';
import { formatFinishTime, formatOrdinal, formatRaceDate, getTopPercentile } from '@/lib/format';
import { getHighlightsForRace } from '@/lib/highlights';
import { colors, spacing, typography } from '@/lib/theme';

const SOURCE_LABEL: Record<NonNullable<Race['result']>['sourceStatus'], string> = {
  official_confirmed: 'Official source confirmed',
  imported_confirmed: 'Imported and confirmed',
  self_reported: 'Self-reported',
};

export default function RaceResultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const race = racesPopulated.find((candidate) => candidate.id === id);

  if (!race || !race.result) {
    return (
      <View style={styles.screen}>
        <View style={styles.notFound}>
          <Text style={typography.subtitle}>Result not found.</Text>
        </View>
      </View>
    );
  }

  const { result } = race;
  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;
  const highlights = getHighlightsForRace(racesPopulated, race.id);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: race.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={typography.label}>{race.sport.toUpperCase()} · {race.distanceLabel}</Text>
          <Text style={styles.name}>{race.name}</Text>
          <Text style={styles.finishTime}>{formatFinishTime(result.finishSeconds)}</Text>
          <Text style={styles.meta}>
            {dateLabel} · {race.location}
          </Text>

          {highlights.length > 0 ? (
            <View style={styles.badgeRow}>
              {highlights.map((highlight) => (
                <AchievementBadge key={highlight.label} achievement={highlight} />
              ))}
            </View>
          ) : null}
        </Card>

        {result.splits.length > 0 ? (
          <Card style={styles.section}>
            <Text style={typography.label}>SPLITS</Text>
            {result.splits.map((split) => (
              <View key={split.label} style={styles.splitRow}>
                <Text style={styles.splitLabel}>{split.label}</Text>
                <View style={styles.splitValues}>
                  <Text style={styles.splitTime}>{formatFinishTime(split.elapsedSeconds)}</Text>
                  {split.paceLabel ? <Text style={styles.splitPace}>{split.paceLabel}</Text> : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {result.overallRank || result.genderRank || result.ageGroupRank ? (
          <Card style={styles.section}>
            <Text style={typography.label}>RANKINGS</Text>
            {result.overallRank ? (
              <RankRow label="Overall" rank={result.overallRank} needsConfirmation={result.rankingNeedsConfirmation} />
            ) : null}
            {result.genderRank ? (
              <RankRow label="Gender" rank={result.genderRank} needsConfirmation={result.rankingNeedsConfirmation} />
            ) : null}
            {result.ageGroupRank ? (
              <RankRow
                label={result.ageGroupRank.ageGroup ? `Age group (${result.ageGroupRank.ageGroup})` : 'Age group'}
                rank={result.ageGroupRank}
                needsConfirmation={result.rankingNeedsConfirmation}
              />
            ) : null}
          </Card>
        ) : null}

        {result.sourceNotes && result.sourceNotes.length > 0 ? (
          <Card style={styles.section}>
            <Text style={typography.label}>NOTES</Text>
            {result.sourceNotes.map((note) => (
              <Text key={note} style={styles.note}>
                • {note}
              </Text>
            ))}
          </Card>
        ) : null}

        <Card style={styles.section}>
          <Text style={typography.label}>SOURCE</Text>
          <Text style={styles.meta}>{SOURCE_LABEL[result.sourceStatus]}</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

function RankRow({
  label,
  rank,
  needsConfirmation,
}: {
  label: string;
  rank: RaceRank;
  needsConfirmation?: boolean;
}) {
  const hasField = rank.field !== undefined;
  return (
    <View style={styles.splitRow}>
      <Text style={styles.splitLabel}>{label}</Text>
      <View style={styles.splitValues}>
        <Text style={styles.splitTime}>
          {hasField ? `${rank.place} / ${rank.field}` : formatOrdinal(rank.place)}
        </Text>
        {needsConfirmation ? (
          <Text style={styles.needsConfirmation}>Needs confirmation</Text>
        ) : hasField ? (
          <Text style={styles.splitPace}>Top {getTopPercentile(rank.place, rank.field!)}%</Text>
        ) : null}
      </View>
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
  name: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  finishTime: {
    ...typography.display,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  meta: {
    ...typography.caption,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  splitLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  splitValues: {
    alignItems: 'flex-end',
  },
  splitTime: {
    ...typography.body,
    fontWeight: '600',
  },
  splitPace: {
    ...typography.caption,
  },
  needsConfirmation: {
    ...typography.caption,
    color: colors.warning,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
