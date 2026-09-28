import type { CandidateRace, DiscoveryResult, RaceDetailPayload, UnavailableReason } from '@/lib/raceDiscovery';

/**
 * Shared, testable import-resilience core used by BOTH OnboardingFlow and FindMyRacesFlow (Build
 * 11 fix) — before this, each screen had its own copy of the same loop, and BOTH had the same
 * defect: the very first candidate whose detail fetch failed for ANY reason aborted the entire
 * remaining batch, discarding every later candidate regardless of whether ITS detail fetch would
 * have succeeded. Confirmed root cause of the reported "13 found, 0 saved" incident: the first
 * candidate (sorted newest-first) was an upcoming/registered event with no result yet — Sportstats'
 * athlete-history page can include future registrations alongside past results, and nothing in the
 * raw candidate list distinguishes them — so `detail` correctly returned `not_found` for it, and
 * the old all-or-nothing loop then discarded the other 12 valid, already-completed races too.
 */

/** Genuinely provider-/session-wide conditions where every remaining candidate would fail
 *  identically right now — the batch pauses here rather than continuing to hit the provider. */
export type BatchStopReason = 'unauthorized' | 'rate_limited' | 'disabled' | 'provider_blocked';

export interface CandidateUnavailable {
  candidate: CandidateRace;
  reason: UnavailableReason;
}

export interface FetchCandidateDetailsResult {
  /** Rows ready for insertConfirmedRaces, in candidate order. */
  rows: Record<string, unknown>[];
  /** Per-candidate, PERMANENT, skip-and-continue failures — retrying these specific candidates
   *  again would fail identically (the provider has no result for them, or the response was
   *  malformed) — never included in `failed` or `unattempted`. IMPORTANT: `not_found` alone does
   *  NOT establish *why* a result is missing (it could be an upcoming/not-yet-run race, a
   *  provider-side data gap, or something else) — never assert a specific cause from this reason
   *  code alone; describeImportOutcome's copy stays deliberately non-committal about cause. */
  unavailable: CandidateUnavailable[];
  /** Per-candidate `network_error` that didn't resolve even after the one bounded automatic
   *  retry inside this call — distinct from `unavailable`: this is NOT a permanent condition,
   *  just a transient one that happened to fail twice in a row. Retrying these specific
   *  candidates again (a fresh network attempt, potentially after connectivity recovers) can
   *  still succeed, so they're surfaced as retryable, same as `unattempted`. */
  failed: CandidateUnavailable[];
  /** Candidates never attempted because the batch stopped early — these ARE retryable once
   *  `stopReason`'s underlying condition is resolved (re-authenticating, waiting out a rate
   *  limit). Empty when every candidate was attempted, whether it succeeded or landed in
   *  `unavailable`/`failed`. */
  unattempted: CandidateRace[];
  /** Why the batch stopped early, or null if every candidate was attempted (regardless of how
   *  many ended up in `failed` — an isolated network hiccup never stops the batch). */
  stopReason: BatchStopReason | null;
}

export type FetchRaceDetail = (candidate: CandidateRace) => Promise<DiscoveryResult<RaceDetailPayload>>;
export type BuildInsertRow = (candidate: CandidateRace, detail: RaceDetailPayload) => Record<string, unknown>;

/** What to do about one candidate's failed detail fetch: `skip` (permanent, per-candidate — carry
 *  on, never retryable), `retry_later` (transient, per-candidate — carry on, but surface as
 *  retryable), or a `BatchStopReason` (affects every remaining candidate too — stop rather than
 *  burning through the rest of the list against the same failure). */
export type DetailFailureAction = 'skip' | 'retry_later' | BatchStopReason;

