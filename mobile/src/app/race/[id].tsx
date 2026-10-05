import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { RacePrepChecklist } from '@/components/race/RacePrepChecklist';
import { HairlineRule } from '@/components/HairlineRule';
import { RaceLineMotif } from '@/components/RaceLineMotif';
import { SignalModule } from '@/components/SignalModule';
import { type BrandPalette, tabularNumerals, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { daysUntil, formatCountdown, formatRaceDate } from '@/lib/format';
import { useAthleteRaces } from '@/lib/racesContext';
import { canSuggestRacePrediction } from '@/lib/signalContext';
import { minTouchSize, spacing } from '@/lib/theme';

/** Joins meta parts (location, date) with " · ", skipping any that are missing/blank — mirrors
 *  results/[id].tsx's own joinMeta so a manually-entered race with no location recorded never
 *  shows a leading/dangling separator. */
function joinMeta(parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => !!part && part.trim().length > 0).join(' · ');
}

/**
 * Upcoming-race detail: identity + countdown hero + event information + a collapsible Race Prep
 * checklist + Signal + Edit/Remove. The checklist was briefly removed in an earlier Step 4 pass
 * (it used to be a static fixture — identical for every race, nothing actually checkable) and
 * restored once real per-race persistence existed (see RacePrepChecklist + lib/checklistTemplate.ts)
 * — RaceSignal still isn't a training-plan app, so this stays a fixed, shared template, not a
 * custom planner.
 *
 * Visually, this is the pre-race sibling of results/[id].tsx's completed-race screen and mirrors
 * its exact rhythm: kicker → race name → meta line → hero number → hairline-sectioned detail rows
 * → Signal → quiet utility links, sharing the same "Race Morning Precision" tokens
 * (useBrandPalette), the same RaceLineMotif behind the identity/hero block, and the same
 * SignalModule entry point into Signal.
 */
