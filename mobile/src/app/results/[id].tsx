import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import {
  Alert,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AchievementPill } from '@/components/AchievementPill';
import { HairlineRule } from '@/components/HairlineRule';
import { HeaderBackButton } from '@/components/HeaderBackButton';
import { RaceLineMotif } from '@/components/RaceLineMotif';
import { SignalModule } from '@/components/SignalModule';
import type { Race, RaceRank, RaceSplit } from '@/fixtures/races';
import { type BrandPalette, tabularNumerals, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { formatFinishTime, formatOrdinal, formatRaceDate, getKnownRunningDistanceLabel, getTopPercentile } from '@/lib/format';
import { canonicalDistanceLabel, getDistancePRStatuses, getHighlightsForRace, pickTopHighlights } from '@/lib/highlights';
import { AppIcon } from '@/lib/icons';
import { buildRaceInterpretation, isFastestSplitInGroup } from '@/lib/raceInterpretation';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

const SOURCE_LABEL: Record<NonNullable<Race['result']>['sourceStatus'], string> = {
  official_confirmed: 'Official source confirmed',
  imported_confirmed: 'Imported and confirmed',
  self_reported: 'Self-reported',
};

// Matches HeaderBackButton's own circular size — used here to compute how much top padding the
// screen's own content needs to clear the floating back control.
const BACK_BUTTON_SIZE = 44;

// Swim/Bike/Run get the large primary split treatment; anything else (transitions — a partial
// label like "Swim (2K)" still matches via startsWith) reads as one quiet compact line beneath.
const PRIMARY_DISCIPLINES = ['Swim', 'Bike', 'Run'];
function isPrimarySplit(label: string): boolean {
  return PRIMARY_DISCIPLINES.some((discipline) => label.startsWith(discipline));
}

/** Joins meta parts (location, date) with " · ", skipping any that are missing/blank — never a
 *  leading/dangling separator when e.g. a manually-entered race has no location recorded. */
function joinMeta(parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => !!part && part.trim().length > 0).join(' · ');
}