/**
 * The one decision this whole fix hinges on.
 *
 * - `not_found` / `bad_request`: this race's own data is unusable — unrelated to every other
 *   candidate, and re-fetching THIS candidate again would fail identically. Skip permanently. (Not
 *   an assertion about *why* — `not_found` alone doesn't establish the cause; see
 *   FetchCandidateDetailsResult's `unavailable` doc.)
 * - `network_error`: classified here only for its FINAL outcome, after fetchCandidateDetails's own
 *   bounded retry (see below) already failed a second time — still just a transient blip specific
 *   to this one request, not a reason to believe the DATA is unusable. Never stops the batch, but
 *   stays retryable rather than being written off as permanently unavailable.
 * - `unauthorized`: the athlete's session itself is no longer valid. Nothing further in this batch
 *   can succeed until they sign in again, so stop immediately rather than burning through the rest
 *   of the list with the same failure.
 * - `rate_limited` / `disabled` / `provider_blocked`: provider-wide conditions — every remaining
 *   candidate would fail identically right now. Stop rather than hammering the provider further.
 */
export function classifyDetailFailure(reason: UnavailableReason): DetailFailureAction {
  switch (reason) {
    case 'unauthorized':
      return 'unauthorized';
    case 'rate_limited':
      return 'rate_limited';
    case 'disabled':
      return 'disabled';
    case 'provider_blocked':
      return 'provider_blocked';
    case 'not_found':
    case 'bad_request':
      return 'skip';
    case 'network_error':
      return 'retry_later';
  }
}

const NETWORK_RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safe diagnostics only — provider identifiers (already sent to the server as part of the
 *  request, so not additionally sensitive) and the classification outcome. Never the athlete's
 *  session token, race payload, or any other personal data. */
function logDetailOutcome(stage: DetailFailureAction, candidate: CandidateRace, reason: UnavailableReason, attempt: 1 | 2) {
  console.warn(
    '[raceImportBatch] detail fetch unavailable —',
    'stage=', stage,
    'attempt=', attempt,
    'providerResultId=', candidate.providerResultId,
    'providerAthleteResultId=', candidate.providerAthleteResultId,
    'reason=', reason,
  );
}

/** Exactly one bounded retry for a transient `network_error` on THIS candidate's detail fetch —
 *  same one-retry pattern already established in lib/signal.ts and lib/auth.tsx for the same
 *  class of problem. Any other failure reason is returned as-is; retrying an `unauthorized` or
 *  `not_found` response would fail identically. */
async function fetchDetailWithRetry(fetchDetail: FetchRaceDetail, candidate: CandidateRace): Promise<DiscoveryResult<RaceDetailPayload>> {
  const first = await fetchDetail(candidate);
  if (first.available || first.reason !== 'network_error') return first;
  await sleep(NETWORK_RETRY_DELAY_MS);
  return fetchDetail(candidate);
}

/**
 * Fetches detail for each candidate in order. An individual unavailable or malformed result never
 * prevents the rest of the batch from being attempted — only a batch-wide condition
 * (unauthorized/rate_limited/disabled/provider_blocked) stops early, and even then everything
 * fetched so far is preserved in `rows`.
 */
export async function fetchCandidateDetails(
  candidates: CandidateRace[],
  fetchDetail: FetchRaceDetail,
  buildInsertRow: BuildInsertRow,
  onProgress?: (done: number) => void,
): Promise<FetchCandidateDetailsResult> {
  const rows: Record<string, unknown>[] = [];
  const unavailable: CandidateUnavailable[] = [];
  const failed: CandidateUnavailable[] = [];
  let stopReason: BatchStopReason | null = null;
  let stopIndex = -1;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const result = await fetchDetailWithRetry(fetchDetail, candidate);
    if (result.available) {
      rows.push(buildInsertRow(candidate, result.data));
      onProgress?.(i + 1);
      continue;
    }

    const action = classifyDetailFailure(result.reason);
    if (action === 'skip') {
      logDetailOutcome('skip', candidate, result.reason, 2);
      unavailable.push({ candidate, reason: result.reason });
      onProgress?.(i + 1);
      continue;
    }
    if (action === 'retry_later') {
      // Both attempts (the original plus fetchDetailWithRetry's one bounced retry) failed with
      // network_error — still an isolated, transient condition, so the batch keeps going; this
      // candidate is just parked as retryable rather than either saved or written off.
      logDetailOutcome('retry_later', candidate, result.reason, 2);
      failed.push({ candidate, reason: result.reason });
      onProgress?.(i + 1);
      continue;
    }

    logDetailOutcome(action, candidate, result.reason, 1);
    stopReason = action;
    stopIndex = i;
    break;
  }

  const unattempted = stopIndex === -1 ? [] : candidates.slice(stopIndex);
  return { rows, unavailable, failed, unattempted, stopReason };
}