export default function RacePrepScreen() {
  // `prep` comes from a race-prep notification: "1" opens the checklist expanded, anything else is the unchecked item to highlight.
  const { id, prep } = useLocalSearchParams<{ id: string; prep?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const prepItem = prep && prep !== '1' ? prep : null;
  /** Scrolls the highlighted checklist row into view. Best effort: if it cannot be measured, the checklist is simply left where it opens. */
  const scrollToRow = useCallback((row: View) => {
    const inner = (scrollRef.current as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
    if (!inner) return;
    setTimeout(() => {
      try {
        row.measureLayout(inner as never, (_x: number, y: number) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true }), () => {});
      } catch {
        // Not measurable: leave the scroll position alone.
      }
    }, 250);
  }, []);
  const router = useRouter();
  const { data: races, removeRace } = useAthleteRaces();
  const race = races.find((candidate) => candidate.id === id);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  // Same construction results/[id].tsx uses for its own Signal module — a lighter border in light
  // mode so the tinted surface carries the module rather than a heavy outline.
  const signalModuleColors = {
    ink: palette.ink,
    inkSecondary: palette.inkSecondary,
    signalBlue: palette.signalBlue,
    surfaceTint: withAlpha(palette.signalBlue, 0.08),
    badgeTint: withAlpha(palette.signalBlue, 0.18),
    borderTint: withAlpha(palette.signalBlue, palette.statusBarStyle === 'dark' ? 0.1 : 0.18),
    onSignalBlue: palette.onSignalBlue,
  };

  // This screen is for an upcoming race — a completed race's prep view isn't meaningful (and its
  // eventDate may be a bare year, which daysUntil can't parse).
  if (!race || race.status === 'completed') {
    return (
      <View style={styles.screen}>
        <View style={styles.notFound}>
          <Text style={styles.name}>Race not found.</Text>
        </View>
      </View>
    );
  }

  const countdownLabel = formatCountdown(daysUntil(race.eventDate));
  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;

  function confirmRemove() {
    if (!race) return;
    Alert.alert('Remove this race?', `${race.name} will no longer appear in your history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeRace(race.id);
            router.back();
          } catch (err) {
            console.warn('[RacePrep] removeRace failed:', err);
            Alert.alert('Couldn’t remove that race', 'Please try again.');
          }
        },
      },
    ]);
  }

  const infoEntries = [
    { label: 'Date', value: dateLabel },
    race.location ? { label: 'Location', value: race.location } : null,
    race.distanceLabel ? { label: 'Distance', value: race.distanceLabel } : null,
    { label: 'Sport', value: capitalize(race.sport) },
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: race.name }} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {/* 1-2 — Race identity + countdown hero, sharing one quiet background motif — mirrors
            results/[id].tsx's heroWrap (kicker → name → meta line → hero number). */}
        <View style={styles.heroWrap}>
          <RaceLineMotif tintColor={palette.ink} opacity={0.035} style={{ left: '35%' }} />
          <View>
            <Text style={styles.kicker}>
              {race.sport.toUpperCase()} · {race.distanceLabel}
            </Text>
            <Text style={styles.name}>{race.name}</Text>
            <Text style={styles.metaLine}>{joinMeta([race.location, dateLabel])}</Text>
          </View>
          <Text style={styles.countdown}>{countdownLabel}</Text>
        </View>

        {/* 3 — Event Information — same hairline-separated row pattern as results/[id].tsx's own
            Placement/Details sections, in place of a bordered Card. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Event Information</Text>
          <HairlineRule color={palette.hairline} />
          {infoEntries.map((entry, index) => (
            <View key={entry.label}>
              <InfoRow label={entry.label} value={entry.value} styles={styles} />
              {index < infoEntries.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
            </View>
          ))}
        </View>

        {/* 4 — Preparation */}
        {race.isManual ? <RacePrepChecklist race={race} initialExpanded={!!prep} highlightItemId={prepItem} onHighlightedRow={scrollToRow} /> : null}

        {/* 5 — Signal module: the natural next action, right after the hero/event-info/prep block */}
        {/* A proactive suggestion: only for a registered race with at least two recent comparable results. Signal's own
            custom question box is always available for anything thinner. */}
        {canSuggestRacePrediction(races, race.id) ? (
          <SignalModule
            title="What does your history suggest for this race?"
            supportingText="See how similar races have gone and what it means for race day."
            onPress={() => router.push({ pathname: '/signal', params: { raceId: race.id } })}
            colors={signalModuleColors}
          />
        ) : null}

        {/* 6 — Utility actions — quiet text links, matching results/[id].tsx's UtilityActions rather
            than bordered pill buttons. */}
        {race.isManual ? (
          <View style={styles.utilityRow}>
            <Pressable onPress={() => router.push(`/race/add?raceId=${race.id}`)} accessibilityRole="button" accessibilityLabel="Edit this race" style={styles.utilityButton}>
              <Text style={styles.utilityLink}>Edit this race</Text>
            </Pressable>
            <Pressable onPress={confirmRemove} accessibilityRole="button" accessibilityLabel="Remove this race" style={styles.utilityButton}>
              <Text style={styles.utilityLinkDanger}>Remove this race</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  notFound: ViewStyle;
  kicker: TextStyle;
  name: TextStyle;
  metaLine: TextStyle;
  heroWrap: ViewStyle;
  countdown: TextStyle;
  section: ViewStyle;
  sectionLabel: TextStyle;
  infoRow: ViewStyle;
  infoLabel: TextStyle;
  infoValue: TextStyle;
  utilityRow: ViewStyle;
  utilityButton: ViewStyle;
  utilityLink: TextStyle;
  utilityLinkDanger: TextStyle;
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
    notFound: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    name: {
      fontSize: 24,
      fontWeight: '700',
      color: palette.ink,
      marginTop: spacing.xs,
    },
    metaLine: {
      fontSize: 15,
      color: palette.inkSecondary,
      marginTop: spacing.xs,
    },
    heroWrap: {
      position: 'relative',
      overflow: 'hidden',
      gap: spacing.lg,
    },
    countdown: {
      fontSize: 60,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    section: {
      gap: 0,
    },
    sectionLabel: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.ink,
      marginBottom: spacing.sm,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      minHeight: minTouchSize,
    },
    infoLabel: {
      fontSize: 15,
      color: palette.inkSecondary,
    },
    infoValue: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    utilityRow: {
      flexDirection: 'row',
      gap: spacing.xl,
      paddingTop: spacing.xs,
    },
    utilityButton: {
      minHeight: minTouchSize,
      justifyContent: 'center',
    },
    utilityLink: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.signalBlue,
    },
    utilityLinkDanger: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.danger,
    },
  });
}
