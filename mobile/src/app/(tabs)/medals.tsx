import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { MedalCard } from '@/components/medals/MedalCard';
import {
  medalsEmpty,
  medalsPopulated,
  medalsSummaryEmpty,
  medalsSummaryPopulated,
} from '@/fixtures/medals';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

export default function MedalsScreen() {
  const router = useRouter();
  const medals = useFixtureData(medalsPopulated, medalsEmpty);
  const summary = useFixtureData(medalsSummaryPopulated, medalsSummaryEmpty);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);

  const isLoading = medals.isLoading || summary.isLoading;
  const isError = medals.isError || summary.isError;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : isError ? (
          <ErrorState />
        ) : medals.data.length === 0 ? (
          <EmptyState
            title="No races yet"
            subtitle="Recover a past result to start building your Medals history."
          />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryStat label="Finishes" value={summary.data.totalFinishes} />
              <SummaryStat label="Triathlons" value={summary.data.totalTriathlons} />
              <SummaryStat label="PRs" value={summary.data.prCount} />
            </View>
            {summary.data.highlight ? (
              <Text style={styles.highlight}>{summary.data.highlight}</Text>
            ) : null}

            {premiumHint ? <Text style={styles.premiumHint}>{premiumHint}</Text> : null}

            <View style={styles.list}>
              {medals.data.map((medal) => (
                <MedalCard
                  key={medal.id}
                  medal={medal}
                  expanded={expandedId === medal.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === medal.id ? null : medal.id))
                  }
                  onLockedPress={() =>
                    setPremiumHint(`${medal.name} is a detailed result — unlock it with Premium.`)
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <FloatingActionButton onPress={() => router.push('/signal/new')} />
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    ...typography.display,
    fontSize: 28,
  },
  highlight: {
    ...typography.caption,
    color: colors.accent,
    textAlign: 'center',
  },
  premiumHint: {
    ...typography.caption,
    color: colors.warning,
  },
  list: {
    gap: spacing.md,
  },
});