export interface ImportOutcomeMessage {
  text: string;
  /** Which recovery action the message implies. `null` means nothing is retryable (either
   *  everything succeeded, or every remaining gap is a permanent per-candidate `unavailable`
   *  entry) — the caller shows no action button in that case. */
  action: 'retry' | 'sign_in_again' | null;
}

/**
 * Builds the athlete-facing summary for one import attempt. Insert failure (a real, non-duplicate
 * database error) takes priority — it's a distinct condition from anything below and already has
 * its own message. Otherwise, reports saved/unavailable counts plainly, and — only when something
 * is genuinely retryable (`retryableCount`: candidates never attempted because the batch paused,
 * PLUS candidates whose network_error didn't resolve even after the bounded automatic retry) — a
 * single recovery action: signing in again for an auth failure, or a plain Retry otherwise.
 */
export function describeImportOutcome(params: {
  rowsReadyToInsert: number;
  saved: number;
  insertFailed: boolean;
  unavailableCount: number;
  retryableCount: number;
  stopReason: BatchStopReason | null;
}): ImportOutcomeMessage | null {
  const { rowsReadyToInsert, saved, insertFailed, unavailableCount, retryableCount, stopReason } = params;

  // An `unauthorized` stop always wins the ACTION, even if the same run also hit an insert
  // failure (both can happen together: some candidates fetch fine, then either the insert call
  // itself fails OR a later candidate's fetch hits `unauthorized`) — a dead session dooms any
  // retry attempt regardless of which specific call it was, so signing in again is the one
  // recovery that can actually succeed. The insert-failure detail still appears in the text so
  // nothing is silently lost.
  if (stopReason === 'unauthorized') {
    const parts: string[] = [];
    if (saved > 0) parts.push(`Saved ${saved}.`);
    if (insertFailed) {
      parts.push(`${rowsReadyToInsert} more couldn’t be saved because your session expired. Sign in again to finish.`);
    } else if (retryableCount > 0) {
      parts.push(`Sign in again to add the remaining ${retryableCount}.`);
    }
    return { text: parts.join(' '), action: 'sign_in_again' };
  }

  if (insertFailed) {
    return {
      text: `Found ${rowsReadyToInsert} race${rowsReadyToInsert === 1 ? '' : 's'} but couldn’t save. Check your connection and tap Retry.`,
      action: 'retry',
    };
  }

  const parts: string[] = [];
  if (saved > 0) parts.push(`Saved ${saved}.`);
  if (unavailableCount > 0) {
    parts.push(`${unavailableCount} ${unavailableCount === 1 ? "race wasn’t" : "races weren’t"} available to import.`);
  }

  if (retryableCount > 0) {
    // `stopReason === 'unauthorized'` is handled above and already returned — it can never reach
    // here.
    if (stopReason === 'rate_limited' || stopReason === 'disabled' || stopReason === 'provider_blocked') {
      parts.push(`Race search is temporarily unavailable. Tap Retry to fetch the remaining ${retryableCount}.`);
    } else {
      // No batch-wide stop — these are isolated candidates whose network_error didn't resolve
      // even after one automatic retry. A real connection problem, not a provider-side condition.
      parts.push(
        `${retryableCount} ${retryableCount === 1 ? "race couldn’t" : "races couldn’t"} be checked due to a connection problem. Tap Retry.`,
      );
    }
    return { text: parts.join(' '), action: 'retry' };
  }

  if (unavailableCount > 0) {
    // Nothing left to retry, but worth telling the athlete why the saved count is lower than what
    // they selected.
    return { text: parts.join(' '), action: null };
  }

  return null; // Everything saved cleanly — no message needed.
}
