import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { ErrorState } from '@/components/ErrorState';
import { HairlineRule } from '@/components/HairlineRule';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SectionHeader } from '@/components/SectionHeader';
import { SignalAllowanceCard } from '@/components/SignalAllowanceCard';
import { SignalMark } from '@/components/SignalMark';
import { SignalModule } from '@/components/SignalModule';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { fetchRecentSignalConversations, type SignalConversationRow } from '@/lib/db/signal';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import { formatRelativeDate } from '@/lib/format';
import { AppIcon } from '@/lib/icons';
import { usePremium } from '@/lib/premium';
import { presentPremiumPaywall } from '@/lib/purchases';
import { canSuggestRacePrediction, getSuggestedPrompts } from '@/lib/signalContext';
import { getNextRace } from '@/lib/races';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';
import { useSignalUsage } from '@/lib/useSignalUsage';

/**
 * Signal tab (Step 5, V1) — the minimal real landing, not the mocked chat this used to be. No
 * prediction dashboard, no confidence badge, no conversation history — that's the long-term
 * vision, not V1 (see the Step 5 plan). This reuses the exact same chat screen (`app/signal.tsx`)
 * as the "Ask Signal" entry points on Result Detail and upcoming Race Detail, not a second
 * implementation.
 */
const SECTION_GAP = spacing.xxl;
const ASK_TO_CARD_GAP = 16;
const CARD_TO_RECENT_GAP = 24;

