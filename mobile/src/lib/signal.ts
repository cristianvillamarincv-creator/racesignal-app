import type { SignalContext } from '@/lib/signalContext';
import { supabase } from '@/lib/supabaseClient';

/**
 * Thin client for the `signal` Edge Function. Mirrors (but does not import — separate Deno vs
 * mobile TypeScript projects) `supabase/functions/signal/types.ts`. Every call requires a session
 * — supabase-js attaches the current session's access token automatically (see lib/auth.tsx) —
 * there is no unauthenticated action here, unlike race-discovery's search/history.
 */

export interface SignalChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SignalImageAttachment {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export type SignalUnavailableReason =
  | 'unauthorized'
  | 'rate_limited'
  | 'bad_request'
  | 'forbidden'
  | 'model_error'
  | 'network_error'
  /** RevenueCat's entitlement lookup itself failed server-side — distinct from "no active
   *  premium." Never shown as the paywall; a plain retriable error instead (see signal.tsx). */
  | 'service_unavailable'
  /** THIS client gave up waiting (see SIGNAL_CALL_TIMEOUT_MS) — distinct from `network_error`
   *  (a transport failure the request never really got a chance to complete) so the athlete-facing
   *  copy and developer diagnostics can each say something more specific than a generic network
   *  problem. Reliability investigation (B.1 Task 1): the request may still complete successfully
   *  server-side after this fires — this never auto-retries, only a deliberate, athlete-initiated
   *  Retry (see signal.tsx), which reuses the SAME requestId (see generateSignalRequestId) so the
   *  server can hand back the cached answer instead of re-running the model / consuming a second
   *  ask if this request actually did complete server-side (see
   *  supabase/migrations/0011_signal_request_dedup.sql). */
  | 'timeout'
  /** A request with this exact requestId is still being processed server-side right now (a
   *  genuine concurrent duplicate, not a lost-response retry — that case comes back as
   *  `available: true` with the cached reply instead). Recoverable via the same Retry action as
   *  any other reason; by the time the athlete taps it, the original attempt has very likely
   *  finished. */
  | 'duplicate_in_flight';

/**
 * One id per LOGICAL question, generated once when the athlete sends it and reused UNCHANGED for
 * every attempt at that same question — including the internal one-retry-for-a-transient-timeout
 * inside `invoke()` below, and an athlete-initiated Retry after a failure (see signal.tsx's
 * retryLastMessage) — never regenerated for a retry. This is what lets the Edge Function tell "the
 * response to an already-successfully-answered question was lost in transit, hand back the cached
 * answer" apart from "this is a genuinely new question" (see
 * supabase/migrations/0011_signal_request_dedup.sql) — without it, a lost response + Retry would
 * silently re-run the model and consume a second ask for one logical question. Not a security
 * token: the server scopes it per-athlete (its dedup table's primary key is
 * (athlete_id, request_id)), so uniqueness only needs to hold within one athlete's own attempts at
 * one question, not globally — a timestamp plus a short random suffix is more than sufficient.
 */
export function generateSignalRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What the signal function reports for the allowance: the same numbers a reply carries. */
export interface SignalUsagePayload {
  remaining: number;
  cap: number;
  isPremium: boolean;
}

export type SignalResult<T> =
  | { available: true; data: T }
  | {
      available: false;
      reason: SignalUnavailableReason;
      /** A safe, truncated status/message string for developer diagnostics (console.warn) — never
       *  the API key, auth token, race payload, or screenshot data. Deliberately not shown to the
       *  athlete (see signal.tsx): user-facing errors stay short and generic via
       *  REASON_MESSAGES, never exposing backend/Anthropic implementation details. */
      detail?: string;
    };

export interface SignalReplyPayload {
  reply: string;
  /** Asks left after this one was consumed, and the cap it was measured against — 3 LIFETIME for
   *  free (never resets; migrations/0010_signal_free_lifetime_allowance.sql), 40 per current UTC
   *  calendar-month for premium (supabase/functions/signal/index.ts's currentMonthWindow). See
   *  signal_usage.ts's formatSignalUsageLabel for how this renders either way. */
  remaining: number;
  cap: number;
  isPremium: boolean;
}

/**
 * Reliability investigation (B.1 Task 1): unlike raceDiscovery.ts's `withTimeout` (a fixed 20s,
 * fine for a quick lookup), this endpoint's own worst-case server-side budget is real and large —
 * see supabase/functions/signal/index.ts's REVENUECAT_TIMEOUT_MS (8s) plus MODEL_TIMEOUT_MS (45s),
 * sequentially, before an Edge Function cold start or the reserve-ask DB round trip are even
 * counted. Before this constant existed, `invoke()` had NO client-side bound at all — it relied
 * entirely on the platform's own implicit networking timeout (React Native's default, which is
 * neither documented here nor consistent across iOS/Android), so the FIRST request in a session —
 * the one most likely to pay a real cold start on top of that 53s budget — had no predictable,
 * diagnosable failure mode, only whatever the OS happened to do. 90s is chosen to sit comfortably
 * ABOVE that 53s server-side worst case (plus cold start headroom): the goal is that this client
 * essentially never gives up before the Edge Function would already have returned its OWN clean,
 * definitive response (success or a `model_error`/`service_unavailable`) — which is what keeps a
 * genuine client-side give-up (see the 'timeout' reason below) rare, rather than a routine part of
 * a normal slow-but-successful first call.
 */
const SIGNAL_CALL_TIMEOUT_MS = 90_000;

export function sendSignalMessage(
  context: SignalContext,
  history: SignalChatTurn[],
  message: string,
  requestId: string,
  image?: SignalImageAttachment,
): Promise<SignalResult<SignalReplyPayload>> {
  return invoke({ context, history, message, requestId, image });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True only for the exact transient transport failure confirmed, by inspecting the backend's own
 * request/rate-limit/model logs against several real physical-device failures, to never reach
 * Supabase at all: React Native's own networking layer throwing before a connection completes,
 * surfaced by supabase-js as a `FunctionsFetchError` wrapping a `TypeError`. Every other error
 * shape — a real HTTP/function response (`FunctionsHttpError`), a relay error
 * (`FunctionsRelayError`), or any of this function's own `unavailable(...)` reasons (auth, rate
 * limit, validation, forbidden, model error, all returned as ordinary 200 JSON bodies, not as an
 * `error` here at all) — already reached the server and must never be retried.
 */
function isTransientNetworkTimeout(error: unknown): boolean {
  const err = error as { name?: string; context?: unknown };
  if (err?.name !== 'FunctionsFetchError') return false;
  const context = err.context as { name?: string; message?: string } | undefined;
  return context?.name === 'TypeError' && typeof context?.message === 'string' && context.message.includes('Network request timed out');
}

/**
 * True only for OUR OWN `SIGNAL_CALL_TIMEOUT_MS` firing — supabase-js's `timeout` option aborts the
 * in-flight fetch with an internally-created AbortController, which surfaces here as a
 * `FunctionsFetchError` wrapping an `AbortError` (a distinct shape from `isTransientNetworkTimeout`
 * above, which is the platform's OWN implicit timeout throwing a `TypeError` before any connection
 * completes). Kept as its own check — never merged with `isTransientNetworkTimeout` — so the two
 * genuinely different situations ("the connection never really started" vs. "we waited the full
 * 90s and gave up") get their own reason and diagnostics (see 'timeout' vs 'network_error').
 */
function isClientTimeout(error: unknown): boolean {
  const err = error as { name?: string; context?: unknown };
  if (err?.name !== 'FunctionsFetchError') return false;
  const context = err.context as { name?: string } | undefined;
  return context?.name === 'AbortError';
}

// Safe diagnostics only — sizes/counts/class names, never message/context content, tokens, race
// data, or image bytes. Kept as a standing developer aid, not athlete-facing. `category`
// distinguishes the client-detected failure classes from the B.1 reliability investigation (Task
// 1d) — this client only ever sees 'client_timeout' (our own SIGNAL_CALL_TIMEOUT_MS firing) or
// 'transport' (any other pre-response transport failure); auth/entitlement/model-call failures are
// distinguished server-side instead (see supabase/functions/signal/index.ts), since those already
// reach the server and come back as ordinary 200 JSON bodies, not as an `error` here at all.
function logInvokeFailure(error: unknown, elapsedMs: number, attempt: 1 | 2, category: 'client_timeout' | 'transport') {
  const err = error as { constructor?: { name?: string }; name?: string; message?: string; context?: unknown };
  const context = err.context as { constructor?: { name?: string }; name?: string; message?: string; status?: number } | undefined;
  console.warn(
    '[signal] functions.invoke failed —',
    'category=', category,
    'attempt=', attempt,
    'elapsedMs=', elapsedMs,
    'error.constructor=', err.constructor?.name,
    'error.name=', err.name,
    'error.message=', err.message,
    'error.context?.constructor=', context?.constructor?.name,
    'error.context?.name=', context?.name,
    'error.context?.message=', context?.message,
    'error.context?.status=', context?.status,
  );
}

// `FunctionsHttpError` specifically (a real, non-2xx HTTP response) carries the raw Response on
// `.context` with a readable body — surfaced as `detail` for developer diagnostics only (never
// shown to the athlete — see signal.tsx's REASON_MESSAGES). `FunctionsFetchError`'s `.context` is
// the original thrown error, not a Response, so `.text()` won't exist on it and this is skipped.
async function extractDetail(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: unknown };
  const context = err.context as { text?: unknown } | undefined;
  let detail = err.message ?? String(error);
  if (context && typeof context.text === 'function') {
    try {
      const bodyText = await (context as Response).text();
      if (bodyText) detail = bodyText.slice(0, 300);
    } catch {
      // ignore — fall back to error.message
    }
  }
  return detail;
}

