import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/Card';
import { useAuth } from '@/lib/auth';
import { fetchImportedProviderResultIds, insertConfirmedRaces } from '@/lib/db/races';
import { AppIcon } from '@/lib/icons';
import { normalizeNameForQuery } from '@/lib/nameNormalization';
import { candidateDetailToInsertRow } from '@/lib/raceMapping';
import {
  fetchCandidateHistory,
  fetchRaceDetail,
  searchAthletes,
  type AthleteIdentity,
  type CandidateRace,
  type UnavailableReason,
} from '@/lib/raceDiscovery';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

/**
 * The reusable, post-login version of onboarding's discovery pipeline (name -> Sportstats search
 * -> bulk-select -> detail -> persist), reachable any time from Home/Season/Settings via
 * `/find-races` — not just once at onboarding. Already authenticated, so there's no auth step and
 * no redirect-survival draft needed (nothing here ever leaves the app). Critically: this can
 * search under a DIFFERENT name than the athlete's primary one (e.g. a fuller legal name) without
 * ever overwriting `athlete_profiles.racing_name` — no call in this file touches that column.
 * `provider_athlete_name` is still recorded per race when a search identity was matched, so
 * provenance shows which name actually found each result.
 */
type Step = 'identity' | 'searching' | 'disambiguation' | 'candidates' | 'importing' | 'summary';

function unavailableCopy(reason: UnavailableReason): string {
  switch (reason) {
    case 'disabled':
      return 'Race discovery is temporarily turned off. Try again later, or add a race manually.';
    case 'rate_limited':
      // See OnboardingFlow's unavailableCopy — same high-ceiling server-side safety guard, same
      // reasoning for not suggesting manual entry here.
      return 'Race search is temporarily unavailable. Please try again shortly.';
    case 'provider_blocked':
      return 'The race-result provider didn’t respond the way we expected.';
    case 'network_error':
      return 'Couldn’t reach the server — check your connection and try again.';
    default:
      return 'Something went wrong looking that up.';
  }
}

interface FindMyRacesFlowProps {
  onDone: () => void;
}