export default function RaceResultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: races, removeRace } = useAthleteRaces();
  const race = races.find((candidate) => candidate.id === id);
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  // Compact 3-column Splits/Placement read well at normal text sizes on any current iPhone width —
  // but large accessibility Dynamic Type sizes (or an unusually narrow viewport) need the columns
  // to degrade to full-width stacked rows instead of squeezing/truncating.
  const { width } = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const useCompactColumns = width >= 350 && fontScale <= 1.35;
  const insets = useSafeAreaInsets();

  // The native stack header is hidden for this screen entirely — it always reserved more vertical
  // space than a titleless header actually needs. A single small circular back control is rendered
  // in-content instead, positioned against the real safe-area inset, with the race identity
  // starting just below it rather than under a near-empty nav bar. Navigation behavior (back/canGoBack)
  // is unchanged — HeaderBackButton works identically outside the header slot.
  const topOffset = insets.top + BACK_BUTTON_SIZE + 14;

  // Light mode's tinted surface should carry the Signal module on its own — a lighter border than
  // dark mode's (which already reads well and is left unchanged).
  const signalModuleColors = {
    ink: palette.ink,
    inkSecondary: palette.inkSecondary,
    signalBlue: palette.signalBlue,
    surfaceTint: withAlpha(palette.signalBlue, 0.08),
    badgeTint: withAlpha(palette.signalBlue, 0.18),
    borderTint: withAlpha(palette.signalBlue, palette.statusBarStyle === 'dark' ? 0.1 : 0.18),
    onSignalBlue: palette.onSignalBlue,
  };
  const backButton = <HeaderBackButton color={palette.signalBlue} circular circleBackground={palette.canvasElevated} />;

  if (!race) {
    return (
      <View style={styles.screen}>
        <StatusBar style={palette.statusBarStyle} />
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.floatingBack, { top: insets.top + 4 }]}>{backButton}</View>
        <View style={[styles.notFound, { paddingTop: topOffset }]}>
          <Text style={styles.name}>Result not found.</Text>
        </View>
      </View>
    );
  }

  function confirmRemove() {
    if (!race) return;
    Alert.alert('Remove this race?', `${race.name} will no longer appear in your history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeRace(race.id);
          router.back();
        },
      },
    ]);
  }

  const dateDisplay = formatRaceDate(race.eventDate);
  const dateLabel = dateDisplay.precision === 'year' ? dateDisplay.year : dateDisplay.full;
  const knownDistance = getKnownRunningDistanceLabel(race.distanceLabel);

  // A manually-entered completed race with no finish time is a valid, real state (finish time is
  // optional on that form) — not a broken/missing race. Show what we have plus Edit/Remove rather
  // than a dead-end "not found" wall, which item 11's post-add navigation would otherwise land on.
  if (!race.result) {
    return (
      <View style={styles.screen}>
        <StatusBar style={palette.statusBarStyle} />
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.floatingBack, { top: insets.top + 4 }]}>{backButton}</View>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: topOffset }]}>
          <Text style={styles.kicker}>
            {race.sport.toUpperCase()} · {race.distanceLabel}
          </Text>
          <Text style={styles.name}>{race.name}</Text>
          <Text style={styles.metaLine}>{joinMeta([race.location, dateLabel])}</Text>
          <Text style={styles.subcopy}>No finish time recorded for this race yet.</Text>

          <View style={styles.utilitySpacer} />
          <SignalModule
            title="What does this race tell you?"
            supportingText="See how it fits your training history and what it means for what's next."
            onPress={() => router.push({ pathname: '/signal', params: { raceId: race.id } })}
            colors={signalModuleColors}
          />
          <UtilityActions race={race} styles={styles} onEdit={() => router.push(`/race/add?raceId=${race.id}`)} onRemove={confirmRemove} />
        </ScrollView>
      </View>
    );
  }

  const { result } = race;
  // Placeholder rows with nothing to show (e.g. a race-start marker that carries no real elapsed
  // time) shouldn't render as a bogus "0:00" split — a real split always has a positive duration.
  const visibleSplits = result.splits.filter((split) => split.elapsedSeconds > 0);
  const primarySplits = visibleSplits.filter((split) => isPrimarySplit(split.label));
  const quietSplits = visibleSplits.filter((split) => !isPrimarySplit(split.label));

  const groupKey = canonicalDistanceLabel(race.distanceLabel);
  const isCurrentPB = getDistancePRStatuses(races).find((status) => status.race.id === race.id)?.isCurrentPB ?? false;
  const overallPercentile =
    result.overallRank?.field !== undefined && !result.rankingNeedsConfirmation
      ? getTopPercentile(result.overallRank.place, result.overallRank.field)
      : undefined;
  const interpretation = buildRaceInterpretation(races, race);

  // The hero's PR pill already states this race's current-PB fact directly — excluded here by its
  // exact fact-label (the same `${groupKey} PR` format highlights.ts's distancePRHighlight() uses
  // for isCurrentPB), not by icon, so this stays correct if icon choices ever change. The strongest
  // remaining highlights become quick-scan pills right under the hero (capped at 2-3 total,
  // including the PR pill); anything left over after that renders as a small "also earned" line
  // further down — never a large, separate, bottom-of-screen Achievements block.
  const heroFactLabels = new Set<string>();
  if (isCurrentPB) heroFactLabels.add(`${groupKey} PR`);
  const rankedOtherHighlights = pickTopHighlights(
    getHighlightsForRace(races, race.id).filter((highlight) => !heroFactLabels.has(highlight.label)),
    6,
  );
  const pillBudget = isCurrentPB ? 2 : 3;
  const pillHighlights = rankedOtherHighlights.slice(0, pillBudget);
  const additionalHighlights = rankedOtherHighlights.slice(pillBudget);

  const placementEntries = [
    result.overallRank ? { label: 'Overall', rank: result.overallRank } : null,
    result.genderRank ? { label: 'Gender', rank: result.genderRank } : null,
    result.ageGroupRank ? { label: 'Age group', rank: result.ageGroupRank } : null,
  ].filter((entry): entry is { label: string; rank: RaceRank & { ageGroup?: string } } => entry !== null);

  return (
    <View style={styles.screen}>
      <StatusBar style={palette.statusBarStyle} />
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.floatingBack, { top: insets.top + 4 }]}>{backButton}</View>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: topOffset }]}>
        {/* 1-2 — Race identity + hero, sharing one quiet background motif */}
        <View style={styles.heroWrap}>
          {/* Biased toward the right/background so it never crosses the left-aligned race name or
              hero time — reduced opacity vs. the Signal module, which can stay slightly stronger. */}
          <RaceLineMotif tintColor={palette.ink} opacity={0.035} style={{ left: '35%' }} />
          <View>
            <Text style={styles.kicker}>
              {race.sport.toUpperCase()} · {race.distanceLabel}
              {knownDistance ? ` · ${knownDistance}` : ''}
            </Text>
            <Text style={styles.name}>{race.name}</Text>
            <Text style={styles.metaLine}>{joinMeta([race.location, dateLabel])}</Text>
          </View>

          <View style={styles.hero}>
            <Text style={styles.heroTime}>{formatFinishTime(result.finishSeconds)}</Text>
            {isCurrentPB || pillHighlights.length > 0 ? (
              <View style={styles.pillRow}>
                {isCurrentPB ? (
                  <AchievementPill
                    icon="trophy"
                    label={`${groupKey} PR`}
                    variant="primary"
                    colors={{
                      gold: palette.medalGold,
                      goldFill: palette.medalGoldFill,
                      onGold: palette.onMedalGold,
                      inkSecondary: palette.inkSecondary,
                      hairline: palette.hairline,
                      canvasElevated: palette.canvasElevated,
                    }}
                  />
                ) : null}
                {pillHighlights.map((highlight) => (
                  <AchievementPill
                    key={highlight.label}
                    icon={highlight.icon}
                    label={highlight.label}
                    variant="secondary"
                    colors={{
                      gold: palette.medalGold,
                      goldFill: palette.medalGoldFill,
                      onGold: palette.onMedalGold,
                      inkSecondary: palette.inkSecondary,
                      hairline: palette.hairline,
                      canvasElevated: palette.canvasElevated,
                    }}
                  />
                ))}
              </View>
            ) : null}
            {overallPercentile !== undefined ? <Text style={styles.percentileText}>Top {overallPercentile}% overall</Text> : null}
          </View>

          {/* 3 — Short interpretation */}
          {interpretation ? <Text style={styles.interpretation}>{interpretation}</Text> : null}
        </View>

        {/* 4 — Signal module, elevated: the natural next action, right after the hero/interpretation */}
        <SignalModule
          title="What does this race tell you?"
          supportingText="See how it fits your training history and what it means for what's next."
          onPress={() => router.push({ pathname: '/signal', params: { raceId: race.id } })}
          colors={signalModuleColors}
        />

        {/* Splits — compact 3-column on normal text sizes, stacked rows as an accessibility/narrow-
            width fallback */}
        {visibleSplits.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Splits</Text>
            <HairlineRule color={palette.hairline} />
            {useCompactColumns ? (
              <View style={styles.columnsRow}>
                {primarySplits.map((split, index) => (
                  <View
                    key={split.label}
                    style={[styles.column, index > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.hairline } : null]}>
                    <SplitLabel
                      label={split.label}
                      isFastest={isFastestSplitInGroup(races, race, groupKey, split.label)}
                      textStyle={styles.columnLabel}
                      medalColor={palette.medalGold}
                      justify="center"
                    />
                    <Text style={styles.columnPrimary}>{formatFinishTime(split.elapsedSeconds)}</Text>
                    {split.paceLabel ? <Text style={styles.columnSecondary}>{split.paceLabel}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              primarySplits.map((split, index) => (
                <View key={split.label}>
                  <View style={styles.splitRow}>
                    <SplitLabel
                      label={split.label}
                      isFastest={isFastestSplitInGroup(races, race, groupKey, split.label)}
                      textStyle={styles.splitLabel}
                      medalColor={palette.medalGold}
                      justify="flex-start"
                    />
                    <View style={styles.splitValues}>
                      <Text style={styles.splitTime}>{formatFinishTime(split.elapsedSeconds)}</Text>
                      {split.paceLabel ? <Text style={styles.splitPace}>{split.paceLabel}</Text> : null}
                    </View>
                  </View>
                  {index < primarySplits.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
                </View>
              ))
            )}
            {quietSplits.length > 0 ? <Text style={styles.quietLine}>{formatQuietSplits(quietSplits)}</Text> : null}
          </View>
        ) : null}

        {/* Placement — same compact-columns/stacked-fallback treatment as Splits */}
        {placementEntries.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Placement</Text>
            <HairlineRule color={palette.hairline} />
            {useCompactColumns ? (
              <View style={styles.columnsRow}>
                {placementEntries.map((entry, index) => (
                  <View
                    key={entry.label}
                    style={[styles.column, index > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.hairline } : null]}>
                    <RankColumnBody label={entry.label} rank={entry.rank} needsConfirmation={result.rankingNeedsConfirmation} styles={styles} />
                  </View>
                ))}
              </View>
            ) : (
              placementEntries.map((entry, index) => (
                <View key={entry.label}>
                  <RankRow
                    label={entry.rank.ageGroup ? `${entry.label} (${entry.rank.ageGroup})` : entry.label}
                    rank={entry.rank}
                    needsConfirmation={result.rankingNeedsConfirmation}
                    styles={styles}
                  />
                  {index < placementEntries.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        {/* Additional earned facts beyond the hero pills — only rendered when something genuinely
            new remains; the strongest facts already live at the hero, so this is deliberately small
            and quiet rather than a second, equally-weighted Achievements block. */}
        {additionalHighlights.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Also earned</Text>
            <HairlineRule color={palette.hairline} />
            <Text style={styles.quietLine}>{additionalHighlights.map((highlight) => highlight.label).join('  ·  ')}</Text>
          </View>
        ) : null}

        {/* Secondary content — source/details, kept quiet and below the primary race experience */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Details</Text>
          <HairlineRule color={palette.hairline} />
          <Text style={styles.detailText}>{SOURCE_LABEL[result.sourceStatus]}</Text>
          {result.sourceNotes?.map((note) => (
            <Text key={note} style={styles.detailText}>
              · {note}
            </Text>
          ))}
        </View>

        {/* Utility actions — secondary, quiet, near the bottom */}
        <UtilityActions race={race} styles={styles} onEdit={() => router.push(`/race/add?raceId=${race.id}`)} onRemove={confirmRemove} />
      </ScrollView>
    </View>
  );
}

function formatQuietSplits(splits: RaceSplit[]): string {
  return splits.map((split) => `${split.label} ${formatFinishTime(split.elapsedSeconds)}`).join('  ·  ');
}

/**
 * A Swim/Bike/Run split label with a small earned-medal indicator attached directly to it when
 * that split is genuinely the fastest in its comparison group — never a separate badge/pill, just
 * a small gold glyph next to the label itself, so the achievement reads as part of the split rather
 * than a second, noisier achievement system. Never used for T1/T2 (only called from primarySplits).
 */
function SplitLabel({
  label,
  isFastest,
  textStyle,
  medalColor,
  justify,
}: {
  label: string;
  isFastest: boolean;
  textStyle: TextStyle;
  medalColor: string;
  justify: 'center' | 'flex-start';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: justify, gap: 5 }}>
      {/* seal-variant reads as a clear rosette/medal at small sizes — the plain "medal" glyph's
          narrow ribbon neck can look like an hourglass at 13px. */}
      {isFastest ? <AppIcon name="seal-variant" size={13} color={medalColor} /> : null}
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

function RankColumnBody({
  label,
  rank,
  needsConfirmation,
  styles,
}: {
  label: string;
  rank: RaceRank & { ageGroup?: string };
  needsConfirmation?: boolean;
  styles: Styles;
}) {
  const hasField = rank.field !== undefined;
  const ageGroupSuffix = rank.ageGroup ? ` · ${rank.ageGroup}` : '';
  return (
    <>
      <Text style={styles.columnLabel}>{label}</Text>
      <Text style={styles.columnPrimary}>{hasField ? `${rank.place}/${rank.field}` : formatOrdinal(rank.place)}</Text>
      {needsConfirmation ? (
        <Text style={styles.needsConfirmationSmall}>Needs confirmation</Text>
      ) : hasField ? (
        <Text style={styles.columnSecondary}>{`Top ${getTopPercentile(rank.place, rank.field!)}%${ageGroupSuffix}`}</Text>
      ) : rank.ageGroup ? (
        <Text style={styles.columnSecondary}>{rank.ageGroup}</Text>
      ) : null}
    </>
  );
}

function RankRow({
  label,
  rank,
  needsConfirmation,
  styles,
}: {
  label: string;
  rank: RaceRank;
  needsConfirmation?: boolean;
  styles: Styles;
}) {
  const hasField = rank.field !== undefined;
  return (
    <View style={styles.splitRow}>
      <Text style={styles.splitLabel}>{label}</Text>
      <View style={styles.splitValues}>
        <Text style={styles.splitTime}>{hasField ? `${rank.place} / ${rank.field}` : formatOrdinal(rank.place)}</Text>
        {needsConfirmation ? (
          <Text style={styles.needsConfirmation}>Needs confirmation</Text>
        ) : hasField ? (
          <Text style={styles.splitPace}>Top {getTopPercentile(rank.place, rank.field!)}%</Text>
        ) : null}
      </View>
    </View>
  );
}

function UtilityActions({
  race,
  styles,
  onEdit,
  onRemove,
}: {
  race: Race;
  styles: Styles;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.utilityRow}>
      {race.isManual ? (
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit this race" style={styles.utilityButton}>
          <Text style={styles.utilityLink}>Edit this race</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove this race" style={styles.utilityButton}>
        <Text style={styles.utilityLinkDanger}>Remove this race</Text>
      </Pressable>
    </View>
  );
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  floatingBack: ViewStyle;
  notFound: ViewStyle;
  kicker: TextStyle;
  name: TextStyle;
  metaLine: TextStyle;
  subcopy: TextStyle;
  heroWrap: ViewStyle;
  hero: ViewStyle;
  heroTime: TextStyle;
  pillRow: ViewStyle;
  percentileText: TextStyle;
  interpretation: TextStyle;
  section: ViewStyle;
  sectionLabel: TextStyle;
  columnsRow: ViewStyle;
  column: ViewStyle;
  columnLabel: TextStyle;
  columnPrimary: TextStyle;
  columnSecondary: TextStyle;
  needsConfirmationSmall: TextStyle;
  quietLine: TextStyle;
  splitRow: ViewStyle;
  splitLabel: TextStyle;
  splitValues: ViewStyle;
  splitTime: TextStyle;
  splitPace: TextStyle;
  needsConfirmation: TextStyle;
  detailText: TextStyle;
  utilitySpacer: ViewStyle;
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
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      // paddingTop is set inline per-render (insets.top + the floating back button's own height +
      // a small 12-16px gap) — there's no native header reserving space above this content anymore.
      gap: spacing.lg,
    },
    floatingBack: {
      position: 'absolute',
      left: spacing.lg,
      zIndex: 10,
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
    subcopy: {
      fontSize: 15,
      color: palette.inkSecondary,
      marginTop: spacing.md,
    },
    heroWrap: {
      position: 'relative',
      overflow: 'hidden',
      gap: spacing.lg,
    },
    hero: {
      gap: spacing.sm,
    },
    heroTime: {
      fontSize: 58,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    pillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    percentileText: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    interpretation: {
      fontSize: 15,
      fontStyle: 'italic',
      color: palette.inkSecondary,
      marginTop: -spacing.sm,
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
    columnsRow: {
      flexDirection: 'row',
    },
    column: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      gap: 2,
    },
    columnLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    columnPrimary: {
      fontSize: 18,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    columnSecondary: {
      fontSize: 12,
      color: palette.inkSecondary,
      ...tabularNumerals,
      textAlign: 'center',
    },
    needsConfirmationSmall: {
      fontSize: 11,
      color: palette.danger,
      textAlign: 'center',
    },
    quietLine: {
      fontSize: 12,
      color: palette.inkSecondary,
      marginTop: spacing.xs,
      ...tabularNumerals,
    },
    splitRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      minHeight: minTouchSize,
    },
    splitLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.ink,
    },
    splitValues: {
      alignItems: 'flex-end',
    },
    splitTime: {
      fontSize: 18,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    splitPace: {
      fontSize: 13,
      color: palette.inkSecondary,
      ...tabularNumerals,
    },
    needsConfirmation: {
      fontSize: 13,
      color: palette.danger,
    },
    detailText: {
      fontSize: 13,
      color: palette.inkSecondary,
      paddingVertical: 2,
    },
    utilitySpacer: {
      height: spacing.md,
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
