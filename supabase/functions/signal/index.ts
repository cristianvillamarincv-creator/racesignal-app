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
import type { SignalChatTurn, SignalContext, SignalRequestBody, SignalResponse, SignalUnavailableReason } from './types.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Every Signal call has real per-request $ cost against a paid model API with no paywall in front
// of it yet — this cap is the one non-negotiable cost control for now, independent of any future
// subscription gating. Per-athlete, not per-IP (see migrations/0005_signal_rate_limit.sql).
const DAILY_REQUEST_CAP = Number(Deno.env.get('SIGNAL_DAILY_REQUEST_CAP') ?? '20');

// A few MB of base64 text, decoded — defense-in-depth alongside the client's own resize/compress
// step (see mobile's image-attachment flow); this function must not blindly forward an
// unreasonably large payload to the model regardless of what the client intended to send.
const MAX_IMAGE_BASE64_LENGTH = 6_000_000;

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
  if (error || !data.user) return null;
  return { id: data.user.id };
}

async function checkAndIncrementRateLimit(athleteId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const client = serviceRoleClient();

  const { data: existing } = await client
    .from('signal_rate_limit')
    .select('request_count')
    .eq('athlete_id', athleteId)
    .eq('window_date', today)
    .maybeSingle();

  const currentCount = existing?.request_count ?? 0;
  if (currentCount >= DAILY_REQUEST_CAP) return false;

  await client
    .from('signal_rate_limit')
    .upsert({ athlete_id: athleteId, window_date: today, request_count: currentCount + 1 }, { onConflict: 'athlete_id,window_date' });

  return true;
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

type ModelResult = { reply: string } | { error: string };

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

  return { reply: text };
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

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return unavailable('bad_request');
    if (!isValidContext(body.context)) return unavailable('bad_request');
    if (!isValidHistory(body.history)) return unavailable('bad_request');

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

    if (!(await checkAndIncrementRateLimit(user.id))) {
      return unavailable('rate_limited');
    }

    const systemPrompt = buildSystemPrompt(context);
    const result = await callModel(systemPrompt, history, message, image);
    if ('error' in result) return unavailable('model_error', result.error);

    return json({ available: true, data: { reply: result.reply } } satisfies SignalResponse<{ reply: string }>);
  } catch (err) {
    const detail = `Unhandled exception: ${(err as Error).message}`;
    console.warn('[signal]', detail);
    return unavailable('model_error', safeDetail(detail));
  }
});
