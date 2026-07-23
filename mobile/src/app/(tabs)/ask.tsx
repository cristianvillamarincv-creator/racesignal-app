import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AskEntryCard } from '@/components/ask/AskEntryCard';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { askCredits, askEntriesEmpty, askEntriesPopulated } from '@/fixtures/ask';
import { colors, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

export default function AskScreen() {
  const entries = useFixtureData(askEntriesPopulated, askEntriesEmpty);
  const [placeholderMessage, setPlaceholderMessage] = useState<string | null>(null);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Text style={typography.title}>Ask RaceSignal</Text>
        <Text style={styles.subcopy}>Uses your race, gear, and confirmed facts.</Text>
        <Text style={styles.credits}>
          {askCredits.total - askCredits.used}/{askCredits.total} credits this month
        </Text>

        {entries.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : entries.isError ? (
          <ErrorState />
        ) : entries.data.length === 0 ? (
          <Text style={styles.subcopy}>No suggestions available right now.</Text>
        ) : (
          <View style={styles.list}>
            {entries.data.map((entry) => (
              <AskEntryCard
                key={entry.id}
                entry={entry}
                onPress={() =>
                  setPlaceholderMessage(
                    'Ask will use your race and gear context — coming in a later milestone.',
                  )
                }
              />
            ))}
          </View>
        )}

        {placeholderMessage ? <Text style={styles.placeholder}>{placeholderMessage}</Text> : null}
      </ScrollView>
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
    gap: spacing.md,
  },
  subcopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  credits: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  placeholder: {
    ...typography.caption,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
