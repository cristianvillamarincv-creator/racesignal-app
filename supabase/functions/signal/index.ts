// signal Edge Function (Step 5, V1) — RaceSignal's performance-analyst chat. Every action requires
// a signed-in athlete (unlike race-discovery's deliberate search/history exception), so this
// function relies on the platform gateway's own JWT verification (see config.toml) rather than a
// manual pre-check — but still needs to read the caller's own user id, done the same way
// race-discovery's `detail` action does it (an anon-key client validating the bearer token).
//
// Context (races/splits/ranks/highlights) is assembled CLIENT-SIDE and sent as-is — the app
// already computes it correctly (see mobile/src/lib/signalContext.ts). This function's one
// server-side responsibility, beyond calling the model, is confirming a supplied seed race
// actually belongs to the caller before using it — the one real cross-athlete privacy gap client-
// side trust would otherwise leave open. See the Step 5 plan's "trust model" section.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { buildSystemPrompt } from './systemPrompt.ts';
import type { SignalChatTurn, SignalContext, SignalReplyPayload, SignalRequestBody, SignalResponse, SignalUnavailableReason, SignalUsagePayload } from './types.ts';
import { claimSignalRequest, completeSignalRequest, currentMonthWindow, failSignalRequest, getSignalUsage, releaseSignalAsk, reserveSignalAsk } from './usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Build 11 correction — free is a LIFETIME cap (3 asks total, ever, for the account's whole free
// tenure — never reset by a new month; see migrations/0010_signal_free_lifetime_allowance.sql),
// premium remains the genuine per-UTC-calendar-month cap it always was. Free/premium status is
// resolved server-side against RevenueCat (see resolveEntitlementStatus below); a client-supplied
// "isPremium" is never trusted. The env var key keeps its original "MONTHLY" name (avoids an
// unrelated secrets-config change at deploy time for what was already the same default value, 3) —
// only the local name and this comment change to reflect the corrected semantics.
const FREE_LIFETIME_CAP = Number(Deno.env.get('SIGNAL_FREE_MONTHLY_CAP') ?? '3');
const PREMIUM_MONTHLY_CAP = Number(Deno.env.get('SIGNAL_PREMIUM_MONTHLY_CAP') ?? '40');

// A few MB of base64 text, decoded — defense-in-depth alongside the client's own resize/compress
// step (see mobile's image-attachment flow); this function must not blindly forward an
// unreasonably large payload to the model regardless of what the client intended to send.
const MAX_IMAGE_BASE64_LENGTH = 6_000_000;

// Build 11 reliability correction (Task 2) — the client generates one stable id per logical
// question (see mobile lib/signal.ts's generateSignalRequestId), a short random string; this bound
// is generous headroom, not a real budget, and only guards against a malformed/hostile payload.
const MAX_REQUEST_ID_LENGTH = 200;

const MODEL = Deno.env.get('SIGNAL_MODEL') ?? 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
// Answers now target ~150-300 words (see systemPrompt.ts) — this is deliberately generous
// headroom above that, not a budget for the old, much longer structured answers.
const MAX_REPLY_TOKENS = 700;
// Bounds worst-case latency so THIS code always gets a chance to return a clean, diagnosable
// response — without this, a slow/hanging Anthropic call could run past the Edge Function
// platform's own wall-clock limit, which kills the function process outright (no JS-level
// exception, nothing for our own try/catch to catch) and looks to the client exactly like a raw
// network failure ("Failed to send a request to the Edge Function") instead of a clean error.
const MODEL_TIMEOUT_MS = 45_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// `detail` is a safe, truncated status/message for developer diagnostics — see types.ts's
// SignalResponse doc comment. The mobile client deliberately never shows it to the athlete.
function unavailable(reason: SignalUnavailableReason, detail?: string) {
  return json({ available: false, reason, detail } satisfies SignalResponse<never>);
}

function serviceRoleClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function requireAuthenticatedUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) {
    // Safe diagnostic only — never the bearer token itself, just that verification failed and why.
    // Reliability investigation (B.1 Task 1d): this is the "auth failure" category, kept distinct
    // from every other unavailable(...) reason below so real logs can tell an expired/invalid
    // session apart from a rate-limit, entitlement, or model-call failure at a glance.
    console.warn('[signal] auth check failed —', error?.message ?? 'getUser() returned no user for a well-formed bearer token');
    return null;
  }
  return { id: data.user.id };
}

// currentMonthWindow, reserveSignalAsk/releaseSignalAsk, and claimSignalRequest/
// completeSignalRequest/failSignalRequest now live in ./usage.ts (factored out so this
// RPC-branching logic is directly unit-testable, matching systemPrompt.ts's own split) — imported
// above, and called below with `serviceRoleClient()` passed in explicitly.

