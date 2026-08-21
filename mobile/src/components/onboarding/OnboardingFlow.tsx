import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { racesPopulated, type Race } from '@/fixtures/races';
import { getCompletedRaces } from '@/lib/races';
import { formatFinishTime } from '@/lib/format';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

type Step = 'intro' | 'searching' | 'candidates' | 'summary';
type CandidateStatus = 'pending' | 'confirmed' | 'rejected';

const SOURCE_LABEL: Record<NonNullable<Race['result']>['sourceStatus'], string> = {
  official_confirmed: 'Official result',
  imported_confirmed: 'Imported result',
  self_reported: 'Self-reported',
};

/** Deterministic, not random — same confidence every time for a stable demo. */
function confidenceFor(race: Race): number {
  switch (race.result?.sourceStatus) {
    case 'official_confirmed':
      return 96;
    case 'imported_confirmed':
      return 88;
    default:
      return 74;
  }
}

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('');
  const [racedUnder, setRacedUnder] = useState('');
  const [birthYearOrCity, setBirthYearOrCity] = useState('');
  const [rememberedRace, setRememberedRace] = useState('');
  const [candidateStatus, setCandidateStatus] = useState<Record<string, CandidateStatus>>({});

  const candidates = useMemo(() => getCompletedRaces(racesPopulated), []);
  const confirmedCount = Object.values(candidateStatus).filter((status) => status === 'confirmed').length;

  const summary = useMemo(() => {
    const completed = getCompletedRaces(racesPopulated);
    return {
      total: completed.length,
      triathlons: completed.filter((race) => race.sport === 'triathlon').length,
      prs: completed.filter((race) => race.result?.isDistancePR).length,
      podiums: completed.filter((race) => race.result?.podium).length,
    };
  }, []);

  useEffect(() => {
    if (step !== 'searching') return;
    const timer = setTimeout(() => setStep('candidates'), 1600);
    return () => clearTimeout(timer);
  }, [step]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {step === 'intro' ? (
          <IntroStep
            name={name}
            racedUnder={racedUnder}
            birthYearOrCity={birthYearOrCity}
            rememberedRace={rememberedRace}
            onChangeName={setName}
            onChangeRacedUnder={setRacedUnder}
            onChangeBirthYearOrCity={setBirthYearOrCity}
            onChangeRememberedRace={setRememberedRace}
            onContinue={() => setStep('searching')}
          />
        ) : null}

        {step === 'searching' ? <SearchingStep /> : null}

        {step === 'candidates' ? (
          <CandidatesStep
            candidates={candidates}
            statusByRaceId={candidateStatus}
            onSetStatus={(raceId, status) =>
              setCandidateStatus((current) => ({ ...current, [raceId]: status }))
            }
            confirmedCount={confirmedCount}
            onContinue={() => setStep('summary')}
          />
        ) : null}

        {step === 'summary' ? <SummaryStep summary={summary} onEnterApp={onComplete} /> : null}
      </ScrollView>

      {step !== 'summary' ? (
        <Pressable
          onPress={onComplete}
          accessibilityRole="button"
          accessibilityLabel="Skip race history recovery"
          style={styles.skip}>
          <Text style={styles.skipLabel}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function IntroStep({
  name,
  racedUnder,
  birthYearOrCity,
  rememberedRace,
  onChangeName,
  onChangeRacedUnder,
  onChangeBirthYearOrCity,
  onChangeRememberedRace,
  onContinue,
}: {
  name: string;
  racedUnder: string;
  birthYearOrCity: string;
  rememberedRace: string;
  onChangeName: (value: string) => void;
  onChangeRacedUnder: (value: string) => void;
  onChangeBirthYearOrCity: (value: string) => void;
  onChangeRememberedRace: (value: string) => void;
  onContinue: () => void;
}) {
  return (
    <View style={styles.stepGap}>
      <Text style={typography.display}>Let&apos;s build your race history.</Text>
      <Text style={styles.subcopy}>
        Tell us a little about how you race, and we&apos;ll search for your past results.
      </Text>

      <Field label="Your name" value={name} onChangeText={onChangeName} />
      <Field
        label="Name you raced under (if different)"
        value={racedUnder}
        onChangeText={onChangeRacedUnder}
      />
      <Field
        label="Birth year or home city (optional)"
        value={birthYearOrCity}
        onChangeText={onChangeBirthYearOrCity}
      />
      <Field
        label="One race you remember"
        value={rememberedRace}
        onChangeText={onChangeRememberedRace}
      />

      <Pressable
        onPress={onContinue}
        disabled={name.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Continue"
        style={[styles.primaryButton, name.trim().length === 0 && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>Continue</Text>
      </Pressable>
    </View>
  );
}

function SearchingStep() {
  return (
    <View style={styles.centeredStep}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.subcopy}>Searching race-result providers…</Text>
    </View>
  );
}

function CandidatesStep({
  candidates,
  statusByRaceId,
  onSetStatus,
  confirmedCount,
  onContinue,
}: {
  candidates: Race[];
  statusByRaceId: Record<string, CandidateStatus>;
  onSetStatus: (raceId: string, status: CandidateStatus) => void;
  confirmedCount: number;
  onContinue: () => void;
}) {
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>We found {candidates.length} possible races</Text>
      <Text style={styles.subcopy}>
        Confirm the ones that are you — you can always fix this later.
      </Text>

      {candidates.map((race) => {
        const status = statusByRaceId[race.id] ?? 'pending';
        const confidence = confidenceFor(race);
        return (
          <Card key={race.id} style={styles.candidateCard}>
            <View style={styles.candidateHeader}>
              <Text style={typography.subtitle}>{race.name}</Text>
              <Badge
                label={confidence >= 90 ? `${confidence}% match` : `${confidence}% possible`}
                tone={confidence >= 90 ? 'accent' : 'warning'}
              />
            </View>
            <Text style={styles.candidateMeta}>
              {race.eventDate} · {race.location}
            </Text>
            {race.result ? (
              <Text style={styles.candidateMeta}>
                {formatFinishTime(race.result.finishSeconds)} · {SOURCE_LABEL[race.result.sourceStatus]}
              </Text>
            ) : null}

            <View style={styles.candidateActions}>
              <Pressable
                onPress={() => onSetStatus(race.id, 'confirmed')}
                accessibilityRole="button"
                accessibilityLabel={`This is me: ${race.name}`}
                style={[
                  styles.candidateButton,
                  status === 'confirmed' && styles.candidateButtonConfirmed,
                ]}>
                <Text
                  style={[
                    styles.candidateButtonLabel,
                    status === 'confirmed' && styles.candidateButtonLabelConfirmed,
                  ]}>
                  {status === 'confirmed' ? 'Confirmed' : 'This is me'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onSetStatus(race.id, 'rejected')}
                accessibilityRole="button"
                accessibilityLabel={`Not me: ${race.name}`}
                style={[
                  styles.candidateButtonSecondary,
                  status === 'rejected' && styles.candidateButtonRejected,
                ]}>
                <Text style={styles.candidateButtonSecondaryLabel}>
                  {status === 'rejected' ? 'Not me' : 'Not me'}
                </Text>
              </Pressable>
            </View>
          </Card>
        );
      })}

      <Pressable
        onPress={onContinue}
        disabled={confirmedCount === 0}
        accessibilityRole="button"
        accessibilityLabel="Continue"
        style={[styles.primaryButton, confirmedCount === 0 && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>
          Continue{confirmedCount > 0 ? ` (${confirmedCount} confirmed)` : ''}
        </Text>
      </Pressable>
    </View>
  );
}

function SummaryStep({
  summary,
  onEnterApp,
}: {
  summary: { total: number; triathlons: number; prs: number; podiums: number };
  onEnterApp: () => void;
}) {
  return (
    <View style={styles.centeredStep}>
      <Text style={typography.display}>Your racing history is ready.</Text>
      <View style={styles.summaryGrid}>
        <SummaryStat label="Races recovered" value={summary.total} />
        <SummaryStat label="Triathlons" value={summary.triathlons} />
        <SummaryStat label="PRs" value={summary.prs} />
        <SummaryStat label="Podiums" value={summary.podiums} />
      </View>
      <Pressable
        onPress={onEnterApp}
        accessibilityRole="button"
        accessibilityLabel="Enter app"
        style={styles.primaryButton}>
        <Text style={styles.primaryButtonLabel}>Enter app</Text>
      </Pressable>
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingTop: spacing.xxl,
    justifyContent: 'center',
  },
  stepGap: {
    gap: spacing.md,
  },
  centeredStep: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  subcopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  input: {
    minHeight: minTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    marginTop: 4,
  },
  primaryButton: {
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonLabel: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 16,
  },
  candidateCard: {
    gap: spacing.xs,
  },
  candidateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  candidateMeta: {
    ...typography.caption,
  },
  candidateActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  candidateButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
  },
  candidateButtonConfirmed: {
    backgroundColor: colors.accentMuted,
  },
  candidateButtonLabel: {
    ...typography.body,
    fontWeight: '700',
  },
  candidateButtonLabelConfirmed: {
    color: colors.accent,
  },
  candidateButtonSecondary: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candidateButtonRejected: {
    borderColor: colors.danger,
  },
  candidateButtonSecondaryLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  summaryStat: {
    alignItems: 'center',
    gap: 2,
    minWidth: 100,
  },
  summaryValue: {
    ...typography.display,
    color: colors.accent,
  },
  skip: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
