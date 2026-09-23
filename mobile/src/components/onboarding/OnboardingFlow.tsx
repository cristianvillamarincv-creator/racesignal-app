import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/Card';
import { useAuth } from '@/lib/auth';
import {
  fetchImportedProviderResultIds,
  insertConfirmedRaces,
  markOnboardingComplete,
  upsertAthleteProfile,
} from '@/lib/db/races';
import { AppIcon } from '@/lib/icons';
import { normalizeNameForQuery } from '@/lib/nameNormalization';
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from '@/lib/onboardingDraft';
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
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

/**
 * B.1: value before signup. Racing name -> discovery (unauthenticated) -> the athlete bulk-selects
 * which candidates are theirs -> sign in ONLY at that point, to save (Google primary, magic-link
 * email fallback) -> full detail fetched only for what was selected -> persisted. Auth is never a
 * dead end: every auth screen offers a way back to 'save' without losing the racing name,
 * discovered candidates, or selections, and both Google and the email path stay reachable from
 * each other. Search itself is never a dead end either — disambiguation and candidates both offer
 * "Search again," preserving the typed racing name. See B1_ARCHITECTURE.md for the full reasoning
 * — nothing here calls Sportstats directly; everything goes through the race-discovery Edge
 * Function.
 *
 * Google's own profile name is never used as the racing name — `racingName` (typed during
 * discovery) is the only thing ever written to `athlete_profiles.racing_name` / used to search.
 *
 * Onboarding-complete is a durable, server-side signal (athlete_profiles.onboarding_completed_at,
 * written by markOnboardingComplete once runImport reaches its terminal state) — not an
 * AsyncStorage flag and not "does a profile row exist," both of which we've seen fail to reflect
 * reality. See lib/appPhase.tsx.
 */
type Step =
  | 'restoring'
  | 'identity'
  | 'searching'
  | 'disambiguation'
  | 'candidates'
  | 'save'
  | 'emailForm'
  | 'checkEmail'
  | 'importing'
  | 'summary';

const RESEND_COOLDOWN_SECONDS = 30;