type EntitlementStatus = 'premium' | 'free' | 'error';

// Bounds the RevenueCat lookup the same way MODEL_TIMEOUT_MS bounds the Anthropic call — a hung
// request here must still let this function return a clean, retriable response.
const REVENUECAT_TIMEOUT_MS = 8_000;

/**
 * Server-side premium check against RevenueCat's REST API — the one place a "premium" decision is
 * actually made. Uses RaceSignal's existing PUBLIC iOS SDK key (REVENUECAT_PUBLIC_API_KEY) rather
 * than a privileged secret key: RevenueCat's subscriber-lookup endpoint is designed to be safely
 * callable with a public key scoped to reading/writing only the one app_user_id passed in — the
 * same key the mobile SDK itself already uses, not a new credential. The RevenueCat App User ID is
 * always the same Supabase auth user id already verified above (see lib/premium.tsx client-side),
 * so no separate identity mapping is needed. A client-supplied isPremium flag is never read or
 * trusted anywhere in this function.
 *
 * Returns 'error' — never silently 'free' — for anything that isn't a genuine, successful "no
 * active premium entitlement" result: missing key, timeout, network error, non-2xx, or a
 * malformed body. The caller must treat 'error' as a recoverable failure (no ask reserved, no
 * paywall shown), never as evidence the athlete is on the free tier.
 */
async function resolveEntitlementStatus(athleteId: string): Promise<EntitlementStatus> {
  const publicKey = Deno.env.get('REVENUECAT_PUBLIC_API_KEY');
  if (!publicKey) {
    console.warn('[signal] REVENUECAT_PUBLIC_API_KEY is not set — cannot resolve entitlement status.');
    return 'error';
  }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), REVENUECAT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: `Bearer ${publicKey}` },
      signal: timeoutController.signal,
    });
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? `timed out after ${REVENUECAT_TIMEOUT_MS}ms` : (err as Error).message;
    console.warn('[signal] RevenueCat subscriber lookup failed to complete —', reason);
    return 'error';
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    console.warn('[signal] RevenueCat subscriber lookup returned a non-2xx status —', res.status);
    return 'error';
  }

  let data: { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
  try {
    data = await res.json();
  } catch (err) {
    console.warn('[signal] RevenueCat subscriber lookup returned a malformed body —', (err as Error).message);
    return 'error';
  }

  const entitlement = data.subscriber?.entitlements?.['premium'];
  if (!entitlement) return 'free';
  if (!entitlement.expires_date) return 'premium'; // non-expiring entitlement
  return new Date(entitlement.expires_date).getTime() > Date.now() ? 'premium' : 'free';
}

/** Fire-and-forget cost instrumentation for one successful reply — never blocks or fails the
 *  athlete's response if the insert itself fails. No prompt/response text or image bytes are
 *  logged, only token counts and flags (see migrations/0007). */
async function logSignalUsage(athleteId: string, inputTokens: number, outputTokens: number, hadImage: boolean, wasPremium: boolean): Promise<void> {
  const { error } = await serviceRoleClient()
    .from('signal_usage_log')
    .insert({ athlete_id: athleteId, input_tokens: inputTokens, output_tokens: outputTokens, had_image: hadImage, was_premium: wasPremium });
  if (error) console.warn('[signal] logSignalUsage failed —', error.message);
}

/** The one server-side trust boundary: a client-supplied seed race must actually belong to the
 *  caller. Everything else in `context` is taken as given (see the file header comment). */
async function seedRaceBelongsToAthlete(seedRaceId: string, athleteId: string): Promise<boolean> {
  const { data } = await serviceRoleClient()
    .from('races')
    .select('id')
    .eq('id', seedRaceId)
    .eq('athlete_id', athleteId)
    .maybeSingle();
  return data !== null;
}

function isValidContext(value: unknown): value is SignalContext {
  if (typeof value !== 'object' || value === null) return false;
  const context = value as Record<string, unknown>;
  return (
    Array.isArray(context.sameSportDetailed) &&
    Array.isArray(context.otherSportsCompact) &&
    Array.isArray(context.upcoming) &&
    Array.isArray(context.bestPerDistance)
  );
}

function isValidHistory(value: unknown): value is SignalChatTurn[] {
  return (
    Array.isArray(value) &&
    value.every(
      (turn) =>
        typeof turn === 'object' &&
        turn !== null &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.text === 'string',
    )
  );
}

interface AnthropicContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

