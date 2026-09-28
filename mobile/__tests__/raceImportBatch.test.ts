import {
  classifyDetailFailure,
  describeImportOutcome,
  fetchCandidateDetails,
  type FetchRaceDetail,
} from '@/lib/raceImportBatch';
import type { CandidateRace, DiscoveryResult, RaceDetailPayload, UnavailableReason } from '@/lib/raceDiscovery';

function candidate(providerResultId: string, eventName = 'Test Race'): CandidateRace {
  return {
    provider: 'sportstats',
    providerResultId,
    providerAthleteResultId: `${providerResultId}-athlete`,
    sourceUrl: `https://example.test/${providerResultId}`,
    eventName,
    category: 'Overall Results',
    eventDate: '2024-05-01',
    eventYear: 2024,
  };
}

function detail(finishSeconds: number): RaceDetailPayload {
  return { finishSeconds, splits: [] };
}

function available(finishSeconds: number): DiscoveryResult<RaceDetailPayload> {
  return { available: true, data: detail(finishSeconds) };
}

function unavailable(reason: UnavailableReason): DiscoveryResult<RaceDetailPayload> {
  return { available: false, reason };
}

const buildInsertRow = (c: CandidateRace, d: RaceDetailPayload) => ({
  provider_result_id: c.providerResultId,
  finish_seconds: d.finishSeconds ?? null,
});

describe('classifyDetailFailure', () => {
  it('classifies per-candidate, permanent failures as skip', () => {
    expect(classifyDetailFailure('not_found')).toBe('skip');
    expect(classifyDetailFailure('bad_request')).toBe('skip');
  });

  it('classifies a network error as retryable, not permanently unavailable', () => {
    expect(classifyDetailFailure('network_error')).toBe('retry_later');
  });

  it('classifies session/provider-wide conditions as batch-stop reasons', () => {
    expect(classifyDetailFailure('unauthorized')).toBe('unauthorized');
    expect(classifyDetailFailure('rate_limited')).toBe('rate_limited');
    expect(classifyDetailFailure('disabled')).toBe('disabled');
    expect(classifyDetailFailure('provider_blocked')).toBe('provider_blocked');
  });
});

