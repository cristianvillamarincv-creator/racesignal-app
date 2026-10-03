import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HairlineRule } from '@/components/HairlineRule';
import { RaceLineMotif } from '@/components/RaceLineMotif';
import { SignalMark } from '@/components/SignalMark';
import { SocialSignInButtons, type ProviderErrors } from '@/components/onboarding/SocialSignInButtons';
import { useAuth } from '@/lib/auth';
import { RESEND_SUCCESS_MESSAGE } from '@/lib/authErrorMessages';
import { type BrandPalette, tabularNumerals, useBrandPalette } from '@/lib/brandTheme';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import {
  fetchImportedProviderResultIds,
  fetchOnboardingCompletedAt,
  insertConfirmedRaces,
  markOnboardingComplete,
  upsertAthleteProfile,
} from '@/lib/db/races';
import { formatRaceDate } from '@/lib/format';
import { AppIcon } from '@/lib/icons';
import { normalizeNameForQuery } from '@/lib/nameNormalization';
import { isPlausibleEmail, normalizeEmailInput } from '@/lib/emailInput';
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from '@/lib/onboardingDraft';
import { type SocialProvider } from '@/lib/socialAuth';
import { runSocialSignIn } from '@/lib/socialSignInFlow';
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
import { isSupabaseConfigured } from '@/lib/supabaseClient';
import { minTouchSize, spacing } from '@/lib/theme';

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
 *
 * Visual language: "Race Morning Precision" (brandTheme.ts), matching results/[id].tsx and the
 * already-migrated Races tab (RaceRow.tsx) — cool dark / technical-paper light canvas, large
 * editorial headlines, hairline rules instead of boxed cards, and signalBlue as the one
 * interactive color. This is a presentation-only pass — every handler above/below stays wired
 * exactly as before; only JSX composition and styling changed.
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
  | 'existingAccount'
  | 'importing'
  | 'summary';

// Aligned with Supabase's own auth email rate limit (Step 7's custom SMTP config) — long enough
// that a resend during normal delivery latency is rare, reducing how often an athlete ends up with
// two outstanding magic links (see the PKCE-verifier-overwrite note on handleResendMagicLink).
const RESEND_COOLDOWN_SECONDS = 60;

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
      return 'Couldn’t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong looking that up.';
  }
}

interface OnboardingFlowProps {
  onComplete: () => void;
  /** Developer Preview's "Replay onboarding (simulated)" mode (see lib/devPreview.tsx and
   *  _layout.tsx) — false/omitted for the real flow, which is completely unaffected. When true,
   *  the magic-link send/resend handlers never call the real `requestMagicLink()`, and CheckEmailStep
   *  shows an extra dev-only button that hands off to `onSimulatedComplete` instead of any real
   *  auth/import code path. */
  simulateAuth?: boolean;
  /** Only meaningful when `simulateAuth` is true — called when the tester taps CheckEmailStep's
   *  "Simulate tapping the magic link" button. Never calls completeAuthFromUrl, resumeFromDraftAndImport,
   *  or runImport; the real auth/import code stays completely unexercised for the simulated case. */
  onSimulatedComplete?: () => void;
}

