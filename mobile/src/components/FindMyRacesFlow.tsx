import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HairlineRule } from '@/components/HairlineRule';
import { useAppPhase } from '@/lib/appPhase';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, tabularNumerals, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { fetchImportedProviderResultIds, insertConfirmedRaces } from '@/lib/db/races';
import { clearFindRacesRetryDraft, loadFindRacesRetryDraft, saveFindRacesRetryDraft } from '@/lib/findRacesRetryDraft';
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
import { describeImportOutcome, fetchCandidateDetails } from '@/lib/raceImportBatch';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * The reusable, post-login version of onboarding's discovery pipeline (name -> Sportstats search
 * -> bulk-select -> detail -> persist), reachable any time from the global "+" menu or Settings via
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
      return 'Couldn’t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong looking that up.';
  }
}

interface FindMyRacesFlowProps {
  onDone: () => void;
}

export function FindMyRacesFlow({ onDone }: FindMyRacesFlowProps) {
  const { session, signOut } = useAuth();
  const { resetToOnboarding } = useAppPhase();
  const { racingName: primaryRacingName, applyImportedRaces } = useAthleteRaces();
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

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
  const [outcomeMessage, setOutcomeMessage] = useState<{ text: string; action: 'retry' | 'sign_in_again' | null } | null>(null);
  const [retryCandidates, setRetryCandidates] = useState<CandidateRace[]>([]);
  const [retryRows, setRetryRows] = useState<Record<string, unknown>[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const athleteId = session?.user.id;
  const canRetry = outcomeMessage?.action === 'retry' && (retryCandidates.length > 0 || retryRows.length > 0);
  const canSignInAgain = outcomeMessage?.action === 'sign_in_again';

  // Resumes an import interrupted by a session-expiry re-authentication (see handleSignInAgain) —
  // a completely normal visit to this screen just finds no draft and does nothing. Checked once
  // per mount, when a real session first becomes available (this screen is never reachable
  // without one, so `athleteId` is truthy essentially immediately).
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const draft = await loadFindRacesRetryDraft();
      if (!draft || (draft.candidates.length === 0 && (draft.rowsAlreadyFetched ?? []).length === 0)) return;
      if (draft.athleteId !== athleteId) {
        // A draft belonging to a DIFFERENT account than the one now signed in — a shared/reused
        // device, an account switch mid-recovery, or a "delete account, sign up again"
        // recreation (a new account gets a new auth user id even for the same email). Never
        // resumed: that would silently import a stranger's — or a deleted account's — candidates
        // into this session. Cleared, not left to be checked again on every future mount.
        console.warn('[FindMyRaces] discarding a pending-retry draft that belongs to a different account.');
        await clearFindRacesRetryDraft();
        return;
      }
      await clearFindRacesRetryDraft();
      if (cancelled) return;
      setSearchName(draft.searchName);
      if (draft.providerAthleteName) {
        setSelectedIdentity({ providerAthleteId: '', displayName: draft.providerAthleteName });
      }
      const imported = await fetchImportedProviderResultIds(athleteId, 'sportstats');
      if (cancelled) return;
      setAlreadyImportedIds(imported);
      await runImport(draft.candidates, draft.rowsAlreadyFetched ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId]);

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
    setOutcomeMessage(null);
    setImportProgress({ done: rowsAlreadyFetched.length, total: candidatesToFetch.length + rowsAlreadyFetched.length });

    let newPodiums = 0;
    const { rows: fetchedRows, unavailable, failed, unattempted, stopReason } = await fetchCandidateDetails(
      candidatesToFetch,
      (candidate) => fetchRaceDetail(candidate.providerResultId, candidate.providerAthleteResultId, candidate.category),
      (candidate, detail) => {
        if (detail.ageGroupRank && detail.ageGroupRank.place <= 3) newPodiums += 1;
        return candidateDetailToInsertRow(athleteId, candidate, detail, selectedIdentity?.displayName);
      },
      (done) => setImportProgress((current) => ({ ...current, done: rowsAlreadyFetched.length + done })),
    );
    const rows: Record<string, unknown>[] = [...rowsAlreadyFetched, ...fetchedRows];
    // `failed` (isolated network_error, still retryable) and `unattempted` (never tried because
    // the batch paused) are disjoint — both feed the same Retry action, re-attempting exactly
    // these candidates and none of the ones already fetched/saved above.
    const retryable = [...failed.map((f) => f.candidate), ...unattempted];

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
    setRetryCandidates(retryable);
    setOutcomeMessage(
      describeImportOutcome({
        rowsReadyToInsert: rows.length,
        saved,
        insertFailed,
        unavailableCount: unavailable.length,
        retryableCount: retryable.length,
        stopReason,
      }),
    );

    setStep('summary');
  }

  async function handleRetry() {
    if (isRetrying) return;
    setIsRetrying(true);
    await runImport(retryCandidates, retryRows);
    setIsRetrying(false);
  }

  /** Distinct from the plain Retry above: an `unauthorized` detail-fetch means the athlete's
   *  session itself is no longer valid, so nothing in this batch can succeed until they sign in
   *  again — retrying the same request would just fail identically. Mirrors Settings' own
   *  sign-out → resetToOnboarding pattern so they land back on the sign-in screen. */
  async function handleSignInAgain() {
    if (isSigningOut || !athleteId) return;
    setIsSigningOut(true);
    // resetToOnboarding() unmounts this whole screen (see appPhase.tsx's phase switch in
    // _layout.tsx) — every bit of in-memory retry state below would otherwise just vanish.
    // Persisted here, resumed automatically on this screen's next mount (see the effect above),
    // whether that's this same recovery round-trip or the athlete simply reopening "Find more
    // races" from Settings afterward. `athleteId` is captured NOW, while still authenticated —
    // the resume effect refuses to resume a draft whose athleteId doesn't match whoever is
    // signed in when this screen next mounts (see that effect's own comment).
    await saveFindRacesRetryDraft({
      athleteId,
      searchName,
      providerAthleteName: selectedIdentity?.displayName,
      candidates: retryCandidates,
      rowsAlreadyFetched: retryRows,
    });
    try {
      await signOut();
    } catch (err) {
      console.warn('[FindMyRaces] sign-out before re-auth failed:', err);
    }
    resetToOnboarding();
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'identity' ? (
          <View style={styles.stepGap}>
            <Text style={styles.screenTitle}>Find more races.</Text>
            <Text style={styles.subcopy}>
              Search under any name you&apos;ve raced under. This won&apos;t change your account name.
            </Text>
            <Field label="Racing name to search" value={searchName} onChangeText={setSearchName} styles={styles} palette={palette} />
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
            <ActivityIndicator size="large" color={palette.signalBlue} />
            <Text style={styles.subcopy}>Searching public race-result sources…</Text>
          </View>
        ) : null}

        {step === 'disambiguation' ? (
          <View style={styles.stepGap}>
            <Text style={styles.stepTitle}>We found more than one athlete named {searchName}.</Text>
            <Text style={styles.subcopy}>A race you remember can help you tell them apart. Just a hint, not used to search.</Text>
            <Field
              label="A race you remember (optional)"
              value={knownRaceHint}
              onChangeText={setKnownRaceHint}
              styles={styles}
              palette={palette}
            />
            <View>
              {identities.map((identity, index) => (
                <View key={identity.providerAthleteId}>
                  <Pressable
                    onPress={() => loadHistoryFor(identity)}
                    accessibilityRole="button"
                    accessibilityLabel={`This is me: ${identity.displayName}`}
                    style={styles.identityRow}>
                    <Text style={styles.bodyText}>{identity.displayName}</Text>
                    <Text style={styles.identityArrow}>→</Text>
                  </Pressable>
                  {index < identities.length - 1 ? <HairlineRule color={palette.hairline} /> : null}
                </View>
              ))}
            </View>
            <Pressable onPress={backToIdentity} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.skipLink}>Back</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'candidates' ? (
          <View style={styles.stepGap}>
            <Text style={styles.stepTitle}>
              We found <Text style={tabularNumerals}>{candidates.length}</Text> race{candidates.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.subcopy}>Select the ones that are you. Nothing unselected is imported.</Text>

            {candidates.length === 0 ? (
              <Text style={styles.emptyText}>No public race history found for that profile.</Text>
            ) : (
              <View>
                <HairlineRule color={palette.hairline} />
                {candidates.map((candidate, index) => {
                  const alreadyImported = alreadyImportedIds.has(candidate.providerResultId);
                  const selected = selectedIds.has(candidate.providerResultId);
                  return (
                    <View key={candidate.providerResultId}>
                      <Pressable
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
                          color={selected && !alreadyImported ? palette.signalBlue : palette.inkSecondary}
                        />
                        <View style={styles.candidateText}>
                          <Text style={styles.bodyText}>{candidate.eventName}</Text>
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
                      <HairlineRule color={palette.hairline} />
                    </View>
                  );
                })}
              </View>
            )}

            <Pressable
              onPress={() => runImport(candidates.filter((c) => selectedIds.has(c.providerResultId)))}
              disabled={selectedIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel={`Add ${selectedIds.size} races`}
              style={[styles.primaryButton, selectedIds.size === 0 && styles.primaryButtonDisabled]}>
              <Text style={styles.primaryButtonLabel}>
                Add <Text style={tabularNumerals}>{selectedIds.size}</Text> race{selectedIds.size === 1 ? '' : 's'}
              </Text>
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
            <ActivityIndicator size="large" color={palette.signalBlue} />
            <Text style={styles.subcopy}>
              {importProgress.total > 0 ? (
                <>
                  Loading race results… <Text style={tabularNumerals}>{importProgress.done + 1}</Text> of{' '}
                  <Text style={tabularNumerals}>{importProgress.total}</Text>
                </>
              ) : (
                'Saving…'
              )}
            </Text>
          </View>
        ) : null}

        {step === 'summary' ? (
          <View style={styles.centeredStep}>
            <Text style={styles.screenTitle}>{importedCount > 0 ? 'Added to your history.' : 'No races added.'}</Text>
            {outcomeMessage ? <Text style={styles.message}>{outcomeMessage.text}</Text> : null}
            {importedCount > 0 ? (
              <View style={styles.summaryGrid}>
                <SummaryStat label="Races added" value={importedCount} styles={styles} />
                <SummaryStat label="AG podiums" value={podiumCount} styles={styles} />
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
            {canSignInAgain ? (
              <Pressable
                onPress={handleSignInAgain}
                disabled={isSigningOut}
                accessibilityRole="button"
                accessibilityLabel="Sign in again"
                style={[styles.primaryButton, isSigningOut && styles.primaryButtonDisabled]}>
                <Text style={styles.primaryButtonLabel}>{isSigningOut ? 'Signing out…' : 'Sign in again'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDone}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={canRetry || canSignInAgain ? styles.secondaryButton : styles.primaryButton}>
              <Text style={canRetry || canSignInAgain ? styles.secondaryButtonLabel : styles.primaryButtonLabel}>Done</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SummaryStat({ label, value, styles }: { label: string; value: number; styles: Styles }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, tabularNumerals]}>{value}</Text>
      <Text style={styles.kicker}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  styles,
  palette,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  styles: Styles;
  palette: BrandPalette;
}) {
  return (
    <View>
      <Text style={styles.kicker}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={palette.inkSecondary}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: BrandPalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
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
    screenTitle: {
      fontSize: 34,
      fontWeight: '700',
      color: palette.ink,
    },
    stepTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.ink,
    },
    bodyText: {
      fontSize: 15,
      fontWeight: '400',
      color: palette.ink,
    },
    subcopy: {
      fontSize: 15,
      color: palette.inkSecondary,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    message: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.danger,
    },
    input: {
      minHeight: minTouchSize,
      borderWidth: 1,
      borderColor: palette.hairline,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      color: palette.ink,
      marginTop: 4,
    },
    primaryButton: {
      alignSelf: 'stretch',
      minHeight: minTouchSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
      backgroundColor: palette.signalBlue,
      marginTop: spacing.md,
    },
    primaryButtonDisabled: {
      opacity: 0.4,
    },
    primaryButtonLabel: {
      color: palette.onSignalBlue,
      fontWeight: '700',
      fontSize: 16,
    },
    secondaryButton: {
      alignSelf: 'stretch',
      minHeight: minTouchSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
      borderWidth: 1,
      borderColor: palette.hairline,
      backgroundColor: palette.canvasElevated,
      marginTop: spacing.md,
    },
    secondaryButtonLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: palette.ink,
    },
    skipLink: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
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
      paddingVertical: spacing.sm,
    },
    identityArrow: {
      fontSize: 15,
      color: palette.signalBlue,
      fontWeight: '700',
    },
    emptyText: {
      fontSize: 15,
      color: palette.inkSecondary,
      paddingVertical: spacing.md,
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    candidateRowSelected: {
      backgroundColor: withAlpha(palette.signalBlue, 0.08),
    },
    candidateRowDisabled: {
      opacity: 0.5,
    },
    candidateText: {
      flex: 1,
      gap: 2,
    },
    candidateMeta: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
      ...tabularNumerals,
    },
    alreadyAddedBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: palette.canvasElevated,
    },
    alreadyAddedLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.inkSecondary,
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
      fontSize: 34,
      fontWeight: '700',
      color: palette.signalBlue,
    },
  });
}