export default function AskScreen() {
  const router = useRouter();
  const races = useAthleteRaces();
  const { session } = useAuth();
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [recentConversations, setRecentConversations] = useState<SignalConversationRow[]>([]);
  const { mode: devPreviewMode } = useDevPreview();
  const isPreviewMode = isDevPreviewAvailable() && devPreviewMode === 'browse';
  const { refresh: refreshPremiumStatus } = usePremium();
  // The allowance as the server reports it (null when unknown, and never fetched in Developer Preview). Only a confirmed free
  // athlete gets the allowance card; Premium and unknown show nothing here.
  const { usage, refresh: refreshUsage } = useSignalUsage({ enabled: !isPreviewMode && !!session?.user.id });

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
  // The next-race question is the module above, so it is never repeated as a row. The module is a proactive suggestion, so it
  // appears only for a registered next race with at least two recent comparable results; a custom question is always available.
  const canAskAboutNextRace = !!nextRace && canSuggestRacePrediction(races.data, nextRace.id);
  const nextRaceQuestion = nextRace ? `What does my history suggest for ${nextRace.name}?` : null;
  const suggestions = getSuggestedPrompts(races.data)
    .filter((suggestion) => !(canAskAboutNextRace && suggestion === nextRaceQuestion))
    .slice(0, 3);

  /** Opens the existing paywall, then re-reads entitlement and the server's usage so this tab reflects a purchase or restore. */
  async function handleExplorePremium() {
    await presentPremiumPaywall();
    await refreshPremiumStatus();
    await refreshUsage();
  }

  function openSignal(raceId?: string) {
    router.push(raceId ? { pathname: '/signal', params: { raceId } } : '/signal');
  }

  /** A tapped suggestion is a direct action, not a shortcut to the same chooser again — it opens
   *  Signal and submits that exact question immediately (see signal.tsx's initialPrompt handling),
   *  through the same send/conversation path a manually-typed question uses. Unseeded, matching the
   *  prior (undifferentiated) behavior exactly — only the "open and show the same three questions
   *  again" part was the bug, not the seeding. */
  function openSignalWithPrompt(prompt: string) {
    router.push({ pathname: '/signal', params: { initialPrompt: prompt } });
  }

  // Same construction results/[id].tsx uses for its own Signal module — a lighter tinted border in
  // light mode, unchanged in dark, so the module carries itself without a heavy card outline.
  const signalModuleColors = {
    ink: palette.ink,
    inkSecondary: palette.inkSecondary,
    signalBlue: palette.signalBlue,
    surfaceTint: withAlpha(palette.signalBlue, 0.08),
    badgeTint: withAlpha(palette.signalBlue, 0.18),
    borderTint: withAlpha(palette.signalBlue, palette.statusBarStyle === 'dark' ? 0.1 : 0.18),
    onSignalBlue: palette.onSignalBlue,
  };

  // A quiet in-module divider — a hairline tinted toward signalBlue rather than the neutral
  // palette.hairline, so the three prompt rows read as belonging to one branded surface rather than
  // borrowing the plain editorial hairline used for history lists elsewhere on this screen.
  const suggestionDividerColor = withAlpha(palette.signalBlue, palette.statusBarStyle === 'dark' ? 0.16 : 0.14);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {/* 1 — Next race: the most prominent thing on this screen. The analytical question is the
            entry point itself — athlete-specific, interrogative, forward-looking — rather than a
            separate generic "what Signal is" paragraph above it. */}
        {nextRace && canAskAboutNextRace ? (
          <View style={styles.nextRaceBlock}>
            <Text style={styles.kicker}>Your next race</Text>
            <SignalModule
              title={`What does my history suggest for ${nextRace.name}?`}
              supportingText="See how your history and recent form line up with what's ahead."
              onPress={() => openSignal(nextRace.id)}
              colors={signalModuleColors}
            />
          </View>
        ) : null}

        {/* 2 — Ask Signal anything: the primary free-form entry point. Placed right after the
            next-race module and ABOVE Recent Signals (Task 3.1, B.1 CTA-placement pass) — as
            conversation history grows over time, a CTA left at the bottom of this screen would get
            progressively buried under it; anchoring it here keeps it equally easy to find no matter
            how long "Recent Signals" gets. Deliberately plain (no card, no fill, no border) so it
            never competes with the next-race module above it. */}
        <Pressable
          onPress={() => openSignal()}
          accessibilityRole="button"
          accessibilityLabel="Ask Signal anything"
          style={styles.askAnythingRow}>
          <SignalMark color={palette.signalBlue} size={16} />
          <Text style={styles.askAnythingLabel}>Ask Signal anything</Text>
          <AppIcon name="chevron-right" size={18} color={palette.signalBlue} />
        </Pressable>

        {/* One allowance card, for confirmed free athletes only: nothing for Premium (their count is in the conversation) and nothing
            while usage is unknown, in which case no block is rendered and Recent Signals simply moves up. 16pt below the ask row and
            24pt above Recent Signals; the screen's own section gap is larger, so the card pulls in by the difference. */}
        {usage && !usage.isPremium ? (
          <View style={styles.allowanceBlock}>
            <SignalAllowanceCard usage={usage} onExplorePremium={handleExplorePremium} />
          </View>
        ) : null}

        {/* 3 — Recent Signals: completed analysis HISTORY. Deliberately unboxed/editorial — the
            distinction from the Prompt Actions module below comes from typography and a quiet
            chevron, not from suddenly wrapping history in cards. The Signal mark appears once here,
            subtly, as a section-level accent (not repeated per row) marking this as Signal's own
            record of past analyses. Title is the primary text; the relative timestamp is clearly
            secondary, smaller and quieter — there's no snippet/preview field in signal_conversations
            to show beyond that. */}
        {recentConversations.length > 0 ? (
          <View style={styles.recentSection}>
            <View style={styles.recentHeaderRow}>
              <SignalMark color={palette.inkSecondary} size={14} />
              <View style={styles.recentHeaderTitle}>
                <SectionHeader title="Recent Signals" />
              </View>
            </View>
            {recentConversations.map((conversation, index) => (
              <View key={conversation.id}>
                <Pressable
                  onPress={() => router.push({ pathname: '/signal', params: { conversationId: conversation.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Reopen conversation: ${conversation.title}`}
                  style={styles.recentRow}>
                  <View style={styles.recentTextBlock}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {conversation.title}
                    </Text>
                    <Text style={styles.recentMeta}>{formatRelativeDate(conversation.updated_at)}</Text>
                  </View>
                  <AppIcon name="chevron-right" size={16} color={palette.inkSecondary} />
                </Pressable>
                {index < recentConversations.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* 4 — Things worth asking: ACTIONS, grouped into one Signal-Blue-tinted Prompt Actions
            module — a single surface (not three separate pills) so the three prompts read as one
            intentional "things I can ask" unit, visibly distinct from the plain history list above
            it. Restrained hairlines separate the rows *within* the module only; each row keeps a
            comfortable touch target and its own chevron. */}
        {suggestions.length > 0 ? (
          <View style={styles.suggestionsBlock}>
            <Text style={styles.kicker}>Things worth asking</Text>
            <View style={styles.suggestionsModule}>
              {suggestions.map((suggestion, index) => (
                <View key={suggestion}>
                  <Pressable
                    onPress={() => openSignalWithPrompt(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={suggestion}
                    style={styles.suggestionRow}>
                    <Text style={styles.suggestionLabel}>{suggestion}</Text>
                    <AppIcon name="chevron-right" size={18} color={palette.signalBlue} />
                  </Pressable>
                  {index < suggestions.length - 1 ? <HairlineRule color={suggestionDividerColor} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  nextRaceBlock: ViewStyle;
  kicker: TextStyle;
  suggestionsBlock: ViewStyle;
  suggestionsModule: ViewStyle;
  suggestionRow: ViewStyle;
  suggestionLabel: TextStyle;
  allowanceBlock: ViewStyle;
  askAnythingRow: ViewStyle;
  askAnythingLabel: TextStyle;
  recentSection: ViewStyle;
  recentHeaderRow: ViewStyle;
  recentHeaderTitle: ViewStyle;
  recentRow: ViewStyle;
  recentTextBlock: ViewStyle;
  recentTitle: TextStyle;
  recentMeta: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      padding: spacing.lg,
      // Real vertical rhythm between the four sections — each section then sets its own tighter
      // internal spacing, so the page reads as distinct blocks of differing weight rather than
      // uniform slots stacked in a row.
      gap: SECTION_GAP,
    },
    // 1 — Next race: the analytical entry point itself, most prominent on the screen.
    nextRaceBlock: {
      gap: spacing.sm,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    // 4 — Things worth asking: ONE grouped, Signal-Blue-tinted Prompt Actions module — the tinted
    // surface + border is what signals "these are actions", not per-row pills.
    suggestionsBlock: {
      gap: spacing.sm,
    },
    suggestionsModule: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: withAlpha(palette.signalBlue, palette.statusBarStyle === 'dark' ? 0.14 : 0.18),
      backgroundColor: withAlpha(palette.signalBlue, 0.08),
      paddingHorizontal: spacing.md,
      overflow: 'hidden',
    },
    suggestionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      paddingVertical: spacing.sm,
    },
    suggestionLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '500',
      color: palette.ink,
    },
    // 2 — Ask Signal: a quiet, single action row — deliberately plain (no card, no fill, no
    // border) so it never reads as a second SignalModule-weight block next to the next-race card.
    // Placed right after the next-race module in render order, above Recent Signals (Task 3.1).
    // Content gap between sections is spacing.xxl (32): -16 above gives 16pt from the ask row, -8 below gives 24pt to Recent Signals.
    allowanceBlock: {
      marginTop: ASK_TO_CARD_GAP - SECTION_GAP,
      marginBottom: CARD_TO_RECENT_GAP - SECTION_GAP,
    },
    askAnythingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: minTouchSize,
    },
    askAnythingLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: palette.signalBlue,
    },
    // 3 — Recent Signals: analysis HISTORY — unboxed editorial list, title-primary/timestamp-
    // secondary, with a single subtle section-level Signal mark (not repeated per row).
    recentSection: {
      gap: spacing.xs,
    },
    recentHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    recentHeaderTitle: {
      flex: 1,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    recentTextBlock: {
      flex: 1,
      gap: 2,
    },
    recentTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.ink,
    },
    recentMeta: {
      fontSize: 12,
      color: palette.inkSecondary,
    },
  });
}