export function OnboardingFlow({ onComplete, simulateAuth = false, onSimulatedComplete }: OnboardingFlowProps) {
  const { session, requestMagicLink, completeAuthFromUrl, signInWithPassword, signInWithProvider, signOut } = useAuth();
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
  // Distinct from authError (never shown at the same time as it — every path that sets one clears
  // the other) so a successful resend reads as reassuring progress, not another error-style message.
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [isSendingLink, setIsSendingLink] = useState(false);
  // Which provider's sign-in is in flight, and the last provider failure. Kept apart from `authError` (email
  // errors) so each message sits where it belongs: provider failures directly below that provider's button.
  const [socialBusyProvider, setSocialBusyProvider] = useState<SocialProvider | null>(null);
  const [socialError, setSocialError] = useState<{ provider: SocialProvider; message: string } | null>(null);
  const isSocialSigningIn = socialBusyProvider !== null;
  const [resendCooldown, setResendCooldown] = useState(0);

  // "Already have an account? Sign in" — a returning athlete authenticating directly, with no
  // discovery/candidates involved. Tracked separately from the normal discovery-then-save flow so
  // a completed sign-in never triggers runImport (which would upsert athlete_profiles with this
  // fresh session's blank racingName/candidates, overwriting the athlete's real, existing profile).
  const [isReturningUserFlow, setIsReturningUserFlow] = useState(false);

  // Set when a sign-in (any method) lands on an account that has ALREADY completed onboarding while the
  // athlete still had race selections pending from this flow. Their selections are preserved and they choose
  // "Review selected races" or "Skip"; nothing is imported until they confirm, and the import then leaves the
  // existing profile (racing name, birth year, completion time) untouched. See resumeFromDraftAndImport.
  const [existingAccountUserId, setExistingAccountUserId] = useState<string | null>(null);
  const existingAccountImportRef = useRef(false);

  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importedCount, setImportedCount] = useState(0);
  const [podiumCount, setPodiumCount] = useState(0);
  const [importedYearRange, setImportedYearRange] = useState<{ min: number; max: number } | null>(null);
  const [importOutcome, setImportOutcome] = useState<{ text: string; action: 'retry' | 'sign_in_again' | null } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSigningOutForReauth, setIsSigningOutForReauth] = useState(false);
  // Captured by handleSignInAgain from the expiring session BEFORE signOut() runs (by the time
  // persistDraft() below actually executes — when the athlete taps "Send sign-in link" — `session`
  // is already null). Read by persistDraft() as the draft's account-binding origin id; see
  // onboardingDraft.ts's originAthleteId doc and resumeFromDraftAndImport's mismatch guard.
  const [reauthOriginAthleteId, setReauthOriginAthleteId] = useState<string | null>(null);

  // Retry state for a partial/failed import — never discarded until persistence actually
  // succeeds. `retryInsertRows` are already detail-fetched but not yet saved (re-attempt just the
  // insert); `retryFetchCandidates` were never attempted (re-attempt fetch + insert).
  const [athleteIdForRetry, setAthleteIdForRetry] = useState<string | null>(null);
  const [retryFetchCandidates, setRetryFetchCandidates] = useState<CandidateRace[]>([]);
  const [retryInsertRows, setRetryInsertRows] = useState<Record<string, unknown>[]>([]);
  const [totalSelectedForRun, setTotalSelectedForRun] = useState(0);

  const processedUrlRef = useRef<string | null>(null);
  // Guards against two overlapping runImport calls both succeeding and inserting the same races
  // twice — e.g. a cold-start resume and the warm Linking listener both firing for the same
  // completed sign-in, or a retry started while a still-hung prior attempt hasn't yet given up.
  const importInFlightRef = useRef(false);
  const selectedCount = selectedIds.size;
  const canRetryImport = importOutcome?.action === 'retry' && (retryFetchCandidates.length > 0 || retryInsertRows.length > 0);
  const canSignInAgain = importOutcome?.action === 'sign_in_again';

  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  // The shared ScrollView below has no native header reserving space above it — every step's
  // content must clear the status bar itself on notched/Dynamic-Island devices, the same
  // insets.top-aware approach results/[id].tsx uses for its own floating-header layout.
  const insets = useSafeAreaInsets();

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
    if (draft.originAthleteId && draft.originAthleteId !== userId) {
      // A session-expiry-recovery draft (see handleSignInAgain) bound to a DIFFERENT account than
      // the one that just completed sign-in — AsyncStorage is shared device-wide, so this must
      // never silently import a stranger's (or a previously-deleted account's) candidates into
      // this new session. Discarded, not resumed; this session proceeds as if no draft existed.
      console.warn('[Import] discarding a pending draft that belongs to a different account than the one that just signed in.');
      await clearOnboardingDraft();
      return;
    }
    if (draft.isReturningUserSignIn) {
      await resumeReturningUser(userId);
      return;
    }
    // A session-expiry recovery draft (originAthleteId set and matching) is mid-import for an account that has
    // not completed onboarding, so it skips this check. Anything else that signs in to an account which already
    // completed onboarding must never run the normal import (it would overwrite that profile): the athlete's
    // selections are kept and they decide what to do.
    if (!draft.originAthleteId) {
      const completedAt = await fetchOnboardingCompletedAt(userId);
      // Routing diagnostics: booleans and counts only (never ids, emails, or race names).
      console.log('[Onboarding] sign-in routing: onboardingCompleted=', Boolean(completedAt), 'pendingSelections=', draft.selectedResultIds.length);
      if (completedAt) {
        await offerExistingAccountReview(userId, draft);
        return;
      }
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
    await runImport(userId, draft.racingName, draft.birthYearHint, selectedCandidates, draft.providerAthleteName, draft.rowsAlreadyFetched ?? []);
  }

  /**
   * The "Already have an account? Sign in" path's post-auth handling — deliberately never calls
   * runImport. That function upserts athlete_profiles with whatever racingName/candidates this
   * fresh onboarding session happens to hold (blank/empty here), which would overwrite the
   * returning athlete's real, already-saved profile. Their profile and races already exist
   * server-side and load automatically once `session` is set (AthleteRacesProvider reacts to it)
   * — there is nothing to import.
   */
  async function resumeReturningUser(userId: string) {
    try {
      await clearOnboardingDraft();
      const completedAt = await fetchOnboardingCompletedAt(userId);
      console.log('[Onboarding] returning-user routing: onboardingCompleted=', Boolean(completedAt));
      if (completedAt) {
        onComplete();
        return;
      }
      // Authenticated, but either this athlete genuinely never finished onboarding, OR the check
      // above timed out/failed and returned null indistinguishably from "not onboarded" (see
      // fetchOnboardingCompletedAt's doc comment) — both land here safely: resume the normal flow
      // from the top. They're already signed in, so proceedFromCandidates/skipDiscovery will skip
      // straight to import once reached, instead of asking them to sign in again. Worst case for
      // the timeout scenario is a redundant re-search, never data loss or a stuck screen.
      setIsReturningUserFlow(false);
      setAuthError(null);
      setStep('identity');
    } catch (err) {
      // fetchOnboardingCompletedAt/clearOnboardingDraft are both already internally safe and
      // shouldn't throw — this is a last-resort net so a genuinely authenticated athlete is never
      // left on an indefinite spinner if something here still goes wrong.
      console.warn('[Onboarding] resumeReturningUser failed unexpectedly:', err);
      setIsReturningUserFlow(false);
      setAuthError('Signed in, but something went wrong loading your account. Please try again.');
      setStep('identity');
    }
  }

  /**
   * The signed-in account already finished onboarding. Keep the pending selections, drop the ones the account
   * already has (existing deduplication: confirmed provider_result_ids), and ask. With nothing left to add there
   * is nothing to ask, so go straight to the app.
   */
  async function offerExistingAccountReview(userId: string, draft: NonNullable<Awaited<ReturnType<typeof loadOnboardingDraft>>>) {
    if (draft.selectedResultIds.length === 0) {
      await resumeReturningUser(userId);
      return;
    }
    const imported = await fetchImportedProviderResultIds(userId, 'sportstats');
    const pending = draft.selectedResultIds.filter((id) => !imported.has(id));
    if (pending.length === 0) {
      await resumeReturningUser(userId);
      return;
    }
    setRacingName(draft.racingName);
    setBirthYearHint(draft.birthYearHint);
    setCandidates(draft.candidates);
    setAlreadyImportedIds(imported);
    setSelectedIds(new Set(pending));
    setExistingAccountUserId(userId);
    setAuthError(null);
    setStep('existingAccount');
  }

  function reviewSelectedRacesForExistingAccount() {
    existingAccountImportRef.current = true;
    setStep('candidates');
  }

  async function skipReviewForExistingAccount() {
    if (!existingAccountUserId) return;
    await resumeReturningUser(existingAccountUserId);
  }

  function startReturningUserSignIn() {
    setAuthError(null);
    setIsReturningUserFlow(true);
    setStep('emailForm');
  }

  /**
   * B.14 confirmed root cause: password sign-in (a sign-in-only path — there is no registration
   * flow here, so this is ALWAYS a returning account) called the raw `signInWithPassword` from
   * useAuth() directly and stopped there. A session was genuinely established (confirmed via direct
   * Supabase Auth API calls and authPasswordSignIn.test.tsx), but nothing then checked whether this
   * account had already completed onboarding and called `onComplete()` — the one thing that
   * actually flips RootNavigator's phase to 'app' locally and immediately. The magic-link deep-link
   * path (processAuthRedirect -> resumeFromDraftAndImport -> resumeReturningUser) already does
   * exactly this check; AppPhaseProvider's own one-time-at-launch classification effect deliberately
   * does NOT re-run on a later session change (see appPhase.tsx's doc comment — reactively
   * re-classifying could yank an in-progress NEW-user import out from under itself), so there was
   * nothing else to drive the transition until the next full app relaunch, which is exactly the
   * device report ("closing and reopening the app gets me in"). Reusing resumeReturningUser here —
   * not duplicating its logic — makes the password path behave identically to the already-reviewed
   * magic-link one.
   */
  async function handlePasswordSignIn(rawEmail: string, password: string): Promise<{ error: string | null }> {
    const normalized = normalizeEmailInput(rawEmail);
    if (!isPlausibleEmail(normalized)) {
      return { error: 'Enter a valid email address.' };
    }
    const { error, userId } = await signInWithPassword(normalized, password);
    if (error || !userId) return { error };
    await resumeReturningUser(userId);
    return { error: null };
  }

  async function processAuthRedirect(url: string) {
    if (!url.includes('auth-callback') || processedUrlRef.current === url) return;
    processedUrlRef.current = url;

    setStep('importing');
    try {
      const { error, userId } = await completeAuthFromUrl(url);
      if (!userId) {
        setAuthError(error ?? 'Sign-in did not complete. Please try again.');
        setStep(isReturningUserFlow ? 'emailForm' : 'save');
        return;
      }
      await resumeFromDraftAndImport(userId);
    } catch (err) {
      // A safety net, not the primary fix — completeAuthFromUrl and fetchOnboardingCompletedAt are
      // already timeout-bounded and internally caught (see lib/auth.tsx, lib/db/races.ts), so this
      // should rarely fire. It exists so ANY unexpected failure in this chain still lands on a
      // recoverable screen instead of leaving the athlete stuck on the importing spinner forever —
      // selections/draft state are untouched, so retrying from here is safe.
      console.warn('[Onboarding] processAuthRedirect failed unexpectedly:', err);
      setAuthError('Something went wrong finishing sign-in. Please try again.');
      setStep(isReturningUserFlow ? 'emailForm' : 'save');
    }
  }

  async function restorePendingAuth() {
    let draft: Awaited<ReturnType<typeof loadOnboardingDraft>> = null;
    try {
      draft = await loadOnboardingDraft();
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
        // Sign-in never completed (e.g. they cancelled, or the email hasn't been tapped yet) —
        // land back on their restored selections rather than making them search again.
        setStep(draft.candidates.length > 0 ? 'candidates' : 'identity');
      }
    } catch (err) {
      // Same safety-net reasoning as processAuthRedirect. Selections were already restored above
      // (or never existed), so falling back here never loses anything real.
      console.warn('[Onboarding] restorePendingAuth failed unexpectedly:', err);
      setStep(draft && draft.candidates.length > 0 ? 'candidates' : 'identity');
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
    if (existingAccountUserId) {
      void runImport(existingAccountUserId, racingName, birthYearHint, selectedCandidatesFromState(), selectedIdentity?.displayName);
    } else if (session) {
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
      isReturningUserSignIn: isReturningUserFlow,
      // Always read live off retryInsertRows (rather than only when non-empty) so a resume after
      // re-authentication never has to special-case whether an insert failure happened before the
      // session expired — see handleSignInAgain.
      rowsAlreadyFetched: retryInsertRows,
      // Set only during a session-expiry recovery (handleSignInAgain) — undefined for the
      // ordinary fresh-onboarding/returning-user-sign-in paths, where no account is signed in yet
      // when this draft is written, so there is nothing to bind to (unchanged from before this
      // field existed). See onboardingDraft.ts's originAthleteId doc.
      originAthleteId: reauthOriginAthleteId ?? undefined,
    });
  }

  /**
   * Native Apple / Google sign-in, offered beside the email option on the save step (new athletes) and
   * on the returning-user sign-in screen. The branching lives in lib/socialSignInFlow.ts (tested there).
   * Cancelling the provider sheet changes nothing and shows nothing. Magic-link and password sign-in
   * are untouched.
   */
  async function handleSocialSignIn(provider: SocialProvider) {
    if (isSocialSigningIn || simulateAuth) return;
    setAuthError(null);
    setSocialError(null);
    setSocialBusyProvider(provider);
    const outcome = await runSocialSignIn(provider, {
      isReturningUserFlow,
      persistDraft,
      signIn: signInWithProvider,
      resumeReturningUser,
      resumeFromDraftAndImport,
    });
    setSocialBusyProvider(null);
    if (outcome.kind === 'error') setSocialError({ provider, message: outcome.message });
  }

  async function handleSendMagicLink() {
    if (isSendingLink) return;
    setAuthError(null);
    setResendNotice(null);
    const trimmed = normalizeEmailInput(email);
    if (!trimmed) return;
    // B.14 — clear validation instead of silently sending an obviously-malformed address (e.g. a
    // pasted "mailto:" link whose prefix normalizeEmailInput doesn't recognize, or plain garbage)
    // and getting back a generic provider error with no useful explanation.
    if (!isPlausibleEmail(trimmed)) {
      setAuthError('Enter a valid email address.');
      return;
    }
    if (simulateAuth) {
      // Developer Preview: never touches Supabase Auth (and never persists a draft that a real,
      // later onboarding session could pick up) — jumps straight to the real "check your email"
      // screen composition, as if the send had succeeded, so it can be reviewed without spending a
      // real magic-link send/rate-limit attempt.
      setStep('checkEmail');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
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
    setResendNotice(null);
    if (simulateAuth) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setIsSendingLink(true);
    await persistDraft();
    const { error } = await requestMagicLink(normalizeEmailInput(email));
    setIsSendingLink(false);
    if (error) {
      setAuthError(error);
      return;
    }
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    // Requesting this new link has already overwritten the previous one's locally-stored PKCE
    // verifier (see lib/auth.tsx) — only the link this call just sent can still be exchanged.
    setResendNotice(RESEND_SUCCESS_MESSAGE);
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
    // Two overlapping runImport calls (e.g. a cold-start resume and the warm deep-link listener
    // both firing for the same completed sign-in, or a Retry tapped while a prior call is still
    // hung mid-fetch) could both reach insertConfirmedRaces and save the same races twice — nothing
    // in the insert path itself de-duplicates that. This guard makes overlap impossible: a second
    // call while one is already running is dropped rather than run concurrently.
    if (importInFlightRef.current) {
      console.warn('[Import] runImport called while an import is already in flight — ignoring this call.');
      return;
    }
    importInFlightRef.current = true;

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
    setImportOutcome(null);
    setAthleteIdForRetry(athleteId);
    setTotalSelectedForRun(totalSelected);

    try {
      await runImportBody(athleteId, name, birthYear, candidatesToFetch, totalSelected, providerAthleteName, rowsAlreadyFetched);
    } finally {
      importInFlightRef.current = false;
    }
  }

  async function runImportBody(
    athleteId: string,
    name: string,
    birthYear: string,
    candidatesToFetch: CandidateRace[],
    totalSelected: number,
    providerAthleteName: string | undefined,
    rowsAlreadyFetched: Record<string, unknown>[],
  ) {
    const normalizedName = normalizeNameForQuery(name);
    // An existing, already-onboarded account keeps its profile exactly as it is: only races are added.
    if (!existingAccountImportRef.current) {
      try {
        await upsertAthleteProfile(athleteId, normalizedName, birthYear.trim() ? Number(birthYear.trim()) : undefined);
        console.log('[Import] athlete_profiles upserted, racing_name=', JSON.stringify(normalizedName));
      } catch (err) {
        console.warn('[Import] athlete_profiles upsert FAILED (continuing — races can still save):', err);
      }
    }

    setImportProgress({ done: rowsAlreadyFetched.length, total: totalSelected });

    let newPodiums = 0;
    const { rows: fetchedRows, unavailable, failed, unattempted, stopReason } = await fetchCandidateDetails(
      candidatesToFetch,
      (candidate) => fetchRaceDetail(candidate.providerResultId, candidate.providerAthleteResultId, candidate.category),
      (candidate, detail) => {
        if (detail.ageGroupRank && detail.ageGroupRank.place <= 3) newPodiums += 1;
        return candidateDetailToInsertRow(athleteId, candidate, detail, providerAthleteName);
      },
      (done) => setImportProgress((current) => ({ ...current, done: rowsAlreadyFetched.length + done })),
    );
    const rows: Record<string, unknown>[] = [...rowsAlreadyFetched, ...fetchedRows];
    // `failed` (isolated network_error, still retryable) and `unattempted` (never tried because
    // the batch paused) are disjoint — both feed the same Retry action.
    const retryable = [...failed.map((f) => f.candidate), ...unattempted];

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
    setRetryFetchCandidates(retryable);

    const fullyDone = stillNeedsInsert.length === 0 && retryable.length === 0;

    if (fullyDone) {
      await clearOnboardingDraft();
      console.log('[Import] complete —', saved, 'of', totalSelected, 'saved, draft cleared.');
      // Reaching a fully-done state — whether zero races were ever selected, or every selected
      // race saved (possibly after one or more retries), or the remainder were only permanently
      // `unavailable` (never `unattempted`) — is what "onboarding genuinely completed" means. A
      // partial/failed state must NOT mark this: see handleEnterApp for the other way completion
      // can still happen (the athlete explicitly taps "Continue anyway").
      if (!existingAccountImportRef.current) {
        try {
          await markOnboardingComplete(athleteId);
        } catch (err) {
          console.warn('[Import] markOnboardingComplete failed (will re-check on next launch):', err);
        }
      }
    }

    setImportOutcome(
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
   * The `unauthorized` recovery action: the session used for the just-attempted detail fetches (or
   * insert) is no longer valid, so retrying with it would fail identically. Deliberately does NOT
   * route through the "already have an account? sign in" path (isReturningUserFlow) — that path's
   * resumeReturningUser() exists specifically to SKIP runImport (so a returning athlete's already-
   * saved profile is never overwritten by a blank fresh-onboarding-session's racingName/candidates)
   * — exactly the opposite of what's needed here, where finishing THIS interrupted import is the
   * whole point.
   *
   * Instead: narrows the flow's own candidates/selectedIds state down to exactly what's still
   * pending (retryFetchCandidates) — never re-selecting anything already saved — so the EXISTING
   * persistDraft()/resumeFromDraftAndImport machinery (built for resuming after a fresh sign-in)
   * carries this exact subset, plus any already-fetched-but-unsaved rows (via persistDraft's
   * rowsAlreadyFetched), through re-authentication with no new resume mechanism needed. Once they
   * sign in again, resumeFromDraftAndImport calls runImport with precisely this pending subset —
   * nothing already saved is re-fetched, re-inserted, or double-counted.
   */
  async function handleSignInAgain() {
    if (isSigningOutForReauth || !athleteIdForRetry) return;
    setIsSigningOutForReauth(true);
    // Captured NOW, while still authenticated — persistDraft() (called later, once they tap
    // "Send sign-in link") reads this to bind the draft to the account it actually belongs to.
    setReauthOriginAthleteId(athleteIdForRetry);
    setCandidates(retryFetchCandidates);
    setSelectedIds(new Set(retryFetchCandidates.map((c) => c.providerResultId)));
    try {
      await signOut();
    } catch (err) {
      console.warn('[Import] sign-out before re-auth failed:', err);
    }
    setIsSigningOutForReauth(false);
    setIsReturningUserFlow(false);
    setAuthError('Your session expired. Sign in again to finish adding your races.');
    setStep('emailForm');
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
    // An existing account's completion time is never rewritten.
    if (athleteIdForRetry && !existingAccountImportRef.current) {
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
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
        keyboardShouldPersistTaps="handled">
        {!isSupabaseConfigured ? (
          <View style={styles.centeredStep}>
            <Text style={styles.headline}>Supabase isn&apos;t configured yet.</Text>
            <Text style={styles.subcopy}>
              Copy mobile/.env.example to mobile/.env, fill in your project&apos;s URL and anon key,
              and restart the app — see supabase/README.md.
            </Text>
          </View>
        ) : step === 'restoring' ? (
          <View style={styles.centeredStep}>
            <ActivityIndicator size="large" color={palette.signalBlue} />
          </View>
        ) : (
          <>
            {/* Shown for the entire duration of a simulated replay — never confusable with a real
                auth test. Present above every step's content, not just CheckEmailStep, since
                handleSendMagicLink already fast-forwards straight past the emailForm step's own
                copy for the simulated case. */}
            {simulateAuth ? (
              <View style={styles.devPreviewBanner}>
                <Text style={styles.devPreviewBannerLabel}>
                  Developer Preview: simulated sign-in, no email sent
                </Text>
              </View>
            ) : null}

            {step === 'identity' ? (
              <IdentityStep
                racingName={racingName}
                onChangeRacingName={setRacingName}
                message={message}
                onContinue={runSearch}
                onSignIn={startReturningUserSignIn}
              />
            ) : null}

            {step === 'searching' ? (
              <View style={styles.centeredStep}>
                <ActivityIndicator size="large" color={palette.signalBlue} />
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
                onSkip={existingAccountUserId ? skipReviewForExistingAccount : skipDiscovery}
                onBack={existingAccountUserId ? () => setStep('existingAccount') : backFromCandidates}
                onSearchAgain={backToIdentity}
                reviewMode={existingAccountUserId !== null}
              />
            ) : null}

            {step === 'existingAccount' ? (
              <ExistingAccountStep
                pendingCount={selectedCount}
                onReview={reviewSelectedRacesForExistingAccount}
                onSkip={skipReviewForExistingAccount}
              />
            ) : null}

            {step === 'save' || step === 'emailForm' ? (
              <EmailFormStep
                email={email}
                onChangeEmail={setEmail}
                error={authError}
                isReturningUser={isReturningUserFlow}
                onSocialSignIn={handleSocialSignIn}
                socialBusyProvider={socialBusyProvider}
                socialErrors={socialError ? ({ [socialError.provider]: socialError.message } as ProviderErrors) : undefined}
                selectedCount={selectedCount}
                isSending={isSendingLink}
                onSendLink={handleSendMagicLink}
                onSignInWithPassword={handlePasswordSignIn}
                onBack={() => {
                  setAuthError(null);
                  setSocialError(null);
                  if (isReturningUserFlow) {
                    setIsReturningUserFlow(false);
                    setStep('identity');
                  } else {
                    setStep('candidates');
                  }
                }}
              />
            ) : null}

            {step === 'checkEmail' ? (
              <CheckEmailStep
                email={email}
                error={authError}
                notice={resendNotice}
                resendCooldown={resendCooldown}
                isSending={isSendingLink}
                onResend={handleResendMagicLink}
                onChangeEmail={() => {
                  setAuthError(null);
                  setStep('emailForm');
                }}
                onBack={() => {
                  setAuthError(null);
                  if (isReturningUserFlow) {
                    setIsReturningUserFlow(false);
                    setStep('identity');
                  } else {
                    setStep('save');
                  }
                }}
                simulateAuth={simulateAuth}
                onSimulatedComplete={onSimulatedComplete}
              />
            ) : null}

            {step === 'importing' ? (
              <View style={styles.centeredStep}>
                <ActivityIndicator size="large" color={palette.signalBlue} />
                <Text style={styles.subcopy}>
                  {importProgress.total > 0
                    ? `Loading race results… ${importProgress.done + 1} of ${importProgress.total}`
                    : 'Saving your race history…'}
                </Text>
              </View>
            ) : null}

            {step === 'summary' ? (
              <SummaryStep
                imported={importedCount}
                podiums={podiumCount}
                yearRange={importedYearRange}
                error={importOutcome?.text ?? null}
                canRetry={canRetryImport}
                isRetrying={isRetrying}
                onRetry={handleRetryImport}
                canSignInAgain={canSignInAgain}
                isSigningOutForReauth={isSigningOutForReauth}
                onSignInAgain={handleSignInAgain}
                onEnterApp={handleEnterApp}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * "Find your race history" — the flow's front door. A subtle brand cue and a very-low-opacity
 * RaceLineMotif sit behind the headline (the only screen in this flow that gets the motif — it
 * reads as atmosphere on the opening moment, not a repeated decoration), one strong editorial
 * headline, the racing-name field in the shared quiet form language, a single signalBlue primary
 * action, and "Already have an account?" as a quiet secondary text action beneath it.
 */
function IdentityStep({
  racingName,
  onChangeRacingName,
  message,
  onContinue,
  onSignIn,
}: {
  racingName: string;
  onChangeRacingName: (value: string) => void;
  message: string | null;
  onContinue: () => void;
  onSignIn: () => void;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const disabled = racingName.trim().length === 0;
  // A pure function — safe to call directly with no provider required, so this entry point can
  // decide whether to render at all before ever touching DevPreviewContext. Always false (and
  // therefore this whole link never renders) in any release/TestFlight build.
  const devPreviewAvailable = isDevPreviewAvailable();
  const devPreview = useDevPreview();

  function showDevPreviewChoice() {
    Alert.alert('Developer preview', 'Design QA without real Supabase auth/email.', [
      { text: 'Browse app with sample data', onPress: () => devPreview.enterBrowse() },
      { text: 'Replay onboarding (simulated)', onPress: () => devPreview.enterOnboardingReplay() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.stepGap}>
      <View style={styles.heroMotifWrap}>
        <RaceLineMotif tintColor={palette.ink} opacity={0.04} style={{ left: '30%' }} />
        <View style={styles.brandMarkWrap}>
          <SignalMark color={palette.signalBlue} size={20} />
        </View>
        <Text style={styles.headline}>Let&apos;s find your race history.</Text>
        <Text style={styles.subcopy}>Just your racing name to start. We&apos;ll search before you sign in.</Text>
      </View>

      <Field label="What name do you race under?" value={racingName} onChangeText={onChangeRacingName} />

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable
        onPress={onContinue}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Search"
        style={[styles.primaryButton, disabled && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>Search</Text>
      </Pressable>

      <View style={styles.secondaryActionsGroup}>
        <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Already have an account? Sign in">
          <Text style={styles.secondaryLink}>Already have an account? Sign in</Text>
        </Pressable>

        {devPreviewAvailable ? (
          <Pressable onPress={showDevPreviewChoice} accessibilityRole="button" accessibilityLabel="Developer preview">
            <Text style={styles.devPreviewEntryLink}>Developer preview</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Multiple athlete matches — the explanatory copy and optional hint fields stay exactly as they
 * were; each candidate is now a clean editorial row (name + trailing chevron, hairline divider
 * between rows) rather than a rounded rectangular card, matching the archive-row language used
 * elsewhere in the app.
 */
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
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.stepGap}>
      <Text style={styles.headline}>We found more than one athlete named {name}.</Text>
      <Text style={styles.subcopy}>
        A race you remember, or your birth year, can help you tell them apart below. We don&apos;t use
        these to search, just as a hint for you.
      </Text>

      <Field label="A race you remember (optional)" value={knownRaceHint} onChangeText={onChangeKnownRaceHint} />
      <Field
        label="Birth year (optional)"
        value={birthYearHint}
        onChangeText={onChangeBirthYearHint}
        keyboardType="number-pad"
      />

      <View style={styles.rowsGroup}>
        <HairlineRule color={palette.hairline} />
        {identities.map((identity, index) => (
          <Pressable
            key={identity.providerAthleteId}
            onPress={() => onSelect(identity)}
            accessibilityRole="button"
            accessibilityLabel={`This is me: ${identity.displayName}`}
            style={[styles.identityRow, index < identities.length - 1 && styles.rowDivider]}>
            <Text style={styles.identityName}>{identity.displayName}</Text>
            <AppIcon name="chevron-right" size={18} color={palette.inkSecondary} />
          </Pressable>
        ))}
      </View>

      <View style={styles.secondaryActionsGroup}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.secondaryLink}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface CandidateYearGroup {
  year: number;
  items: CandidateRace[];
}

/** Groups the already-fetched candidate list by year for DISPLAY only — the same shape the Races
 *  tab's own year sections use (see (tabs)/index.tsx's groupCompletedRacesByYear) — purely a
 *  presentational grouping; it never touches fetching, selection state, or ordering of
 *  `selectedIds`. */
function groupCandidatesByYear(list: CandidateRace[]): CandidateYearGroup[] {
  const byYear = new Map<number, CandidateRace[]>();
  for (const candidate of list) {
    const bucket = byYear.get(candidate.eventYear);
    if (bucket) bucket.push(candidate);
    else byYear.set(candidate.eventYear, [candidate]);
  }
  return Array.from(byYear.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, items]) => ({ year, items }));
}

/**
 * "We found N races" — the genuinely satisfying moment: RaceSignal recovered the athlete's racing
 * history. Checkbox state/toggle behavior is untouched; candidates are grouped by year (display
 * only) and each row reuses RaceRow.tsx's own date-block/name/meta styling so a race here reads as
 * the same kind of object it will once it lands on the Races tab.
 */
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
  reviewMode = false,
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
  /** Reviewing the selections kept for an account that already exists: different copy, no "Search again". */
  reviewMode?: boolean;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const selectedCount = selectedIds.size;
  const groups = useMemo(() => groupCandidatesByYear(candidates), [candidates]);
  // This is the flow's one long, scrollable step — its primary action and trailing secondary
  // links need real clearance from the home indicator, not just the shared ScrollView's fixed
  // bottom padding.
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.stepGap}>
      <Text style={styles.headline}>
        {reviewMode ? 'Review your selected races' : `We found ${candidates.length} race${candidates.length === 1 ? '' : 's'}`}
      </Text>
      <Text style={styles.subcopy}>
        {reviewMode
          ? 'Races already in your history are marked and can’t be added twice. Nothing about your profile or existing races changes.'
          : `Select the ones that are you, ${athleteName}. Nothing unselected is imported. You can always add more later.`}
      </Text>

      {candidates.length === 0 ? (
        <View style={styles.emptyBlock}>
          <HairlineRule color={palette.hairline} />
          <Text style={[styles.subcopy, styles.emptyText]}>No public race history found for that profile.</Text>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.year} style={styles.candidateYearGroup}>
            <Text style={styles.yearHeader}>{group.year}</Text>
            <HairlineRule color={palette.hairline} />
            {group.items.map((candidate, index) => (
              <CandidateRow
                key={candidate.providerResultId}
                candidate={candidate}
                selected={selectedIds.has(candidate.providerResultId)}
                alreadyImported={alreadyImportedIds.has(candidate.providerResultId)}
                onToggle={onToggle}
                isLast={index === group.items.length - 1}
                palette={palette}
                styles={styles}
              />
            ))}
          </View>
        ))
      )}

      <Pressable
        onPress={onContinue}
        disabled={selectedCount === 0}
        accessibilityRole="button"
        accessibilityLabel={`Add ${selectedCount} races`}
        style={[styles.primaryButton, selectedCount === 0 && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>Add {selectedCount} race{selectedCount === 1 ? '' : 's'}</Text>
      </Pressable>

      <View style={[styles.secondaryActionsGroup, { paddingBottom: insets.bottom }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.secondaryLink}>Back</Text>
        </Pressable>

        {reviewMode ? null : (
          <Pressable onPress={onSearchAgain} accessibilityRole="button" accessibilityLabel="Search again">
            <Text style={styles.secondaryLink}>Search again</Text>
          </Pressable>
        )}

        <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel={reviewMode ? 'Skip' : 'Continue without importing'}>
          <Text style={styles.secondaryLink}>{reviewMode ? 'Skip' : 'Continue without importing'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A single discovered race, styled to match RaceRow.tsx's own date-block/name/meta values
 *  exactly (same font sizes, weights and colors) so it reads as the same kind of object it will
 *  once it lands on the Races tab. The checkbox itself keeps its exact toggle/disabled behavior —
 *  only its fill/border colors are restyled, matching RacePrepChecklist's checkbox language. */
function CandidateRow({
  candidate,
  selected,
  alreadyImported,
  onToggle,
  isLast,
  palette,
  styles,
}: {
  candidate: CandidateRace;
  selected: boolean;
  alreadyImported: boolean;
  onToggle: (id: string) => void;
  isLast: boolean;
  palette: BrandPalette;
  styles: Styles;
}) {
  const dateDisplay = candidate.eventDate
    ? formatRaceDate(candidate.eventDate)
    : ({ precision: 'year' as const, year: String(candidate.eventYear) });
  const metaLine = alreadyImported ? `${candidate.category} · Already added` : candidate.category;

  return (
    <Pressable
      onPress={() => onToggle(candidate.providerResultId)}
      disabled={alreadyImported}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: alreadyImported }}
      accessibilityLabel={`${candidate.eventName}, ${candidate.eventYear}${alreadyImported ? ', already added' : ''}`}
      style={[styles.candidateRow, !isLast && styles.rowDivider, alreadyImported && styles.candidateRowDisabled]}>
      <View style={styles.checkboxSlot}>
        {alreadyImported ? (
          <AppIcon name="check-circle" size={20} color={palette.inkSecondary} />
        ) : (
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            {selected ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
        )}
      </View>
      <View style={styles.candidateDateBlock}>
        {dateDisplay.precision === 'year' ? (
          <Text style={styles.candidateDateYear}>{dateDisplay.year}</Text>
        ) : (
          <>
            <Text style={styles.candidateDateMonth}>{dateDisplay.month}</Text>
            <Text style={styles.candidateDateDay}>{dateDisplay.day}</Text>
          </>
        )}
      </View>
      <View style={styles.candidateDetails}>
        <Text style={styles.candidateName} numberOfLines={1}>
          {candidate.eventName}
        </Text>
        <Text style={styles.candidateMeta} numberOfLines={1}>
          {metaLine}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The auth-choice screen. Google sign-in is hidden for now (P1-6) — it isn't configured yet and
 * would just be a broken action; only the email path is offered until that's revisited ahead of
 * App Store release. `handleGoogleSignIn` and the Google UI remain in this file, just unrendered,
 * so re-enabling later is a small diff rather than rebuilding the flow.
 *
 * This and every other auth state below (EmailFormStep, CheckEmailStep) share one composition: a
 * subtle brand cue, a strong state-specific headline, concise copy, the input/action where needed,
 * and a quiet text-link Back — never a second, differently-styled "auth design system."
 */
/**
 * The athlete signed in to an account that already exists and still had race selections pending from this
 * onboarding. Nothing is imported until they choose: reviewing leads to the normal race list (already-added
 * races marked), skipping goes straight to the app. Either way the existing profile is left as it is.
 */
function ExistingAccountStep({ pendingCount, onReview, onSkip }: { pendingCount: number; onReview: () => void; onSkip: () => void }) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.stepGap}>
      <View style={styles.brandMarkWrap}>
        <SignalMark color={palette.signalBlue} size={20} />
      </View>
      <Text style={styles.headline}>Welcome back.</Text>
      <Text style={styles.subcopy}>
        You already have a RaceSignal account. You had selected {pendingCount} race{pendingCount === 1 ? '' : 's'} that
        {pendingCount === 1 ? ' isn’t' : ' aren’t'} in your history yet. Review {pendingCount === 1 ? 'it' : 'them'} to add{' '}
        {pendingCount === 1 ? 'it' : 'any you want'}, or skip. Your profile stays exactly as it is.
      </Text>

      <Pressable onPress={onReview} accessibilityRole="button" accessibilityLabel="Review selected races" style={styles.primaryButton}>
        <Text style={styles.primaryButtonLabel}>Review selected races</Text>
      </Pressable>

      <View style={styles.secondaryActionsGroup}>
        <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="Skip">
          <Text style={styles.secondaryLink}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * B.13 fix: this used to render BOTH the magic-link section AND (once revealed) the password
 * section at the same time — two same-looking primary buttons on screen together ("Send sign-in
 * link" and "Sign in"), which is the confirmed, reproduced cause of the Build 12 device report
 * ("tapping Sign in appeared to do nothing"): the password field/button were real and correctly
 * wired (see EmailFormStep.test.tsx, which drives the actual rendered password field end to end
 * and confirms typed text reaches state, the button calls onSignInWithPassword, and both a
 * validation message and a server error render visibly) — the coexisting magic-link button was
 * the likely mis-tap target, not a hidden wiring bug. Fixed by making the two modes mutually
 * exclusive: exactly one heading, one set of fields, and one primary button on screen at a time.
 *
 * Also fixed: the old version disabled the Sign-in button outright when a field was empty, which
 * is functionally correct but reads as "nothing happened" on tap (a disabled Pressable is a
 * silent no-op). The button is never disabled for empty fields now — pressing it always responds,
 * either with a clear "enter both fields" message or with the real sign-in attempt.
 */
export function EmailFormStep({
  email,
  onChangeEmail,
  error,
  isReturningUser = false,
  onSocialSignIn,
  socialBusyProvider = null,
  socialErrors,
  selectedCount,
  isSending,
  onSendLink,
  onSignInWithPassword,
  onBack,
}: {
  email: string;
  onChangeEmail: (value: string) => void;
  /** Email-form errors only (sending the link). Provider failures go in `socialErrors`, under their buttons. */
  error: string | null;
  /** True for "Already have an account? Sign in" ("Welcome back."); false while saving pending onboarding results. */
  isReturningUser?: boolean;
  /** Optional so existing usages and tests are unchanged: without it no provider buttons render. */
  onSocialSignIn?: (provider: SocialProvider) => void;
  socialBusyProvider?: SocialProvider | null;
  socialErrors?: ProviderErrors;
  selectedCount: number;
  isSending: boolean;
  onSendLink: () => void;
  onSignInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  onBack: () => void;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [mode, setMode] = useState<'magicLink' | 'password'>('magicLink');
  const [password, setPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Kept separate from the magic-link `error` prop deliberately — switching modes never carries a
  // stale error from the other mode along with it (see the mode-switch handlers below, which clear
  // this), and a missing-field message is visually identical to (but logically distinct from) a
  // real server error.
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  function switchToPasswordMode() {
    setMode('password');
    setPasswordMessage(null);
  }

  function switchToMagicLinkMode() {
    setMode('magicLink');
    setPasswordMessage(null);
  }

  async function handlePasswordSignIn() {
    if (isSigningIn) return;
    const trimmedEmail = email.trim();
    // Active validation, not a silently disabled button — every tap gets a visible response.
    if (!trimmedEmail || !password) {
      setPasswordMessage('Enter your email and password to continue.');
      return;
    }
    setPasswordMessage(null);
    setIsSigningIn(true);
    const { error: signInError } = await onSignInWithPassword(trimmedEmail, password);
    setIsSigningIn(false);
    // Never logs `password` itself — only the boolean outcome and Supabase's own message (see
    // auth.tsx's signInWithPassword, which likewise never logs the raw password).
    if (signInError) setPasswordMessage(signInError);
  }

  const magicLinkDisabled = email.trim().length === 0 || isSending;

  if (mode === 'password') {
    return (
      <View style={styles.stepGap}>
        <View style={styles.brandMarkWrap}>
          <SignalMark color={palette.signalBlue} size={20} />
        </View>
        <Text style={styles.headline}>Enter your email and password.</Text>

        <Field
          label="Email"
          placeholder="Email address"
          boxed
          value={email}
          onChangeText={onChangeEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field label="Password" placeholder="Password" boxed value={password} onChangeText={setPassword} secureTextEntry />

        {passwordMessage ? <Text style={styles.message}>{passwordMessage}</Text> : null}

        <Pressable
          onPress={handlePasswordSignIn}
          disabled={isSigningIn}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          style={[styles.primaryButton, isSigningIn && styles.primaryButtonDisabled]}>
          {isSigningIn ? <ActivityIndicator color={palette.onSignalBlue} /> : <Text style={styles.primaryButtonLabel}>Sign in</Text>}
        </Pressable>

        <View style={styles.secondaryActionsGroup}>
          <Pressable onPress={switchToMagicLinkMode} accessibilityRole="button" accessibilityLabel="Use a sign-in link instead">
            <Text style={styles.secondaryLink}>Use a sign-in link instead</Text>
          </Pressable>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.secondaryLink}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stepGap}>
      <View style={styles.brandMarkWrap}>
        <SignalMark color={palette.signalBlue} size={20} />
      </View>
      <Text style={styles.headline}>
        {isReturningUser
          ? 'Welcome back.'
          : `Sign in to save ${selectedCount > 0 ? `${selectedCount} race${selectedCount === 1 ? '' : 's'}` : 'your history'}.`}
      </Text>
      <Text style={styles.subcopy}>Keep your race history in one place.</Text>

      {onSocialSignIn ? <SocialSignInButtons onPress={onSocialSignIn} busyProvider={socialBusyProvider} errors={socialErrors} /> : null}

      <Field
        label="Email"
        placeholder="Email address"
        boxed
        value={email}
        onChangeText={onChangeEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        returnKeyType="send"
        onSubmitEditing={magicLinkDisabled ? undefined : onSendLink}
      />

      {error ? <Text style={styles.message}>{error}</Text> : null}

      <Pressable
        onPress={onSendLink}
        disabled={magicLinkDisabled}
        accessibilityRole="button"
        accessibilityLabel="Send sign-in link"
        accessibilityState={{ disabled: magicLinkDisabled, busy: isSending }}
        style={[styles.primaryButton, magicLinkDisabled && styles.primaryButtonDisabled]}>
        <Text style={styles.primaryButtonLabel}>{isSending ? 'Sending…' : 'Send sign-in link'}</Text>
      </Pressable>

      <View style={styles.secondaryActionsGroup}>
        <Pressable onPress={switchToPasswordMode} accessibilityRole="button" accessibilityLabel="Sign in with email and password">
          <Text style={styles.secondaryLink}>Sign in with email and password</Text>
        </Pressable>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.secondaryLink}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CheckEmailStep({
  email,
  error,
  notice,
  resendCooldown,
  isSending,
  onResend,
  onChangeEmail,
  onBack,
  simulateAuth,
  onSimulatedComplete,
}: {
  email: string;
  error: string | null;
  /** Set only right after a successful resend — see RESEND_SUCCESS_MESSAGE. Never shown alongside
   *  `error`: every path that sets one clears the other. */
  notice: string | null;
  resendCooldown: number;
  isSending: boolean;
  onResend: () => void;
  onChangeEmail: () => void;
  onBack: () => void;
  simulateAuth?: boolean;
  onSimulatedComplete?: () => void;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const resendDisabled = resendCooldown > 0 || isSending;

  return (
    <View style={styles.stepGap}>
      <View style={styles.brandMarkWrap}>
        <SignalMark color={palette.signalBlue} size={20} />
      </View>
      <Text style={styles.headline}>Check your email</Text>
      <Text style={styles.subcopy}>
        We sent a sign-in link to {email}. Tap it on this phone to come back here automatically.
      </Text>

      {error ? <Text style={styles.message}>{error}</Text> : notice ? <Text style={styles.notice}>{notice}</Text> : null}

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

      {/* Dev-only affordance, styled distinctly (dashed hairline, warning-toned label) so it never
          reads as a real action — tapping it never calls completeAuthFromUrl/resumeFromDraftAndImport/
          runImport; it only hands off to the caller's onSimulatedComplete (see _layout.tsx). */}
      {simulateAuth ? (
        <Pressable
          onPress={onSimulatedComplete}
          accessibilityRole="button"
          accessibilityLabel="Simulate tapping the magic link (Developer Preview)"
          style={styles.simulateLinkButton}>
          <Text style={styles.simulateLinkButtonLabel}>Simulate tapping the magic link (Developer Preview)</Text>
        </Pressable>
      ) : null}

      <View style={styles.secondaryActionsGroup}>
        <Pressable onPress={onChangeEmail} accessibilityRole="button" accessibilityLabel="Use a different email">
          <Text style={styles.secondaryLink}>Use a different email</Text>
        </Pressable>

        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.secondaryLink}>Back</Text>
        </Pressable>
      </View>
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
  canSignInAgain,
  isSigningOutForReauth,
  onSignInAgain,
  onEnterApp,
}: {
  imported: number;
  podiums: number;
  yearRange: { min: number; max: number } | null;
  error: string | null;
  canRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  canSignInAgain: boolean;
  isSigningOutForReauth: boolean;
  onSignInAgain: () => void;
  onEnterApp: () => void;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fade]);

  const yearLabel = yearRange ? (yearRange.min === yearRange.max ? `${yearRange.min}` : `${yearRange.min} → ${yearRange.max}`) : null;

  return (
    <Animated.View style={[styles.summaryStep, { opacity: fade }]}>
      <SignalMark color={palette.signalBlue} size={22} />
      <Text style={styles.headline}>
        {imported > 0 ? `We found ${imported} race${imported === 1 ? '' : 's'}` : "You're all set."}
      </Text>
      {/* A restrained "you found something real" accent — tied to the same imported>0 condition
          already driving this branch. Deliberately signalBlue, not gold: nothing here is an
          earned achievement (no PR/podium check), it's simply "we found your racing history." */}
      {imported > 0 ? <View style={styles.accentRule} /> : null}
      {yearLabel ? <Text style={styles.yearRange}>{yearLabel}</Text> : null}
      {error ? <Text style={styles.message}>{error}</Text> : null}
      {imported > 0 ? (
        <View style={styles.summaryGrid}>
          <SummaryStat label="Races added" value={imported} styles={styles} />
          <SummaryStat label="AG podiums" value={podiums} styles={styles} />
        </View>
      ) : !error ? (
        <Text style={styles.subcopy}>
          Nothing imported yet. You can search again or add races manually anytime from Races or
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

      {canSignInAgain ? (
        <Pressable
          onPress={onSignInAgain}
          disabled={isSigningOutForReauth}
          accessibilityRole="button"
          accessibilityLabel="Sign in again"
          style={[styles.primaryButton, isSigningOutForReauth && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonLabel}>{isSigningOutForReauth ? 'Signing out…' : 'Sign in again'}</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onEnterApp}
        accessibilityRole="button"
        accessibilityLabel="Explore my racing history"
        style={canRetry || canSignInAgain ? styles.secondaryButton : styles.primaryButton}>
        <Text style={canRetry || canSignInAgain ? styles.secondaryButtonLabel : styles.primaryButtonLabel}>
          {canRetry || canSignInAgain ? 'Continue anyway' : imported > 0 ? 'Explore my racing history' : 'Enter app'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function SummaryStat({ label, value, styles }: { label: string; value: number; styles: Styles }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

/**
 * Shared refined form-field language for this whole flow: a non-shouting normal-case label in
 * inkSecondary, and a hairline-bottom-border input rather than a heavy full outline box — the same
 * "Race Morning Precision" form philosophy as the Add Race screen's own redesign elsewhere in this
 * pass.
 */
function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  placeholder,
  boxed = false,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
  secureTextEntry?: boolean;
  placeholder?: string;
  /** The sign-in screen's visible field: 52pt high, 14pt radius, subtle border, placeholder instead of a label.
   *  Every other screen keeps the original underlined field. The label stays as the accessibility label. */
  boxed?: boolean;
  returnKeyType?: 'send' | 'done' | 'next';
  onSubmitEditing?: () => void;
}) {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.fieldWrap}>
      {boxed ? null : <Text style={styles.fieldLabel}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkSecondary}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={keyboardType === 'email-address' ? false : undefined}
        autoComplete={keyboardType === 'email-address' ? 'email' : secureTextEntry ? 'current-password' : undefined}
        textContentType={keyboardType === 'email-address' ? 'emailAddress' : secureTextEntry ? 'password' : undefined}
        secureTextEntry={secureTextEntry}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        style={boxed ? styles.inputBoxed : styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  stepGap: ViewStyle;
  centeredStep: ViewStyle;
  summaryStep: ViewStyle;
  heroMotifWrap: ViewStyle;
  brandMarkWrap: ViewStyle;
  headline: TextStyle;
  subcopy: TextStyle;
  message: TextStyle;
  notice: TextStyle;
  fieldWrap: ViewStyle;
  fieldLabel: TextStyle;
  input: TextStyle & ViewStyle;
  inputBoxed: TextStyle & ViewStyle;
  primaryButton: ViewStyle;
  primaryButtonDisabled: ViewStyle;
  primaryButtonLabel: TextStyle;
  secondaryButton: ViewStyle;
  secondaryButtonLabel: TextStyle;
  secondaryLink: TextStyle;
  secondaryActionsGroup: ViewStyle;
  devPreviewEntryLink: TextStyle;
  devPreviewBanner: ViewStyle;
  devPreviewBannerLabel: TextStyle;
  simulateLinkButton: ViewStyle;
  simulateLinkButtonLabel: TextStyle;
  rowsGroup: ViewStyle;
  rowDivider: ViewStyle;
  identityRow: ViewStyle;
  identityName: TextStyle;
  candidateYearGroup: ViewStyle;
  yearHeader: TextStyle;
  candidateRow: ViewStyle;
  candidateRowDisabled: ViewStyle;
  checkboxSlot: ViewStyle;
  checkbox: ViewStyle;
  checkboxChecked: ViewStyle;
  checkmark: TextStyle;
  candidateDateBlock: ViewStyle;
  candidateDateMonth: TextStyle;
  candidateDateDay: TextStyle;
  candidateDateYear: TextStyle;
  candidateDetails: ViewStyle;
  candidateName: TextStyle;
  candidateMeta: TextStyle;
  emptyBlock: ViewStyle;
  emptyText: TextStyle;
  summaryGrid: ViewStyle;
  summaryStat: ViewStyle;
  summaryValue: TextStyle;
  summaryLabel: TextStyle;
  accentRule: ViewStyle;
  yearRange: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      flexGrow: 1,
      padding: spacing.lg,
      // paddingTop is set inline per-render (insets.top + a fixed gap) — there's no native header
      // reserving space above this shared ScrollView, so every step must clear the status bar
      // itself. Deliberately NOT justifyContent: 'center' here: that centered every step's content
      // vertically regardless of length, which read as arbitrary placement on short steps (a
      // headline + one field + a button, floating in the middle of the screen). Steps now flow
      // top-anchored instead, matching results/[id].tsx and the rest of the redesigned app.
      gap: spacing.lg,
    },
    stepGap: {
      gap: spacing.lg,
    },
    // Transient loading/spinner-only states ONLY (restoring, searching, importing, and the
    // Supabase-not-configured message) — vertically centered because there's nothing to anchor to
    // and the state is momentary. Real content states never use this (see summaryStep below).
    centeredStep: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.xxl,
    },
    // Summary is a real, top-anchored content state like every other step (same rhythm as
    // stepGap) — its icon/headline/stats stay horizontally centered for the celebratory look, but
    // it no longer floats vertically mid-screen the way the transient centeredStep states do.
    summaryStep: {
      alignItems: 'center',
      gap: spacing.lg,
    },
    heroMotifWrap: {
      position: 'relative',
      overflow: 'hidden',
      // Matches stepGap's own sibling gap so the headline-to-subcopy rhythm here is identical to
      // every other short state (Save/EmailForm/CheckEmail/Summary) — this previously used a
      // tighter spacing.sm, which made Identity's headline sit noticeably closer to its subcopy
      // than everywhere else in the flow.
      gap: spacing.lg,
      paddingVertical: spacing.xs,
    },
    brandMarkWrap: {
      marginBottom: spacing.xs,
    },
    headline: {
      fontSize: 28,
      fontWeight: '700',
      color: palette.ink,
    },
    subcopy: {
      fontSize: 16,
      lineHeight: 22,
      color: palette.inkSecondary,
    },
    message: {
      fontSize: 14,
      color: palette.danger,
    },
    notice: {
      fontSize: 14,
      color: palette.inkSecondary,
    },
    fieldWrap: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
    input: {
      minHeight: minTouchSize,
      borderBottomWidth: 1,
      borderBottomColor: palette.hairline,
      paddingVertical: spacing.sm,
      fontSize: 17,
      color: palette.ink,
      backgroundColor: 'transparent',
    },
    // The sign-in screen's field: a quiet outlined box instead of a nearly invisible underline.
    inputBoxed: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.hairline,
      paddingHorizontal: spacing.lg,
      fontSize: 17,
      color: palette.ink,
      backgroundColor: 'transparent',
    },
    primaryButton: {
      alignSelf: 'stretch',
      minHeight: minTouchSize + 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      paddingHorizontal: spacing.lg,
      backgroundColor: palette.signalBlue,
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
      minHeight: minTouchSize + 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      paddingHorizontal: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
    },
    secondaryButtonLabel: {
      color: palette.signalBlue,
      fontWeight: '700',
      fontSize: 16,
    },
    secondaryLink: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.signalBlue,
      textAlign: 'center',
      minHeight: 44,
      textAlignVertical: 'center',
    },
    // Groups a step's quiet secondary actions (Back, "Search again," "Continue without
    // importing," etc.) into one visually distinct cluster directly beneath the primary action —
    // the same relative position across every step — with a tighter internal gap than the
    // stepGap spacing used between the primary action and headline/content above it.
    secondaryActionsGroup: {
      gap: spacing.xs,
    },
    // Deliberately quieter/smaller than secondaryLink — a tertiary, dev-only action that must
    // never compete visually with "Already have an account? Sign in" above it.
    devPreviewEntryLink: {
      fontSize: 12,
      fontWeight: '500',
      color: palette.inkSecondary,
      textAlign: 'center',
      minHeight: 32,
      textAlignVertical: 'center',
    },
    // A quiet kicker-style banner shown for the whole duration of a simulated onboarding replay —
    // never confusable with a real auth test.
    devPreviewBanner: {
      paddingVertical: spacing.xs,
    },
    devPreviewBannerLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: palette.danger,
    },
    // A dashed hairline sets this dev-only action apart from every real primary/secondary action
    // in this flow, which all use solid fills or plain text links.
    simulateLinkButton: {
      alignSelf: 'stretch',
      minHeight: minTouchSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      paddingHorizontal: spacing.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: palette.danger,
    },
    simulateLinkButtonLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.danger,
      textAlign: 'center',
    },
    rowsGroup: {
      gap: 0,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.hairline,
    },
    identityRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    identityName: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.ink,
    },
    candidateYearGroup: {
      gap: 0,
      marginTop: spacing.xxl + spacing.sm,
    },
    yearHeader: {
      fontSize: 32,
      fontWeight: '800',
      color: palette.ink,
      marginBottom: spacing.md,
      ...tabularNumerals,
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    candidateRowDisabled: {
      opacity: 0.6,
    },
    checkboxSlot: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: palette.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: palette.signalBlue,
      borderColor: palette.signalBlue,
    },
    checkmark: {
      color: palette.onSignalBlue,
      fontSize: 14,
      fontWeight: '700',
    },
    candidateDateBlock: {
      width: 44,
      alignItems: 'center',
    },
    candidateDateMonth: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.inkSecondary,
    },
    candidateDateDay: {
      fontSize: 22,
      fontWeight: '700',
      color: palette.ink,
      ...tabularNumerals,
    },
    candidateDateYear: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.ink,
      ...tabularNumerals,
    },
    candidateDetails: {
      flex: 1,
      gap: 2,
    },
    candidateName: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.ink,
    },
    candidateMeta: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
    emptyBlock: {
      gap: spacing.sm,
    },
    emptyText: {
      marginTop: spacing.sm,
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
      color: palette.ink,
      ...tabularNumerals,
    },
    summaryLabel: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    accentRule: {
      width: 48,
      height: 3,
      borderRadius: 2,
      backgroundColor: palette.signalBlue,
    },
    yearRange: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.inkSecondary,
      ...tabularNumerals,
    },
  });
}
