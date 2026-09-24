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

export type SignalUnavailableReason = 'unauthorized' | 'rate_limited' | 'bad_request' | 'forbidden' | 'model_error' | 'network_error';

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

export function sendSignalMessage(
  context: SignalContext,
  history: SignalChatTurn[],
  message: string,
  image?: SignalImageAttachment,
): Promise<SignalResult<{ reply: string }>> {
  return invoke({ context, history, message, image });
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

// Safe diagnostics only — sizes/counts/class names, never message/context content, tokens, race
// data, or image bytes. Kept as a standing developer aid, not athlete-facing.
function logInvokeFailure(error: unknown, elapsedMs: number, attempt: 1 | 2) {
  const err = error as { constructor?: { name?: string }; name?: string; message?: string; context?: unknown };
  const context = err.context as { constructor?: { name?: string }; name?: string; message?: string; status?: number } | undefined;
  console.warn(
    '[signal] functions.invoke failed —',
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
  const { data, error } = await supabase.functions.invoke('signal', { body });
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

  if (!isTransientNetworkTimeout(first.error)) {
    logInvokeFailure(first.error, first.elapsedMs, 1);
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

  logInvokeFailure(second.error, second.elapsedMs, 2);
  return { available: false, reason: 'network_error', detail: await extractDetail(second.error) };
}
