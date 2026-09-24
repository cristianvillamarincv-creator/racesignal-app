import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/lib/auth';
import { fetchRecentSignalConversations, type SignalConversationRow } from '@/lib/db/signal';
import { formatRelativeDate } from '@/lib/format';
import { getSuggestedPrompts } from '@/lib/signalContext';
import { getNextRace } from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Signal tab (Step 5, V1) — the minimal real landing, not the mocked chat this used to be. No
 * prediction dashboard, no confidence badge, no conversation history — that's the long-term
 * vision, not V1 (see the Step 5 plan). This reuses the exact same chat screen (`app/signal.tsx`)
 * as the "Ask Signal" entry points on Result Detail and upcoming Race Detail, not a second
 * implementation.
 */
export default function AskScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const { session } = useAuth();
  const [recentConversations, setRecentConversations] = useState<SignalConversationRow[]>([]);

  // Refetch on focus (not just mount) — this tab stays mounted across tab switches, so a
  // conversation started/reopened elsewhere wouldn't otherwise ever refresh this list.
  useFocusEffect(
    useCallback(() => {
      const athleteId = session?.user.id;
      if (!athleteId) return;
      let cancelled = false;
      fetchRecentSignalConversations(athleteId).then((rows) => {
        if (!cancelled) setRecentConversations(rows);
      });
      return () => {
        cancelled = true;
      };
    }, [session?.user.id]),
  );

  if (races.isLoading) {
    return (
      <View style={styles.screen}>
        <LoadingSkeleton rows={3} />
      </View>
    );
  }
  if (races.isError) {
    return (
      <View style={styles.screen}>
        <ErrorState />
      </View>
    );
  }

  const nextRace = getNextRace(races.data);
  const suggestions = getSuggestedPrompts(races.data).slice(0, 3);

  function openSignal(raceId?: string) {
    router.push(raceId ? { pathname: '/signal', params: { raceId } } : '/signal');
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Text style={typography.title}>Signal</Text>
        <Text style={styles.subcopy}>
          Signal is your performance analyst — it reads your race history, splits, and rankings to
          answer what your data is actually telling you.
        </Text>

        {nextRace ? (
          <Pressable
            onPress={() => openSignal(nextRace.id)}
            accessibilityRole="button"
            accessibilityLabel={`Ask Signal about ${nextRace.name}`}>
            <Card>
              <Text style={typography.label}>YOUR NEXT RACE</Text>
              <Text style={styles.nextRaceName}>{nextRace.name}</Text>
              <Text style={styles.nextRaceCta}>Ask Signal about this race →</Text>
            </Card>
          </Pressable>
        ) : null}

        <View style={styles.suggestionRow}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => openSignal()}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              style={styles.suggestionChip}>
              <Text style={styles.suggestionLabel}>{suggestion}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => openSignal()}
          accessibilityRole="button"
          accessibilityLabel="Ask Signal"
          style={styles.askButton}>
          <Text style={styles.askButtonLabel}>Ask Signal</Text>
        </Pressable>

        {recentConversations.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={typography.label}>RECENT SIGNALS</Text>
            {recentConversations.map((conversation) => (
              <Pressable
                key={conversation.id}
                onPress={() => router.push({ pathname: '/signal', params: { conversationId: conversation.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Reopen conversation: ${conversation.title}`}
                style={styles.recentRow}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {conversation.title}
                </Text>
                <Text style={styles.recentMeta}>{formatRelativeDate(conversation.updated_at)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
    gap: spacing.lg,
  },
  subcopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  nextRaceName: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  nextRaceCta: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  suggestionRow: {
    gap: spacing.sm,
  },
  suggestionChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionLabel: {
    ...typography.body,
    fontWeight: '600',
  },
  askButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  askButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.background,
  },
  recentSection: {
    gap: spacing.xs,
  },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recentTitle: {
    ...typography.body,
    flex: 1,
  },
  recentMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
