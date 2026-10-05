// Shared shapes for the `signal` Edge Function. Mirrors (but does not import — separate Deno vs
// mobile TypeScript projects, same reasoning as race-discovery/types.ts) the client-side shapes in
// mobile/src/lib/signalContext.ts. The context below is assembled CLIENT-SIDE (the app already
// holds the athlete's races correctly) and sent as-is; this function does not recompute it — see
// the Step 5 plan's "trust model" section for why, and requireOwnedSeedRace() below for the one
// server-side check that still applies.

export interface SignalRank {
  place: number;
  field?: number;
  percentile?: number;
}

/** A precomputed, already-signed time difference vs the seed race — "app computes facts, model
 *  explains them" for exactly the kind of subtraction a model can get wrong doing itself. Positive
 *  `deltaSeconds` means this race was slower than the seed. */
export interface SignalTimeDelta {
  label: string;
  deltaSeconds: number;
  description: string;
}

/** Full detail — used for the seed race and every other race in Tier 2 (same sport as the seed,
 *  or every completed race when there's no seed). */
export interface SignalRaceDetail {
  id: string;
  name: string;
  sport: string;
  distanceLabel: string;
  eventDate: string;
  location: string;
  finishSeconds?: number;
  /** `legRank` is the athlete's rank in that leg against the same race field. The app does not send it today (results
   *  providers' per-leg ranks are not stored); the formatter renders it when present so that comparable discipline-level
   *  evidence, once it exists, is what a strongest-discipline answer rests on. */
  splits?: { label: string; elapsedSeconds: number; paceLabel?: string; legRank?: SignalRank }[];
  overallRank?: SignalRank;
  genderRank?: SignalRank;
  ageGroupRank?: SignalRank;
  /** Human-readable highlight labels already computed by lib/highlights.ts (e.g. "Current 70.3
   *  PB", "Age-group podium") — never left for the model to infer on its own. */
  highlights: string[];
  /** Literal source notes plus a plain-language note when a rank/result is flagged
   *  needsConfirmation/rankingNeedsConfirmation — so Signal is appropriately hedged rather than
   *  citing a number the app itself doesn't fully trust. */
  notes: string[];
  /** Only present on races in `sameSportDetailed`, and only when a seed race exists. */
  timeDeltasVsSeed?: SignalTimeDelta[];
}

/** The athlete's single fastest result in each comparable distance group, with that group's own
 *  percentiles — one unambiguous, correctly-scoped percentile per distance, so the model never has
 *  to recall (and risk generalizing) a percentile from a different distance's race. */
export interface SignalDistanceBest {
  canonicalDistance: string;
  raceName: string;
  finishSeconds: number;
  overallPercentile?: number;
  ageGroupPercentile?: number;
}

/** Tier 3 (other sports) and Tier 4 (upcoming) — background records the model doesn't need full
 *  splits/ranks for. `finishSeconds` absent for an upcoming race. */
export interface SignalCompactRace {
  id: string;
  name: string;
  sport: string;
  distanceLabel: string;
  eventDate: string;
  location?: string;
  finishSeconds?: number;
}

export interface SignalContext {
  seedRace?: SignalRaceDetail;
  /** Tier 2 when a seed exists (same sport as the seed, same-canonical-distance ones first); every
   *  completed race when there's no seed (a still-small history doesn't need tiering to bound
   *  payload size — see the Step 5 plan). */
  sameSportDetailed: SignalRaceDetail[];
  /** Tier 3 — empty when there's no seed (everything already went into sameSportDetailed above). */
  otherSportsCompact: SignalCompactRace[];
  /** Tier 4 — always included regardless of entry point. */
  upcoming: SignalCompactRace[];
  /** One entry per distance group the athlete has raced — see SignalDistanceBest. */
  bestPerDistance: SignalDistanceBest[];
}

export interface SignalChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SignalImageAttachment {
  /** Raw base64 payload, no data-URL prefix. */
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface SignalRequestBody {
  context: SignalContext;
  /** Prior turns in this conversation, text-only — never includes a previous turn's raw image
   *  bytes (see the Step 5 plan's screenshot-lifetime design: the model's own first-turn
   *  description of an attachment, once in this history, IS the evidence later turns reason from). */
  history: SignalChatTurn[];
  message: string;
  /** At most one image, and only ever on the newest turn. */
  image?: SignalImageAttachment;
  /** Client-generated, stable for one LOGICAL question — generated once and reused unchanged
   *  across every attempt at that same question, including an athlete-initiated Retry (see mobile
   *  lib/signal.ts's generateSignalRequestId / signal.tsx's retryLastMessage). Lets index.ts
   *  (claim_signal_request) tell "the response to an already-successfully-answered question was
   *  lost in transit, hand back the cached answer" apart from "this is a genuinely new question" —
   *  without this, a lost response + Retry would silently re-run the model and consume a second
   *  ask for one logical question. Scoped per-athlete (the dedup table's primary key is
   *  (athlete_id, request_id)), so two different athletes reusing the same id string can never
   *  collide. */
  requestId: string;
}

export type SignalUnavailableReason =
  | 'unauthorized'
  | 'rate_limited'
  | 'bad_request'
  | 'forbidden'
  | 'model_error'
  /** RevenueCat's entitlement lookup itself failed (timeout, network error, non-2xx, malformed
   *  body) — distinct from a genuine "no active premium entitlement" result. Never counted as
   *  free-tier and never consumes an ask; the caller should retry. See index.ts's
   *  resolveEntitlementStatus. */
  | 'service_unavailable'
  /** A request with this exact `requestId` for this athlete is still being processed right now
   *  (claim_signal_request found a fresh, non-stale 'processing' row) — a genuinely concurrent
   *  duplicate, not a lost-response retry (that case returns the cached `available: true` result
   *  instead, never this reason). The caller should wait briefly and retry rather than firing a
   *  second concurrent attempt at the same question. See index.ts's claim_signal_request wiring. */
  | 'duplicate_in_flight';

export type SignalResponse<T> =
  | { available: true; data: T }
  | {
      available: false;
      reason: SignalUnavailableReason;
      /** A safe, truncated status/message string (e.g. "Anthropic 404: model not found") for
       *  developer diagnostics — never the API key, auth token, race payload, or screenshot data.
       *  The mobile client deliberately does not show this to the athlete (see lib/signal.ts /
       *  signal.tsx) — user-facing errors stay short and generic. */
      detail?: string;
    };

export interface SignalReplyPayload {
  reply: string;
  /** Asks left AFTER this one was consumed, and the cap it was measured against — 3 LIFETIME for
   *  free (never resets — migrations/0010_signal_free_lifetime_allowance.sql), 40 per current UTC
   *  calendar-month for premium (index.ts's currentMonthWindow()). Lets the mobile client render
   *  its usage strip without a second round-trip. */
  remaining: number;
  cap: number;
  isPremium: boolean;
}

/** Response of the read-only `usage` action: the same numbers a reply carries (`remaining`, `cap`, `isPremium`), read without
 *  reserving an ask or calling the model. */
export interface SignalUsagePayload {
  remaining: number;
  cap: number;
  isPremium: boolean;
}