async function invokeOnce(body: Record<string, unknown>): Promise<{ data: unknown; error: unknown; elapsedMs: number }> {
  const startedAt = Date.now();
  const { data, error } = await supabase.functions.invoke('signal', { body, timeout: SIGNAL_CALL_TIMEOUT_MS });
  return { data, error, elapsedMs: Date.now() - startedAt };
}

async function invoke<T>(body: Record<string, unknown>): Promise<SignalResult<T>> {
  const history = body.history as SignalChatTurn[] | undefined;
  console.log(
    '[signal] sending request — historyTurns=',
    history?.length ?? 0,
    'hasImage=',
    body.image !== undefined,
    'approxBodyBytes=',
    JSON.stringify(body).length,
  );

  const first = await invokeOnce(body);
  if (!first.error) {
    console.log('[signal] functions.invoke succeeded — attempt=1 elapsedMs=', first.elapsedMs);
    return first.data as SignalResult<T>;
  }

  // Checked before the transient-network-timeout branch below: our own SIGNAL_CALL_TIMEOUT_MS
  // giving up is never auto-retried (see the 'timeout' reason's own doc comment above) — a
  // deliberate, athlete-initiated Retry is the only way this attempt happens again (see signal.tsx).
  if (isClientTimeout(first.error)) {
    logInvokeFailure(first.error, first.elapsedMs, 1, 'client_timeout');
    return { available: false, reason: 'timeout', detail: await extractDetail(first.error) };
  }

  if (!isTransientNetworkTimeout(first.error)) {
    logInvokeFailure(first.error, first.elapsedMs, 1, 'transport');
    return { available: false, reason: 'network_error', detail: await extractDetail(first.error) };
  }

  // Exactly one retry, invisible to the athlete — see signal.tsx's sendMessage, which awaits this
  // whole call without showing any "retrying" state. Re-sends the identical body.
  console.log('[signal] transient transport timeout — retrying once');
  await sleep(300 + Math.random() * 400);
  const second = await invokeOnce(body);
  if (!second.error) {
    console.log('[signal] functions.invoke succeeded — attempt=2 elapsedMs=', second.elapsedMs);
    return second.data as SignalResult<T>;
  }

  if (isClientTimeout(second.error)) {
    logInvokeFailure(second.error, second.elapsedMs, 2, 'client_timeout');
    return { available: false, reason: 'timeout', detail: await extractDetail(second.error) };
  }

  logInvokeFailure(second.error, second.elapsedMs, 2, 'transport');
  return { available: false, reason: 'network_error', detail: await extractDetail(second.error) };
}

