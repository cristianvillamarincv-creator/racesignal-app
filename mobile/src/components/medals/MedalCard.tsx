import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import type { MedalCard as MedalCardData } from '@/fixtures/medals';
import { formatFinishTime } from '@/lib/format';
import { colors, spacing, typography } from '@/lib/theme';

const TAG_LABEL: Record<NonNullable<MedalCardData['tag']>, string> = {
  course_best: 'Course best',
  distance_pr: 'Distance PR',
};

interface MedalCardProps {
  medal: MedalCardData;
  expanded: boolean;
  onToggleExpand: () => void;
  onLockedPress: () => void;
}

export function MedalCard({ medal, expanded, onToggleExpand, onLockedPress }: MedalCardProps) {
  const eventDate = new Date(`${medal.eventDate}T00:00:00`);
  const dateLabel = eventDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Pressable
      onPress={medal.locked ? onLockedPress : onToggleExpand}
      accessibilityRole="button"
      accessibilityLabel={
        medal.locked
          ? `${medal.name}, locked, Premium required to view details`
          : `${medal.name}, ${expanded ? 'expanded' : 'collapsed'}`
      }>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={typography.label}>{medal.sportLabel.toUpperCase()}</Text>
          {medal.locked ? <Badge label="🔒 Premium" tone="warning" /> : null}
        </View>
        <Text style={styles.name}>{medal.name}</Text>
        <Text style={styles.finishTime}>{formatFinishTime(medal.finishSeconds)}</Text>
        <Text style={styles.meta}>
          {dateLabel} · {medal.location}
        </Text>
        {medal.tag ? (
          <View style={styles.tagRow}>
            <Badge label={TAG_LABEL[medal.tag]} tone="accent" />
          </View>
        ) : null}

        {expanded && !medal.locked ? (
          <View style={styles.splits}>
            {medal.splits.map((split) => (
              <View key={split.label} style={styles.splitRow}>
                <Text style={styles.splitLabel}>{split.label}</Text>
                <Text style={styles.splitValue}>{formatFinishTime(split.elapsedSeconds)}</Text>
              </View>
            ))}
            <Text style={styles.sourceLabel}>{sourceStatusLabel(medal.sourceStatus)}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function sourceStatusLabel(status: MedalCardData['sourceStatus']): string {
  switch (status) {
    case 'official_confirmed':
      return 'Official source confirmed';
    case 'imported_confirmed':
      return 'Imported and confirmed';
    case 'self_reported':
      return 'Self-reported';
  }
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    ...typography.subtitle,
  },
  finishTime: {
    ...typography.display,
    fontSize: 28,
    color: colors.accent,
  },
  meta: {
    ...typography.caption,
  },
  tagRow: {
    marginTop: spacing.xs,
  },
  splits: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  splitLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  splitValue: {
    ...typography.body,
    fontWeight: '600',
  },
  sourceLabel: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
});