function unavailableCopy(reason: UnavailableReason): string {
  switch (reason) {
    case 'disabled':
      return 'Race discovery is temporarily turned off. You can still add races manually once you’re in the app.';
    case 'rate_limited':
      // A high-ceiling server-side safety guard (not a normal product constraint — see
      // discovery_rate_limit) — an athlete should essentially never see this. When it does
      // trigger, it's almost certainly transient, so "add manually" isn't offered as the primary
      // fallback here; that would misrepresent a rare safety trip as an expected outcome.
      return 'Race search is temporarily unavailable. Please try again shortly.';
    case 'provider_blocked':
      return 'The race-result provider didn’t respond the way we expected. You can add races manually instead.';
    case 'unauthorized':
      return 'You need to be signed in for that step.';
    case 'network_error':
      return 'Couldn’t reach the server — check your connection and try again.';
    default:
      return 'Something went wrong looking that up.';
  }
}

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { session, requestMagicLink, completeAuthFromUrl } = useAuth();
  const { applyImportedRaces } = useAthleteRaces();

  const [step, setStep] = useState<Step>('restoring');
  const [racingName, setRacingName] = useState('');
  const [birthYearHint, setBirthYearHint] = useState('');
  const [knownRaceHint, setKnownRaceHint] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const [identities, setIdentities] = useState<AthleteIdentity[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<AthleteIdentity | null>(null);
  const [candidates, setCandidates] = useState<CandidateRace[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [alreadyImportedIds, setAlreadyImportedIds] = useState<Set<string>>(new Set());

  const [email, setEmail] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importedCount, setImportedCount] = useState(0);
  const [podiumCount, setPodiumCount] = useState(0);
  const [importedYearRange, setImportedYearRange] = useState<{ min: number; max: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Retry state for a partial/failed import — never discarded until persistence actually
  // succeeds. `retryInsertRows` are already detail-fetched but not yet saved (re-attempt just the
  // insert); `retryFetchCandidates` were never attempted (re-attempt fetch + insert).
  const [athleteIdForRetry, setAthleteIdForRetry] = useState<string | null>(null);
  const [retryFetchCandidates, setRetryFetchCandidates] = useState<CandidateRace[]>([]);
  const [retryInsertRows, setRetryInsertRows] = useState<Record<string, unknown>[]>([]);
  const [totalSelectedForRun, setTotalSelectedForRun] = useState(0);

  const processedUrlRef = useRef<string | null>(null);
  const selectedCount = selectedIds.size;
  const canRetryImport = retryFetchCandidates.length > 0 || retryInsertRows.length > 0;

  // Cold start: the app may have been relaunched by tapping a magic link or returning from the
  // Google browser sheet after the JS context was lost (Android especially). Recover any pending
  // draft and, if the launch URL itself carries a completed sign-in, resume the import.
  useEffect(() => {
    restorePendingAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm case: the app is already running (foreground or backgrounded-but-alive) when the OS
  // hands off the deep link — Linking's 'url' event, not the one-shot getInitialURL() above.
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void processAuthRedirect(url);
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  /**
   * The ONLY thing that turns a completed sign-in into an import, for BOTH the cold-start
   * (getInitialURL) and warm (Linking 'url' event) paths. Deliberately reads everything from the
   * persisted draft rather than component state: this function is reached from a listener
   * registered once, on mount, inside a `useEffect(..., [])` — a closure over `racingName` /
   * `candidates` / `selectedIds` there would freeze at their FIRST-render values (empty string,
   * empty array) and silently stay stale forever, which is exactly what happened in the first
   * physical-device test (confirmed against the live database: an athlete_profiles row with
   * racing_name '' and zero races — the import ran, but with nothing in it). The draft, written
   * synchronously to AsyncStorage right before sign-in starts, has no such staleness problem.
   */
  async function resumeFromDraftAndImport(userId: string) {
    const draft = await loadOnboardingDraft();
    if (!draft) {
      console.warn('[Import] resumeFromDraftAndImport called with no draft on disk — nothing to import.');
      return;
    }
    setRacingName(draft.racingName);
    setBirthYearHint(draft.birthYearHint);
    setCandidates(draft.candidates);
    setSelectedIds(new Set(draft.selectedResultIds));
    const selectedCandidates = draft.candidates.filter((c) => draft.selectedResultIds.includes(c.providerResultId));
    console.log(
      '[Import] resuming from draft: racingName=',
      JSON.stringify(draft.racingName),
      'selected=',
      selectedCandidates.length,
      'of',
      draft.candidates.length,
      'discovered',
    );
    await runImport(userId, draft.racingName, draft.birthYearHint, selectedCandidates, draft.providerAthleteName);
  }

  async function processAuthRedirect(url: string) {
    if (!url.includes('auth-callback') || processedUrlRef.current === url) return;
    processedUrlRef.current = url;

    setStep('importing');
    const { error, userId } = await completeAuthFromUrl(url);
    if (!userId) {
      setAuthError(error ?? 'Sign-in did not complete. Please try again.');
      setStep('save');
      return;
    }
    await resumeFromDraftAndImport(userId);
  }

  async function restorePendingAuth() {
    const draft = await loadOnboardingDraft();
    if (!draft) {
      setStep('identity');
      return;
    }

    // Restore visible state immediately so a "sign-in never completed" fallback below lands on
    // the athlete's actual selections, not a blank screen.
    setRacingName(draft.racingName);
    setBirthYearHint(draft.birthYearHint);
    setCandidates(draft.candidates);
    setSelectedIds(new Set(draft.selectedResultIds));

    let athleteId = session?.user.id ?? null;
    if (!athleteId) {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl?.includes('auth-callback') && processedUrlRef.current !== initialUrl) {
        processedUrlRef.current = initialUrl;
        const { userId } = await completeAuthFromUrl(initialUrl);
        athleteId = userId;
      }
    }

    if (athleteId) {
      await resumeFromDraftAndImport(athleteId);
    } else {
      // Sign-in never completed (e.g. they cancelled, or the email hasn't been tapped yet) — land
      // back on their restored selections rather than making them search again.
      setStep(draft.candidates.length > 0 ? 'candidates' : 'identity');
    }
  }

  async function runSearch() {
    const name = normalizeNameForQuery(racingName);
    if (!name) return;
    setRacingName(name);
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

  /** Back to the identity step from disambiguation/candidates — preserves the typed racing name,
   *  clears whatever was found so re-searching starts clean. Selecting the wrong Sportstats
   *  athlete (or wanting to try a different spelling) must never be a dead end. */
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
   *  (backToIdentity, a full restart). When disambiguation happened (multiple identities found),
   *  previous means returning to that identity list, which `identities` is still holding in state
   *  (loadHistoryFor never clears it) — not all the way back to typing a name again. When there
   *  was only ever one matching identity, disambiguation never happened, so there's nothing to
   *  return to except identity, same as a full restart. */
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
    // Discovery is pre-auth by design, so there's usually no athlete_id to compare against yet —
    // this only has an effect when a session already exists (e.g. resuming after sign-in, or
    // replaying onboarding while still signed in).
    if (session) {
      const imported = await fetchImportedProviderResultIds(session.user.id, 'sportstats');
      setAlreadyImportedIds(imported);
    } else {
      setAlreadyImportedIds(new Set());
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

  function proceedFromCandidates() {
    setAuthError(null);
    if (session) {
      void runImport(session.user.id, racingName, birthYearHint, selectedCandidatesFromState(), selectedIdentity?.displayName);
    } else {
      setStep('save');
    }
  }

  function skipDiscovery() {
    setCandidates([]);
    setSelectedIds(new Set());
    setAuthError(null);
    if (session) {
      void runImport(session.user.id, racingName, birthYearHint, []);
    } else {
      setStep('save');
    }
  }

  function selectedCandidatesFromState(): CandidateRace[] {
    return candidates.filter((candidate) => selectedIds.has(candidate.providerResultId));
  }

  async function persistDraft() {
    await saveOnboardingDraft({
      racingName,
      birthYearHint,
      candidates,
      selectedResultIds: Array.from(selectedIds),
      providerAthleteName: selectedIdentity?.displayName,
    });
  }

  // Google sign-in is hidden for now (P1-6) — not configured yet, so exposing it would just be a
  // broken action. The underlying `signInWithGoogle()` utility stays in lib/auth.tsx; re-adding a
  // handler here (persist draft -> signInWithGoogle -> runImport, same shape as the email path)
  // is a small diff whenever it's revisited ahead of App Store release.

  async function handleSendMagicLink() {
    if (isSendingLink) return;
    setAuthError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setIsSendingLink(true);
    await persistDraft();
    const { error } = await requestMagicLink(trimmed);
    setIsSendingLink(false);
    if (error) {
      setAuthError(error);
      return;
    }
    setStep('checkEmail');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function handleResendMagicLink() {
    if (resendCooldown > 0 || isSendingLink) return;
    setAuthError(null);
    setIsSendingLink(true);
    await persistDraft();
    const { error } = await requestMagicLink(email.trim());
    setIsSendingLink(false);
    if (error) {
      setAuthError(error);
      return;
    }
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  /**
   * Takes the athlete id and everything it needs as explicit arguments rather than reading
   * ambient component state — see resumeFromDraftAndImport's comment for why that matters.
   *
   * Never reports success, and never clears the onboarding draft, unless persistence actually
   * happened: `rowsAlreadyFetched` (detail already fetched, e.g. from a previous failed insert
   * attempt) and `candidatesToFetch` (never attempted) are retried independently, and whatever
   * isn't fully saved by the end of this call is kept in `retryFetchCandidates`/`retryInsertRows`
   * for an explicit Retry action rather than silently dropped.
   *
   * Reaching the end of this function (regardless of how many races were saved — zero is valid)
   * is what "onboarding genuinely completed" means, so markOnboardingComplete is called
   * unconditionally right before showing the summary step.
   */
  async function runImport(
    athleteId: string,
    name: string,
    birthYear: string,
    candidatesToFetch: CandidateRace[],
    providerAthleteName?: string,
    rowsAlreadyFetched: Record<string, unknown>[] = [],
    totalSelectedOverride?: number,
  ) {
    const totalSelected = totalSelectedOverride ?? candidatesToFetch.length + rowsAlreadyFetched.length;
    console.log(
      '[Import] runImport start — athleteId=',
      athleteId,
      'name=',
      JSON.stringify(name),
      'toFetch=',
      candidatesToFetch.length,
      'alreadyFetched=',
      rowsAlreadyFetched.length,
      'totalSelected=',
      totalSelected,
    );

    setStep('importing');
    setSaveError(null);
    setAthleteIdForRetry(athleteId);
    setTotalSelectedForRun(totalSelected);

    const normalizedName = normalizeNameForQuery(name);
    try {
      await upsertAthleteProfile(athleteId, normalizedName, birthYear.trim() ? Number(birthYear.trim()) : undefined);
      console.log('[Import] athlete_profiles upserted, racing_name=', JSON.stringify(normalizedName));
    } catch (err) {
      console.warn('[Import] athlete_profiles upsert FAILED (continuing — races can still save):', err);
    }

    setImportProgress({ done: rowsAlreadyFetched.length, total: totalSelected });

    const rows: Record<string, unknown>[] = [...rowsAlreadyFetched];
    let remainingCandidates: CandidateRace[] = [];
    let newPodiums = 0;

    for (let i = 0; i < candidatesToFetch.length; i++) {
      const candidate = candidatesToFetch[i]!;
      const detailResult = await fetchRaceDetail(candidate.providerResultId, candidate.providerAthleteResultId, candidate.category);
      if (!detailResult.available) {
        console.warn('[Import] detail fetch stopped early at', candidate.eventName, '— reason:', detailResult.reason);
        remainingCandidates = candidatesToFetch.slice(i);
        break;
      }
      rows.push(candidateDetailToInsertRow(athleteId, candidate, detailResult.data, providerAthleteName));
      if (detailResult.data.ageGroupRank && detailResult.data.ageGroupRank.place <= 3) newPodiums += 1;
      setImportProgress((current) => ({ ...current, done: current.done + 1 }));
    }

    let saved = 0;
    let insertFailed = false;
    if (rows.length > 0) {
      try {
        console.log('[Import] inserting', rows.length, 'race row(s)…');
        const persisted = await insertConfirmedRaces(rows);
        saved = rows.length;
        applyImportedRaces(persisted);
        console.log('[Import] insert succeeded for', saved, 'row(s)');
      } catch (err) {
        insertFailed = true;
        console.warn('[Import] insertConfirmedRaces FAILED — draft will NOT be cleared:', err);
      }
    }

    if (saved > 0) {
      setImportedCount((count) => count + saved);
      setPodiumCount((count) => count + newPodiums);
      const years = rows.map((row) => row.event_year as number).filter((year) => Number.isFinite(year));
      if (years.length > 0) {
        const newMin = Math.min(...years);
        const newMax = Math.max(...years);
        setImportedYearRange((current) =>
          current ? { min: Math.min(current.min, newMin), max: Math.max(current.max, newMax) } : { min: newMin, max: newMax },
        );
      }
    }

    const stillNeedsInsert = insertFailed ? rows : [];
    setRetryInsertRows(stillNeedsInsert);
    setRetryFetchCandidates(remainingCandidates);

    const fullyDone = stillNeedsInsert.length === 0 && remainingCandidates.length === 0;

    if (fullyDone) {
      await clearOnboardingDraft();
      console.log('[Import] complete —', saved, 'of', totalSelected, 'saved, draft cleared.');
      // Reaching a fully-done state — whether zero races were ever selected, or every selected
      // race saved (possibly after one or more retries) — is what "onboarding genuinely
      // completed" means. A partial/failed state must NOT mark this: see handleEnterApp for the
      // other way completion can still happen (the athlete explicitly taps "Continue anyway").
      try {
        await markOnboardingComplete(athleteId);
      } catch (err) {
        console.warn('[Import] markOnboardingComplete failed (will re-check on next launch):', err);
      }
    } else if (insertFailed) {
      setSaveError(
        `Found ${rows.length} race${rows.length === 1 ? '' : 's'} but couldn’t save ${
          rows.length === 1 ? 'it' : 'them'
        } — check your connection and tap Retry. Nothing is lost.`,
      );
    } else {
      setSaveError(
        `Saved ${saved} of ${totalSelected} selected race${totalSelected === 1 ? '' : 's'} — discovery paused partway through. Tap Retry to fetch the rest.`,
      );
    }

    setStep('summary');
  }

  async function handleRetryImport() {
    if (!athleteIdForRetry || isRetrying) return;
    setIsRetrying(true);
    await runImport(
      athleteIdForRetry,
      racingName,
      birthYearHint,
      retryFetchCandidates,
      selectedIdentity?.displayName,
      retryInsertRows,
      totalSelectedForRun,
    );
    setIsRetrying(false);
  }

  /**
   * The Summary screen's own "Continue anyway" / "Explore my racing history" / "Enter app"
   * button. When runImport already reached a fully-done state, it already marked completion
   * itself — this call is then a harmless idempotent re-write. But when a partial/failed import
   * left retry state around (canRetryImport), runImport deliberately did NOT mark completion, so
   * onboarding would still show as incomplete on a future launch unless the athlete explicitly
   * chooses to move on from here — which this button is exactly that choice.
   */
  async function handleEnterApp() {
    if (athleteIdForRetry) {
      try {
        await markOnboardingComplete(athleteIdForRetry);
      } catch (err) {
        console.warn('[Import] markOnboardingComplete (explicit continue) failed:', err);
      }
    }
    onComplete();
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isSupabaseConfigured ? (
          <View style={styles.centeredStep}>
            <Text style={typography.title}>Supabase isn&apos;t configured yet.</Text>
            <Text style={styles.subcopy}>
              Copy mobile/.env.example to mobile/.env, fill in your project&apos;s URL and anon key,
              and restart the app — see supabase/README.md.
            </Text>
          </View>
        ) : step === 'restoring' ? (
          <View style={styles.centeredStep}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <>
            {step === 'identity' ? (
              <IdentityStep
                racingName={racingName}
                onChangeRacingName={setRacingName}
                message={message}
                onContinue={runSearch}
              />
            ) : null}

            {step === 'searching' ? (
              <View style={styles.centeredStep}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.subcopy}>Searching public race-result sources…</Text>
              </View>
            ) : null}

            {step === 'disambiguation' ? (
              <DisambiguationStep
                name={racingName}
                identities={identities}
                birthYearHint={birthYearHint}
                knownRaceHint={knownRaceHint}
                onChangeBirthYearHint={setBirthYearHint}
                onChangeKnownRaceHint={setKnownRaceHint}
                onSelect={loadHistoryFor}
                onBack={backToIdentity}
              />
            ) : null}

            {step === 'candidates' ? (
              <CandidatesStep
                athleteName={selectedIdentity?.displayName ?? racingName}
                candidates={candidates}
                selectedIds={selectedIds}
                alreadyImportedIds={alreadyImportedIds}
                onToggle={toggleCandidate}
                onContinue={proceedFromCandidates}
                onSkip={skipDiscovery}
                onBack={backFromCandidates}
                onSearchAgain={backToIdentity}
              />
            ) : null}

            {step === 'save' ? (
              <SaveStep
                selectedCount={selectedCount}
                error={authError}
                onUseEmail={() => {
                  setAuthError(null);
                  setStep('emailForm');
                }}
                onBack={() => {
                  setAuthError(null);
                  setStep('candidates');
                }}
              />
            ) : null}

            {step === 'emailForm' ? (
              <EmailFormStep
                email={email}
                onChangeEmail={setEmail}
                error={authError}
                selectedCount={selectedCount}
                isSending={isSendingLink}
                onSendLink={handleSendMagicLink}
                onBack={() => {
                  setAuthError(null);
                  setStep('save');
                }}
              />
            ) : null}

            {step === 'checkEmail' ? (
              <CheckEmailStep
                email={email}
                error={authError}
                resendCooldown={resendCooldown}
                isSending={isSendingLink}
                onResend={handleResendMagicLink}
                onChangeEmail={() => {
                  setAuthError(null);
                  setStep('emailForm');
                }}
                onBack={() => {
                  setAuthError(null);
                  setStep('save');
                }}
              />
            ) : null}

            {step === 'importing' ? (
              <View style={styles.centeredStep}>
                <ActivityIndicator size="large" color={colors.accent} />
                <Text style={styles.subcopy}>
                  {importProgress.total > 0
                    ? `Fetching result ${importProgress.done + 1} of ${importProgress.total}…`
                    : 'Saving your race history…'}
                </Text>
              </View>
            ) : null}

            {step === 'summary' ? (
              <SummaryStep
                imported={importedCount}
                podiums={podiumCount}
                yearRange={importedYearRange}
                error={saveError}
                canRetry={canRetryImport}
                isRetrying={isRetrying}
                onRetry={handleRetryImport}
                onEnterApp={handleEnterApp}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function IdentityStep({
  racingName,
  onChangeRacingName,
  message,
  onContinue,
}: {
  racingName: string;
  onChangeRacingName: (value: string) => void;
  message: string | null;
  onContinue: () => void;
}) {
  return (
    <View style={styles.stepGap}>
      <Text style={typography.display}>Let&apos;s find your race history.</Text>
      <Text style={styles.subcopy}>Just your racing name to start — we&apos;ll search before you sign in.</Text>

      <Field label="What name do you race under?" value={racingName} onChangeText={onChangeRacingName} />

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable
        onPress={onContinue}
        disabled={racingName.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Search"
        style={[styles.primaryButton, racingName.trim().length === 0 && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>Search</Text>
      </Pressable>
    </View>
  );
}

function DisambiguationStep({
  name,
  identities,
  birthYearHint,
  knownRaceHint,
  onChangeBirthYearHint,
  onChangeKnownRaceHint,
  onSelect,
  onBack,
}: {
  name: string;
  identities: AthleteIdentity[];
  birthYearHint: string;
  knownRaceHint: string;
  onChangeBirthYearHint: (value: string) => void;
  onChangeKnownRaceHint: (value: string) => void;
  onSelect: (identity: AthleteIdentity) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>We found more than one athlete named {name}.</Text>
      <Text style={styles.subcopy}>
        A race you remember, or your birth year, can help you tell them apart below — we don&apos;t use
        these to search, just as a hint for you.
      </Text>

      <Field label="A race you remember (optional)" value={knownRaceHint} onChangeText={onChangeKnownRaceHint} />
      <Field
        label="Birth year (optional)"
        value={birthYearHint}
        onChangeText={onChangeBirthYearHint}
        keyboardType="number-pad"
      />

      {identities.map((identity) => (
        <Pressable
          key={identity.providerAthleteId}
          onPress={() => onSelect(identity)}
          accessibilityRole="button"
          accessibilityLabel={`This is me: ${identity.displayName}`}
          style={styles.identityRow}>
          <Text style={typography.body}>{identity.displayName}</Text>
          <Text style={styles.identityArrow}>→</Text>
        </Pressable>
      ))}

      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.skipLink}>Back</Text>
      </Pressable>
    </View>
  );
}

function CandidatesStep({
  athleteName,
  candidates,
  selectedIds,
  alreadyImportedIds,
  onToggle,
  onContinue,
  onSkip,
  onBack,
  onSearchAgain,
}: {
  athleteName: string;
  candidates: CandidateRace[];
  selectedIds: Set<string>;
  alreadyImportedIds: Set<string>;
  onToggle: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
  onSearchAgain: () => void;
}) {
  const selectedCount = selectedIds.size;
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>We found {candidates.length} race{candidates.length === 1 ? '' : 's'}</Text>
      <Text style={styles.subcopy}>
        Select the ones that are you, {athleteName}. Nothing unselected is imported — you can always
        add more later.
      </Text>

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
              onPress={() => onToggle(candidate.providerResultId)}
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
        onPress={onContinue}
        disabled={selectedCount === 0}
        accessibilityRole="button"
        accessibilityLabel={`Add ${selectedCount} races`}
        style={[styles.primaryButton, selectedCount === 0 && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>Add {selectedCount} race{selectedCount === 1 ? '' : 's'}</Text>
      </Pressable>

      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.skipLink}>Back</Text>
      </Pressable>

      <Pressable onPress={onSearchAgain} accessibilityRole="button" accessibilityLabel="Search again">
        <Text style={styles.skipLink}>Search again</Text>
      </Pressable>

      <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="Continue without importing">
        <Text style={styles.skipLink}>Continue without importing</Text>
      </Pressable>
    </View>
  );
}

/**
 * The auth-choice screen. Google sign-in is hidden for now (P1-6) — it isn't configured yet and
 * would just be a broken action; only the email path is offered until that's revisited ahead of
 * App Store release. `handleGoogleSignIn` and the Google UI remain in this file, just unrendered,
 * so re-enabling later is a small diff rather than rebuilding the flow.
 */
function SaveStep({
  selectedCount,
  error,
  onUseEmail,
  onBack,
}: {
  selectedCount: number;
  error: string | null;
  onUseEmail: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>
        Sign in to save {selectedCount > 0 ? `${selectedCount} race${selectedCount === 1 ? '' : 's'}` : 'your history'}.
      </Text>
      <Text style={styles.subcopy}>Your racing name stays what you typed — this just saves it to your account.</Text>

      {error ? <Text style={styles.message}>{error}</Text> : null}

      <Pressable
        onPress={onUseEmail}
        accessibilityRole="button"
        accessibilityLabel="Continue with email"
        style={styles.primaryButton}>
        <Text style={styles.primaryButtonLabel}>Continue with email</Text>
      </Pressable>

      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.skipLink}>Back</Text>
      </Pressable>
    </View>
  );
}

function EmailFormStep({
  email,
  onChangeEmail,
  error,
  selectedCount,
  isSending,
  onSendLink,
  onBack,
}: {
  email: string;
  onChangeEmail: (value: string) => void;
  error: string | null;
  selectedCount: number;
  isSending: boolean;
  onSendLink: () => void;
  onBack: () => void;
}) {
  const disabled = email.trim().length === 0 || isSending;
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>Sign in to save {selectedCount > 0 ? `${selectedCount} race${selectedCount === 1 ? '' : 's'}` : 'your history'}.</Text>
      <Text style={styles.subcopy}>We&apos;ll email you a link — no password, nothing to type.</Text>

      <Field label="Email" value={email} onChangeText={onChangeEmail} keyboardType="email-address" autoCapitalize="none" />

      {error ? <Text style={styles.message}>{error}</Text> : null}

      <Pressable
        onPress={onSendLink}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Send magic link"
        style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>{isSending ? 'Sending…' : 'Send magic link'}</Text>
      </Pressable>

      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.skipLink}>Back</Text>
      </Pressable>
    </View>
  );
}

function CheckEmailStep({
  email,
  error,
  resendCooldown,
  isSending,
  onResend,
  onChangeEmail,
  onBack,
}: {
  email: string;
  error: string | null;
  resendCooldown: number;
  isSending: boolean;
  onResend: () => void;
  onChangeEmail: () => void;
  onBack: () => void;
}) {
  const resendDisabled = resendCooldown > 0 || isSending;
  return (
    <View style={styles.stepGap}>
      <Text style={typography.title}>Check your email</Text>
      <Text style={styles.subcopy}>
        We sent a sign-in link to {email}. Tap it on this phone to come back here automatically.
      </Text>

      {error ? <Text style={styles.message}>{error}</Text> : null}

      <Pressable
        onPress={onResend}
        disabled={resendDisabled}
        accessibilityRole="button"
        accessibilityLabel="Resend email"
        style={[styles.primaryButton, resendDisabled && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>
          {isSending ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
        </Text>
      </Pressable>

      <Pressable onPress={onChangeEmail} accessibilityRole="button" accessibilityLabel="Use a different email">
        <Text style={styles.skipLink}>Use a different email</Text>
      </Pressable>

      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.skipLink}>Back</Text>
      </Pressable>
    </View>
  );
}

function SummaryStep({
  imported,
  podiums,
  yearRange,
  error,
  canRetry,
  isRetrying,
  onRetry,
  onEnterApp,
}: {
  imported: number;
  podiums: number;
  yearRange: { min: number; max: number } | null;
  error: string | null;
  canRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onEnterApp: () => void;
}) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fade]);

  const yearLabel = yearRange ? (yearRange.min === yearRange.max ? `${yearRange.min}` : `${yearRange.min} → ${yearRange.max}`) : null;

  return (
    <Animated.View style={[styles.centeredStep, { opacity: fade }]}>
      <Text style={typography.display}>
        {imported > 0 ? `We found ${imported} race${imported === 1 ? '' : 's'}` : "You're all set."}
      </Text>
      {yearLabel ? <Text style={styles.yearRange}>{yearLabel}</Text> : null}
      {error ? <Text style={styles.message}>{error}</Text> : null}
      {imported > 0 ? (
        <View style={styles.summaryGrid}>
          <SummaryStat label="Races added" value={imported} />
          <SummaryStat label="AG podiums" value={podiums} />
        </View>
      ) : !error ? (
        <Text style={styles.subcopy}>
          Nothing imported yet — you can search again or add races manually anytime from Season or
          Settings.
        </Text>
      ) : null}

      {canRetry ? (
        <Pressable
          onPress={onRetry}
          disabled={isRetrying}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={[styles.primaryButton, isRetrying && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonLabel}>{isRetrying ? 'Retrying…' : 'Retry'}</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onEnterApp}
        accessibilityRole="button"
        accessibilityLabel="Explore my racing history"
        style={canRetry ? styles.googleButton : styles.primaryButton}>
        <Text style={canRetry ? styles.googleButtonLabel : styles.primaryButtonLabel}>
          {canRetry ? 'Continue anyway' : imported > 0 ? 'Explore my racing history' : 'Enter app'}
        </Text>
      </Pressable>
    </Animated.View>
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
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
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
    flexDirection: 'row',
    gap: spacing.sm,
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
  yearRange: {
    ...typography.subtitle,
    color: colors.textSecondary,
  },
});