// The allowance lookup is a quick read, not a model call, so it gets a short bound of its own (the 90s above is sized for a model
// answer) and is never retried: the screen simply asks again the next time it opens or regains focus.
const SIGNAL_USAGE_TIMEOUT_MS = 15_000;

/**
 * Reads the athlete's current Signal allowance from the server without reserving or consuming an ask and without any model
 * call (the function's read-only `usage` action; it applies the same entitlement and quota rules as a reply). Returns null for
 * every failure (offline, timeout, signed out, entitlement lookup failed, malformed response): the caller must show no count
 * rather than a guessed one, and must not let this block the conversation. Never throws.
 */
export async function fetchSignalUsage(): Promise<SignalUsagePayload | null> {
  try {
    const { data, error } = await supabase.functions.invoke('signal', { body: { action: 'usage' }, timeout: SIGNAL_USAGE_TIMEOUT_MS });
    if (error) return null;
    const result = data as SignalResult<SignalUsagePayload> | null;
    if (!result || !result.available) return null;
    const { remaining, cap, isPremium } = result.data ?? ({} as Partial<SignalUsagePayload>);
    if (!Number.isInteger(remaining) || !Number.isInteger(cap) || (remaining as number) < 0 || (cap as number) <= 0 || typeof isPremium !== 'boolean') return null;
    return { remaining: remaining as number, cap: cap as number, isPremium };
  } catch {
    return null;
  }
}
