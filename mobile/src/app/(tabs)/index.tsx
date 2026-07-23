import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { RaceCountdownCard } from '@/components/race/RaceCountdownCard';
import { SignalCard } from '@/components/signals/SignalCard';
import { checklistItemsPopulated } from '@/fixtures/checklist';
import { nextRaceEmpty, nextRacePopulated } from '@/fixtures/race';
import { signalsEmpty, signalsPopulated } from '@/fixtures/signals';
import { checklistProgress } from '@/lib/format';
import { useFixtureData } from '@/lib/useSimulatedLoad';
import { colors, spacing, typography } from '@/lib/theme';

const VISIBLE_SIGNAL_LIMIT = 5;

export default function SignalScreen() {
  const router = useRouter();
  const race = useFixtureData(nextRacePopulated, nextRaceEmpty);
  const signals = useFixtureData(signalsPopulated, signalsEmpty);
  const [showAllSignals, setShowAllSignals] = useState(false);

  const isLoading = race.isLoading || signals.isLoading;
  const isError = race.isError || signals.isError;

  const visibleSignals = showAllSignals
    ? signals.data
    : signals.data.slice(0, VISIBLE_SIGNAL_LIMIT);
  const hasMoreSignals = signals.data.length > VISIBLE_SIGNAL_LIMIT && !showAllSignals;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic">
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
              />
            ) : (
              <EmptyState
                title="No next race yet"
                subtitle="Add a race to see your countdown and checklist here."
              />
            )}

            <View style={styles.signalsSection}>
              {signals.data.length === 0 ? (
                <EmptyState
                  title="Invite the people you already train with"
                  subtitle="Send a Signal to let your Circle know about an upcoming session — before it happens."
                />
              ) : (
                <>
                  {visibleSignals.map((card) => (
                    <SignalCard key={card.id} card={card} />
                  ))}
                  {hasMoreSignals ? (
                    <Pressable
                      onPress={() => setShowAllSignals(true)}
                      accessibilityRole="button"
                      accessibilityLabel="See later Signals"
                      style={styles.seeMoreButton}>
                      <Text style={styles.seeMoreLabel}>See later Signals</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <FloatingActionButton onPress={() => router.push('/signal/new')} />
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
  signalsSection: {
    gap: spacing.md,
  },
  seeMoreButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeMoreLabel: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
});