describe('fetchCandidateDetails', () => {
  // The confirmed defect this whole fix addresses: a real production incident where the FIRST
  // candidate (newest-first sort surfaced a candidate the provider had no result for) failed with
  // `not_found`, and the old loop discarded all 12 remaining, genuinely importable races. (The
  // reason code alone doesn't establish WHY that candidate had no result — see the module's doc
  // comment on `unavailable` — this test only asserts the batch behavior, not a cause.)
  it('does not let the first candidate’s failure block later, successful candidates', async () => {
    const candidates = [candidate('c1', 'No result available'), candidate('c2'), candidate('c3')];
    const fetchDetail: FetchRaceDetail = async (c) => (c.providerResultId === 'c1' ? unavailable('not_found') : available(3600));

    const result = await fetchCandidateDetails(candidates, fetchDetail, buildInsertRow);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.provider_result_id)).toEqual(['c2', 'c3']);
    expect(result.unavailable).toEqual([{ candidate: candidates[0], reason: 'not_found' }]);
    expect(result.failed).toEqual([]);
    expect(result.unattempted).toEqual([]);
    expect(result.stopReason).toBeNull();
  });

  it('carries every unattempted candidate forward after a batch-stop, without duplicating what already fetched', async () => {
    const candidates = [candidate('c1'), candidate('c2'), candidate('c3'), candidate('c4')];
    const fetchDetail: FetchRaceDetail = async (c) => (c.providerResultId === 'c3' ? unavailable('rate_limited') : available(1800));

    const first = await fetchCandidateDetails(candidates, fetchDetail, buildInsertRow);
    expect(first.rows.map((r) => r.provider_result_id)).toEqual(['c1', 'c2']);
    expect(first.unattempted.map((c) => c.providerResultId)).toEqual(['c3', 'c4']);
    expect(first.stopReason).toBe('rate_limited');

    // Retry only re-fetches the unattempted remainder — the caller never re-passes c1/c2 — so a
    // retry naturally cannot re-fetch (and downstream re-insert) an already-saved candidate.
    const retryFetchDetail: FetchRaceDetail = async () => available(1900);
    const retry = await fetchCandidateDetails(first.unattempted, retryFetchDetail, buildInsertRow);
    expect(retry.rows.map((r) => r.provider_result_id)).toEqual(['c3', 'c4']);
    expect(retry.unattempted).toEqual([]);
    expect(retry.stopReason).toBeNull();

    const allFetchedIds = [...first.rows, ...retry.rows].map((r) => r.provider_result_id);
    expect(new Set(allFetchedIds).size).toBe(allFetchedIds.length);
  });

  it('stops immediately on an authentication failure and reports every later candidate as unattempted', async () => {
    const candidates = [candidate('c1'), candidate('c2'), candidate('c3')];
    const fetchDetail: FetchRaceDetail = async (c) => (c.providerResultId === 'c1' ? unavailable('unauthorized') : available(1800));

    const result = await fetchCandidateDetails(candidates, fetchDetail, buildInsertRow);

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe('unauthorized');
    expect(result.unattempted.map((c) => c.providerResultId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('stops on a rate-limit and preserves whatever was already fetched', async () => {
    const candidates = [candidate('c1'), candidate('c2'), candidate('c3')];
    const fetchDetail: FetchRaceDetail = async (c) => (c.providerResultId === 'c2' ? unavailable('rate_limited') : available(2000));

    const result = await fetchCandidateDetails(candidates, fetchDetail, buildInsertRow);

    expect(result.rows.map((r) => r.provider_result_id)).toEqual(['c1']);
    expect(result.stopReason).toBe('rate_limited');
    expect(result.unattempted.map((c) => c.providerResultId)).toEqual(['c2', 'c3']);
  });

  it('retries a transient network error once for that candidate before giving up', async () => {
    let attempts = 0;
    const fetchDetail: FetchRaceDetail = async (c) => {
      if (c.providerResultId === 'c1') {
        attempts += 1;
        return attempts === 1 ? unavailable('network_error') : available(2200);
      }
      return available(1800);
    };

    const result = await fetchCandidateDetails([candidate('c1'), candidate('c2')], fetchDetail, buildInsertRow);

    expect(attempts).toBe(2);
    expect(result.rows.map((r) => r.provider_result_id)).toEqual(['c1', 'c2']);
    expect(result.unavailable).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.stopReason).toBeNull();
  }, 10000);

  // The specific bug this refinement fixes: a network error that fails BOTH the original attempt
  // and the one bounded retry must still be reported as retryable (`failed`), not silently folded
  // into the permanent `unavailable` bucket — and it must never stop the batch either.
  it('treats a network error that fails twice in a row as retryable, not permanently unavailable, and does not stop the batch', async () => {
    const fetchDetail: FetchRaceDetail = async (c) => (c.providerResultId === 'c1' ? unavailable('network_error') : available(1800));

    const result = await fetchCandidateDetails([candidate('c1'), candidate('c2')], fetchDetail, buildInsertRow);

    expect(result.rows.map((r) => r.provider_result_id)).toEqual(['c2']);
    expect(result.unavailable).toEqual([]);
    expect(result.failed).toEqual([{ candidate: expect.objectContaining({ providerResultId: 'c1' }), reason: 'network_error' }]);
    expect(result.unattempted).toEqual([]);
    expect(result.stopReason).toBeNull();
  }, 10000);
});

describe('describeImportOutcome', () => {
  it('reports a database-save failure distinctly from a detail-fetch failure, with a retry action', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 3,
      saved: 0,
      insertFailed: true,
      unavailableCount: 0,
      retryableCount: 0,
      stopReason: null,
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.action).toBe('retry');
    expect(outcome!.text).toContain('3 races');
    expect(outcome!.text.toLowerCase()).toContain('save');
  });

  it('recommends signing in again for an unauthorized stop, not a plain retry', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 2,
      saved: 2,
      insertFailed: false,
      unavailableCount: 0,
      retryableCount: 5,
      stopReason: 'unauthorized',
    });
    expect(outcome).toEqual(expect.objectContaining({ action: 'sign_in_again' }));
    expect(outcome!.text).toContain('Sign in again');
  });

  // Both an insert failure AND an unauthorized stop can happen in the same run (some candidates
  // fetch fine, the insert call for them fails, and a LATER candidate's fetch then hits
  // unauthorized). Signing in again is the only thing that can actually fix either failure, so it
  // must win over the plain "insert failed, tap Retry" message/action.
  it('prioritizes sign-in-again over a plain retry when both an insert failure and an auth stop occur together', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 3,
      saved: 0,
      insertFailed: true,
      unavailableCount: 0,
      retryableCount: 2,
      stopReason: 'unauthorized',
    });
    expect(outcome).toEqual(expect.objectContaining({ action: 'sign_in_again' }));
    expect(outcome!.text.toLowerCase()).toContain('session expired');
  });

  it('recommends a plain retry for a rate-limit/provider-wide pause', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 2,
      saved: 2,
      insertFailed: false,
      unavailableCount: 0,
      retryableCount: 4,
      stopReason: 'rate_limited',
    });
    expect(outcome).toEqual(expect.objectContaining({ action: 'retry' }));
  });

  it('recommends a plain retry for isolated network failures with no batch-wide stop', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 10,
      saved: 10,
      insertFailed: false,
      unavailableCount: 0,
      retryableCount: 2,
      stopReason: null,
    });
    expect(outcome).toEqual(expect.objectContaining({ action: 'retry' }));
    expect(outcome!.text.toLowerCase()).toContain('connection problem');
  });

  it('reports permanently-unavailable candidates with no action when nothing is left to retry', () => {
    const outcome = describeImportOutcome({
      rowsReadyToInsert: 12,
      saved: 12,
      insertFailed: false,
      unavailableCount: 1,
      retryableCount: 0,
      stopReason: null,
    });
    expect(outcome).toEqual(expect.objectContaining({ action: null }));
    expect(outcome!.text).toContain('Saved 12');
    expect(outcome!.text).toContain('1 race wasn’t available');
  });

  it('returns null when everything imported cleanly with nothing to report', () => {
    expect(
      describeImportOutcome({
        rowsReadyToInsert: 5,
        saved: 5,
        insertFailed: false,
        unavailableCount: 0,
        retryableCount: 0,
        stopReason: null,
      }),
    ).toBeNull();
  });
});