type ModelResult = { reply: string; inputTokens: number; outputTokens: number } | { error: string };

/** Truncates a raw error string to something safe to log and to return as `detail` — Anthropic's
 *  own error bodies describe what's wrong with OUR request (bad model name, bad key format,
 *  etc.), never anything from the athlete's own data. */
function safeDetail(text: string): string {
  return text.slice(0, 300);
}

async function callModel(systemPrompt: string, history: SignalChatTurn[], message: string, image?: SignalRequestBody['image']): Promise<ModelResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('[signal] ANTHROPIC_API_KEY is not set — cannot call the model.');
    return { error: 'ANTHROPIC_API_KEY is not set on the deployed function.' };
  }

  const newMessageContent: AnthropicContentBlock[] = [];
  if (image) {
    newMessageContent.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  newMessageContent.push({ type: 'text', text: message });

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: newMessageContent },
  ];

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_REPLY_TOKENS,
    system: systemPrompt,
    messages,
    // Root cause of "200 returned no text content": Sonnet 5's adaptive thinking is on by
    // default, and max_tokens is the hard ceiling across thinking + visible answer combined — a
    // long thinking block could consume the whole budget, leaving zero tokens for actual text.
    // Signal's race-analysis calls don't need extended reasoning; explicitly disabling it keeps
    // latency/cost predictable and guarantees the budget goes to the visible answer.
    thinking: { type: 'disabled' },
  });

  // Safe diagnostics only — sizes/counts, never message/context content, tokens, or image bytes.
  console.log(
    '[signal] calling model — historyTurns=',
    history.length,
    'hasImage=',
    !!image,
    'systemPromptChars=',
    systemPrompt.length,
    'requestBodyBytes=',
    requestBody.length,
  );

  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), MODEL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: requestBody,
      signal: timeoutController.signal,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const wasTimeout = (err as Error).name === 'AbortError';
    const detail = wasTimeout
      ? `Anthropic request timed out after ${MODEL_TIMEOUT_MS}ms (historyTurns=${history.length}, elapsedMs=${elapsedMs})`
      : `fetch to Anthropic threw after ${elapsedMs}ms: ${(err as Error).message}`;
    console.warn('[signal]', detail);
    return { error: safeDetail(detail) };
  } finally {
    clearTimeout(timeoutHandle);
  }
  console.log('[signal] model responded — status=', response.status, 'elapsedMs=', Date.now() - startedAt);

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(could not read body)');
    const detail = `Anthropic ${response.status} (model="${MODEL}"): ${bodyText}`;
    console.warn('[signal]', detail);
    return { error: safeDetail(detail) };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const detail = `Anthropic returned ${response.status} but body wasn't valid JSON: ${(err as Error).message}`;
    console.warn('[signal]', detail);
    return { error: safeDetail(detail) };
  }

  const text = ((data as { content?: AnthropicContentBlock[] }).content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  if (!text) {
    const detail = `Anthropic ${response.status} returned no text content: ${JSON.stringify(data).slice(0, 200)}`;
    console.warn('[signal]', detail);
    return { error: safeDetail(detail) };
  }

  const usage = (data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return { reply: text, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Top-level catch-all: an uncaught exception anywhere below would otherwise propagate as a raw
  // 500, which supabase-js's functions.invoke() surfaces as a generic network-level error
  // client-side (indistinguishable from an actual connectivity problem) instead of a clean,
  // diagnosable `unavailable(...)` response. Every code path below should already return cleanly;
  // this is a permanent guarantee, not a stopgap.
  try {
    const user = await requireAuthenticatedUser(req);
    if (!user) return unavailable('unauthorized');
    const client = serviceRoleClient();

    const rawBody = await req.text();
    // Safe diagnostics only — total incoming payload size, never its content. This is exactly
    // what distinguishes "the request never really changed size between turns" from "it grew a
    // lot" — see the P0 multi-turn investigation this was added for.
    console.log('[signal] request received — rawBodyBytes=', rawBody.length);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return unavailable('bad_request');
    }

    // Read-only allowance lookup (`{ action: 'usage' }`): authenticated above, then the same entitlement lookup and the same
    // counters an ask uses, only read. Returns before any request dedup, reservation, or model call, so it can never
    // consume or modify an ask. A failed entitlement or counter read is reported as unavailable, never as a guessed count.
    if (body.action === 'usage') {
      const entitlement = await resolveEntitlementStatus(user.id);
      const usage = await getSignalUsage(client, user.id, entitlement, { free: FREE_LIFETIME_CAP, premium: PREMIUM_MONTHLY_CAP });
      if (!usage.ok) return unavailable(usage.reason);
      return json({
        available: true,
        data: { remaining: usage.remaining, cap: usage.cap, isPremium: usage.isPremium },
      } satisfies SignalResponse<SignalUsagePayload>);
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return unavailable('bad_request');
    if (!isValidContext(body.context)) return unavailable('bad_request');
    if (!isValidHistory(body.history)) return unavailable('bad_request');
    // Optional, for Build 10 compatibility: Build 10 (and any older installed client) never sends
    // this field at all — it predates request-identity dedup entirely. Rejecting a request that's
    // merely missing requestId would break every already-installed Build 10 device the moment this
    // function deploys, so an absent/blank requestId is accepted and simply means NO dedup
    // protection for that one request (see the `claimToken` handling below) — the exact same
    // lost-response-then-double-consumption exposure Build 10 already has today, completely
    // unchanged. A requestId that IS present but unreasonably long is still rejected as malformed.
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    if (requestId.length > MAX_REQUEST_ID_LENGTH) return unavailable('bad_request');

    const context = body.context as SignalContext;
    const history = body.history as SignalChatTurn[];
    console.log(
      '[signal] parsed request — historyTurns=',
      history.length,
      'hasSeedRace=',
      !!context.seedRace,
      'sameSportDetailedCount=',
      context.sameSportDetailed.length,
      'otherSportsCompactCount=',
      context.otherSportsCompact.length,
      'upcomingCount=',
      context.upcoming.length,
      'hasImage=',
      body.image !== undefined,
    );

    let image: SignalRequestBody['image'] | undefined;
    if (body.image !== undefined) {
      const rawImage = body.image as Record<string, unknown>;
      const base64 = typeof rawImage.base64 === 'string' ? rawImage.base64 : '';
      const mediaType = rawImage.mediaType;
      const validMediaType = mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/webp';
      if (!base64 || !validMediaType) return unavailable('bad_request');
      if (base64.length > MAX_IMAGE_BASE64_LENGTH) return unavailable('bad_request');
      image = { base64, mediaType };
    }

    if (context.seedRace) {
      const owned = await seedRaceBelongsToAthlete(context.seedRace.id, user.id);
      if (!owned) return unavailable('forbidden');
    }

    // Request-identity dedup (Build 11 Task 2) — checked before anything that consumes an ask,
    // so a cached 'completed' result short-circuits the entire reserve/model-call path below; see
    // migrations/0011_signal_request_dedup.sql for the full reasoning. `claimToken` is null when
    // there is no dedup protection for this request at all — either an older client sent no
    // requestId (see the Build 10 compatibility note above), and every completeSignalRequest/
    // failSignalRequest call below is a no-op guarded by `claimToken !== null`, exactly preserving
    // Build 10's own pre-dedup behavior (and its pre-existing limitations) for that request.
    //
    // `existingReservation` non-null means this is a stale-reclaim of an attempt that ALREADY
    // reserved an ask before dying — see reserve_signal_ask's own comment for why the reservation
    // is recorded atomically with the reserve call itself, and claim_signal_request's comment for
    // why a stale-reclaim preserves (never resets) it. This is what closes the last real gap: a
    // reclaiming worker must REUSE that reservation, never make a second one for the same
    // logical question.
    let claimToken: string | null = null;
    let existingReservation: { tier: 'free' | 'premium'; windowDate: string; count: number } | null = null;
    if (requestId) {
      const claim = await claimSignalRequest(client, user.id, requestId);
      if (claim.status === 'error') return unavailable('service_unavailable');
      if (claim.status === 'processing') return unavailable('duplicate_in_flight');
      if (claim.status === 'completed') {
        return json({
          available: true,
          data: { reply: claim.reply, remaining: claim.remaining, cap: claim.cap, isPremium: claim.isPremium },
        } satisfies SignalResponse<SignalReplyPayload>);
      }
      // claim.status === 'claimed' — this invocation now owns requestId, fenced by claim.claimToken.
      claimToken = claim.claimToken;
      existingReservation = claim.existingReservation;
    }

    // Everything above this point is validation/ownership — none of it consumes an ask (unless
    // reused from `existingReservation`, which was already consumed by a prior, now-abandoned
    // attempt at this exact question — see below). Premium status is resolved fresh, server-side,
    // on every FRESH reservation (never cached, never client-trusted) — but a REUSED reservation
    // deliberately does NOT re-resolve it: the tier/window this question was actually charged
    // against must stay fixed to whatever it was at the time of the original reservation, even if
    // the athlete's entitlement has since changed, so accounting for this one logical question is
    // never split across two tiers/months.
    let isPremium: boolean;
    let tier: 'free' | 'premium';
    let cap: number;
    let windowDate: string;
    let reservedCount: number;

    if (existingReservation) {
      tier = existingReservation.tier;
      windowDate = existingReservation.windowDate;
      isPremium = tier === 'premium';
      cap = isPremium ? PREMIUM_MONTHLY_CAP : FREE_LIFETIME_CAP;
      reservedCount = existingReservation.count;
    } else {
      const entitlementStatus = await resolveEntitlementStatus(user.id);
      if (entitlementStatus === 'error') {
        // RevenueCat itself couldn't be reached/parsed — this is NOT "treat as free tier". No ask
        // is reserved, and the client must show a plain retriable error, never the premium
        // paywall. The claimed dedup row is released too: nothing was actually attempted for this
        // requestId, so an immediate retry (same id) must be allowed to run for real, not wait out
        // the staleness bound or receive a stale 'processing' response.
        if (claimToken) await failSignalRequest(client, user.id, requestId, claimToken);
        return unavailable('service_unavailable');
      }
      isPremium = entitlementStatus === 'premium';
      tier = isPremium ? 'premium' : 'free';
      cap = isPremium ? PREMIUM_MONTHLY_CAP : FREE_LIFETIME_CAP;
      windowDate = currentMonthWindow();

      const reserved = await reserveSignalAsk(
        client,
        user.id,
        windowDate,
        tier,
        cap,
        claimToken ? { requestId, claimToken } : undefined,
      );
      if (!reserved.ok) {
        // 'service_error' must never read as "you're out of asks" — see reserveSignalAsk's doc
        // comment. Only a genuine cap hit is reported as rate_limited. Either way, no ask was
        // reserved for this requestId, so its dedup row is released (same reasoning as above).
        if (claimToken) await failSignalRequest(client, user.id, requestId, claimToken);
        return reserved.reason === 'service_error' ? unavailable('service_unavailable') : unavailable('rate_limited');
      }
      reservedCount = reserved.count;
    }

    const systemPrompt = buildSystemPrompt(context);
    const result = await callModel(systemPrompt, history, message, image);
    if ('error' in result) {
      // The model call itself failed after an ask was reserved (fresh or reused) — give the slot
      // back. Only a genuinely successful reply should count against the athlete's allowance.
      //
      // Order matters here: fail_signal_request is checked BEFORE releasing, not after. If this
      // worker was already superseded by a stale-reclaim (fail returns false), the reservation now
      // belongs to — or was already consumed by — whichever worker currently owns the claim;
      // releasing it here would incorrectly free an ask that worker is still relying on. Only a
      // worker that was STILL the current claimant at the moment it gave up may release.
      if (claimToken) {
        const stillOwned = await failSignalRequest(client, user.id, requestId, claimToken);
        if (stillOwned) {
          await releaseSignalAsk(client, user.id, windowDate, tier);
        } else {
          console.warn('[signal] release skipped — this worker was superseded by a stale-reclaim; the reservation belongs to whoever now owns the claim.');
        }
      } else {
        // No dedup tracking at all (an older client with no requestId) — always release, exactly
        // as before Build 11.
        await releaseSignalAsk(client, user.id, windowDate, tier);
      }
      return unavailable('model_error', result.error);
    }

    await logSignalUsage(user.id, result.inputTokens, result.outputTokens, !!image, isPremium);

    const remaining = Math.max(cap - reservedCount, 0);
    // Cached BEFORE returning — see migrations/0011_signal_request_dedup.sql: a lost response
    // (client-perceived timeout/network failure after the model already answered) means a later
    // attempt with this SAME requestId must get this exact cached reply back from
    // claimSignalRequest, never a second model call or a second consumed ask. If this returns
    // false, this worker's claim was superseded by a stale-reclaim before it finished — its
    // answer is discarded rather than risking overwriting whatever the newer worker wrote; this
    // attempt's own response to ITS caller is unaffected (that caller genuinely got this reply).
    if (claimToken) {
      const applied = await completeSignalRequest(client, user.id, requestId, claimToken, result.reply, remaining, cap, isPremium);
      if (!applied) console.warn('[signal] completeSignalRequest was superseded by a later claim — this result was not cached.');
    }
    return json({
      available: true,
      data: { reply: result.reply, remaining, cap, isPremium },
    } satisfies SignalResponse<SignalReplyPayload>);
  } catch (err) {
    const detail = `Unhandled exception: ${(err as Error).message}`;
    console.warn('[signal]', detail);
    return unavailable('model_error', safeDetail(detail));
  }
});