export function FindMyRacesFlow({ onDone }: FindMyRacesFlowProps) {
  const { session } = useAuth();
  const { racingName: primaryRacingName, applyImportedRaces } = useAthleteRaces();

  const [step, setStep] = useState<Step>('identity');
  const [searchName, setSearchName] = useState(primaryRacingName ?? '');
  const [knownRaceHint, setKnownRaceHint] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const [identities, setIdentities] = useState<AthleteIdentity[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<AthleteIdentity | null>(null);
  const [candidates, setCandidates] = useState<CandidateRace[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [alreadyImportedIds, setAlreadyImportedIds] = useState<Set<string>>(new Set());

  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importedCount, setImportedCount] = useState(0);
  const [podiumCount, setPodiumCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryCandidates, setRetryCandidates] = useState<CandidateRace[]>([]);
  const [retryRows, setRetryRows] = useState<Record<string, unknown>[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);

  const athleteId = session?.user.id;
  const canRetry = retryCandidates.length > 0 || retryRows.length > 0;

  async function runSearch() {
    const name = normalizeNameForQuery(searchName);
    if (!name || !athleteId) return;
    setSearchName(name);
    setMessage(null);
    setStep('searching');

    const result = await searchAthletes(name);
    if (!result.available) {
      setMessage(unavailableCopy(result.reason));
      setStep('identity');
      return;
    }
    if (result.data.length === 0) {
      setMessage("We couldn’t find any race history for that name.");
      setStep('identity');
      return;
    }
    if (result.data.length === 1) {
      await loadHistoryFor(result.data[0]!);
      return;
    }
    setIdentities(result.data);
    setStep('disambiguation');
  }

  /** Back to the identity step from disambiguation/candidates — preserves the typed search name so
   *  picking the wrong athlete, or wanting to try a different spelling, is never a dead end. */
  function backToIdentity() {
    setMessage(null);
    setIdentities([]);
    setSelectedIdentity(null);
    setCandidates([]);
    setSelectedIds(new Set());
    setAlreadyImportedIds(new Set());
    setStep('identity');
  }

  /** Candidates' own "Back" — the genuinely previous step, distinct from "Search again"
   *  (backToIdentity, a full restart). See OnboardingFlow's backFromCandidates for the same
   *  reasoning: when disambiguation happened, previous means returning to that identity list
   *  (still held in `identities`), not all the way back to typing a name again. */
  function backFromCandidates() {
    if (identities.length > 1) {
      setCandidates([]);
      setSelectedIds(new Set());
      setAlreadyImportedIds(new Set());
      setStep('disambiguation');
    } else {
      backToIdentity();
    }
  }

  async function loadHistoryFor(identity: AthleteIdentity) {
    setSelectedIdentity(identity);
    setStep('searching');
    const result = await fetchCandidateHistory(identity.providerAthleteId);
    if (!result.available) {
      setMessage(unavailableCopy(result.reason));
      setStep('identity');
      return;
    }
    setCandidates(result.data);
    setSelectedIds(new Set());
    if (athleteId) {
      const imported = await fetchImportedProviderResultIds(athleteId, 'sportstats');
      setAlreadyImportedIds(imported);
    }
    setStep('candidates');
  }

  function toggleCandidate(id: string) {
    if (alreadyImportedIds.has(id)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runImport(candidatesToFetch: CandidateRace[], rowsAlreadyFetched: Record<string, unknown>[] = []) {
    if (!athleteId) return;
    setStep('importing');
    setSaveError(null);
    setImportProgress({ done: rowsAlreadyFetched.length, total: candidatesToFetch.length + rowsAlreadyFetched.length });

    const rows: Record<string, unknown>[] = [...rowsAlreadyFetched];
    let remaining: CandidateRace[] = [];
    let newPodiums = 0;

    for (let i = 0; i < candidatesToFetch.length; i++) {
      const candidate = candidatesToFetch[i]!;
      const detailResult = await fetchRaceDetail(candidate.providerResultId, candidate.providerAthleteResultId, candidate.category);
      if (!detailResult.available) {
        remaining = candidatesToFetch.slice(i);
        break;
      }
      rows.push(candidateDetailToInsertRow(athleteId, candidate, detailResult.data, selectedIdentity?.displayName));
      if (detailResult.data.ageGroupRank && detailResult.data.ageGroupRank.place <= 3) newPodiums += 1;
      setImportProgress((current) => ({ ...current, done: current.done + 1 }));
    }

    let saved = 0;
    let insertFailed = false;
    if (rows.length > 0) {
      try {
        const persisted = await insertConfirmedRaces(rows);
        saved = rows.length;
        applyImportedRaces(persisted);
      } catch (err) {
        insertFailed = true;
        console.warn('[FindMyRaces] insert failed:', err);
      }
    }

    if (saved > 0) {
      setImportedCount((count) => count + saved);
      setPodiumCount((count) => count + newPodiums);
    }

    setRetryRows(insertFailed ? rows : []);
    setRetryCandidates(remaining);

    if (insertFailed) {
      setSaveError(`Found ${rows.length} race${rows.length === 1 ? '' : 's'} but couldn’t save — check your connection and tap Retry.`);
    } else if (remaining.length > 0) {
      setSaveError(`Saved ${saved} — discovery paused partway through. Tap Retry to fetch the rest.`);
    }

    setStep('summary');
  }

  async function handleRetry() {
    if (isRetrying) return;
    setIsRetrying(true);
    await runImport(retryCandidates, retryRows);
    setIsRetrying(false);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'identity' ? (
          <View style={styles.stepGap}>
            <Text style={typography.display}>Find more races.</Text>
            <Text style={styles.subcopy}>
              Search under any name you&apos;ve raced under — this won&apos;t change your account name.
            </Text>
            <Field label="Racing name to search" value={searchName} onChangeText={setSearchName} />
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <Pressable
              onPress={runSearch}
              disabled={searchName.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={[styles.primaryButton, searchName.trim().length === 0 && styles.primaryButtonDisabled]}>
              <Text style={styles.primaryButtonLabel}>Search</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'searching' ? (
          <View style={styles.centeredStep}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.subcopy}>Searching public race-result sources…</Text>
          </View>
        ) : null}

        {step === 'disambiguation' ? (
          <View style={styles.stepGap}>
            <Text style={typography.title}>We found more than one athlete named {searchName}.</Text>
            <Text style={styles.subcopy}>A race you remember can help you tell them apart — just a hint, not used to search.</Text>
            <Field label="A race you remember (optional)" value={knownRaceHint} onChangeText={setKnownRaceHint} />
            {identities.map((identity) => (
              <Pressable
                key={identity.providerAthleteId}
                onPress={() => loadHistoryFor(identity)}
                accessibilityRole="button"
                accessibilityLabel={`This is me: ${identity.displayName}`}
                style={styles.identityRow}>
                <Text style={typography.body}>{identity.displayName}</Text>
                <Text style={styles.identityArrow}>→</Text>
              </Pressable>
            ))}
            <Pressable onPress={backToIdentity} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.skipLink}>Back</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'candidates' ? (
          <View style={styles.stepGap}>
            <Text style={typography.title}>We found {candidates.length} race{candidates.length === 1 ? '' : 's'}</Text>
            <Text style={styles.subcopy}>Select the ones that are you. Nothing unselected is imported.</Text>

            {candidates.length === 0 ? (
              <Card>
                <Text style={typography.body}>No public race history found for that profile.</Text>
              </Card>
            ) : (
              candidates.map((candidate) => {
                const alreadyImported = alreadyImportedIds.has(candidate.providerResultId);
                const selected = selectedIds.has(candidate.providerResultId);
                return (
                  <Pressable
                    key={candidate.providerResultId}
                    onPress={() => toggleCandidate(candidate.providerResultId)}
                    disabled={alreadyImported}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: alreadyImported }}
                    accessibilityLabel={`${candidate.eventName}, ${candidate.eventYear}${alreadyImported ? ', already added' : ''}`}
                    style={[
                      styles.candidateRow,
                      selected && styles.candidateRowSelected,
                      alreadyImported && styles.candidateRowDisabled,
                    ]}>
                    <AppIcon
                      name={alreadyImported ? 'check-circle' : selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={alreadyImported ? colors.textMuted : selected ? colors.accent : colors.textMuted}
                    />
                    <View style={styles.candidateText}>
                      <Text style={typography.body}>{candidate.eventName}</Text>
                      <Text style={styles.candidateMeta}>
                        {candidate.eventDate ?? candidate.eventYear} · {candidate.category}
                      </Text>
                    </View>
                    {alreadyImported ? (
                      <View style={styles.alreadyAddedBadge}>
                        <Text style={styles.alreadyAddedLabel}>Already added</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}

            <Pressable
              onPress={() => runImport(candidates.filter((c) => selectedIds.has(c.providerResultId)))}
              disabled={selectedIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel={`Add ${selectedIds.size} races`}
              style={[styles.primaryButton, selectedIds.size === 0 && styles.primaryButtonDisabled]}>
              <Text style={styles.primaryButtonLabel}>Add {selectedIds.size} race{selectedIds.size === 1 ? '' : 's'}</Text>
            </Pressable>
            <Pressable onPress={backFromCandidates} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.skipLink}>Back</Text>
            </Pressable>
            <Pressable onPress={backToIdentity} accessibilityRole="button" accessibilityLabel="Search again">
              <Text style={styles.skipLink}>Search again</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'importing' ? (
          <View style={styles.centeredStep}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.subcopy}>
              {importProgress.total > 0
                ? `Fetching result ${importProgress.done + 1} of ${importProgress.total}…`
                : 'Saving…'}
            </Text>
          </View>
        ) : null}

        {step === 'summary' ? (
          <View style={styles.centeredStep}>
            <Text style={typography.display}>{importedCount > 0 ? 'Added to your history.' : 'No races added.'}</Text>
            {saveError ? <Text style={styles.message}>{saveError}</Text> : null}
            {importedCount > 0 ? (
              <View style={styles.summaryGrid}>
                <SummaryStat label="Races added" value={importedCount} />
                <SummaryStat label="AG podiums" value={podiumCount} />
              </View>
            ) : null}
            {canRetry ? (
              <Pressable
                onPress={handleRetry}
                disabled={isRetrying}
                accessibilityRole="button"
                accessibilityLabel="Retry"
                style={[styles.primaryButton, isRetrying && styles.primaryButtonDisabled]}>
                <Text style={styles.primaryButtonLabel}>{isRetrying ? 'Retrying…' : 'Retry'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" style={canRetry ? styles.googleButton : styles.primaryButton}>
              <Text style={canRetry ? styles.googleButtonLabel : styles.primaryButtonLabel}>Done</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
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

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (text: string) => void }) {
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
    gap: spacing.md,
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
  message: {
    ...typography.caption,
    color: colors.warning,
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
    alignSelf: 'stretch',
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
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
  googleButton: {
    alignSelf: 'stretch',
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.md,
  },
  googleButtonLabel: {
    ...typography.body,
    fontWeight: '700',
  },
  skipLink: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  identityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  identityArrow: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candidateRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  candidateRowDisabled: {
    opacity: 0.5,
  },
  candidateText: {
    flex: 1,
    gap: 2,
  },
  candidateMeta: {
    ...typography.caption,
  },
  alreadyAddedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
  },
  alreadyAddedLabel: {
    ...typography.label,
    color: colors.textMuted,
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
});
