import type { ProviderBlocked } from './types.js';

/**
 * Minimal client for Sportstats' PUBLIC, unauthenticated data surfaces only. All three endpoints
 * below were identified by observing what sportstats.one's OWN frontend calls while a human
 * browsed the public "Find Results" search and an athlete's result page — not reverse-engineered
 * against anything hidden, and none require a session/cookie/login:
 *
 *   1. https://public.sportstats.one/namesearch?dn={name}&limitcount=30
 *        -> name search. Returns [{ nid, dn, nc }, ...]. Lives on a dedicated "public." subdomain.
 *   2. https://sportstats.one/results/athlete/{nid}
 *        -> athlete candidate list. A normal HTML page; the full race list is embedded
 *           server-rendered as a JSON array (Next.js RSC payload) rather than needing JS
 *           execution to fetch client-side, so a plain GET is sufficient.
 *   3. https://public.sportstats.one/getsingleresult?rid={rid}&potype=pid&poid={pid}
 *        -> full result detail (bib, category, ranks, per-segment splits) for one athlete in one
 *           race, as JSON. Same public subdomain as (1).
 *
 * robots.txt for public.sportstats.one: none present (404). robots.txt for sportstats.one
 * disallows only /api/ — none of these three paths fall under it.
 *
 * Hard constraints (per B.0 approval):
 *   - sequential requests only, one in flight at a time, with a fixed delay between them
 *   - no retries, no backoff-and-retry, no proxy rotation, no CAPTCHA solving, no login
 *   - any response that looks like a block/challenge stops the run immediately, no fallback
 */

const REQUEST_DELAY_MS = 700;
const USER_AGENT = 'RaceSignal-B0-Spike/0.1 (research spike; see repo owner for contact)';

const BLOCK_MARKERS = [
  'captcha',
  'verify you are human',
  'just a moment',
  'cf-browser-verification',
  'access denied',
  'attention required',
];

export function isBlocked(result: unknown): result is ProviderBlocked {
  return typeof result === 'object' && result !== null && (result as ProviderBlocked).blocked === true;
}

let lastRequestAt = 0;

async function politeFetch(url: string): Promise<{ status: number; text: string } | ProviderBlocked> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });
  } catch (err) {
    return { blocked: true, reason: `network error: ${(err as Error).message}`, url };
  }

  if (response.status === 403 || response.status === 429 || response.status === 503) {
    return { blocked: true, reason: `HTTP ${response.status}`, httpStatus: response.status, url };
  }
  if (!response.ok) {
    return { blocked: true, reason: `HTTP ${response.status} (unexpected)`, httpStatus: response.status, url };
  }

  const text = await response.text();
  const lower = text.toLowerCase();
  if (BLOCK_MARKERS.some((marker) => lower.includes(marker))) {
    return { blocked: true, reason: 'response body matched a block/challenge marker', url };
  }

  return { status: response.status, text };
}

export interface AthleteSearchResult {
  nid: string;
  dn: string;
  nc?: string;
}

export async function searchAthlete(name: string): Promise<AthleteSearchResult[] | ProviderBlocked> {
  const url = `https://public.sportstats.one/namesearch?dn=${encodeURIComponent(name)}&limitcount=30`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  try {
    return JSON.parse(result.text) as AthleteSearchResult[];
  } catch {
    return { blocked: true, reason: 'namesearch response was not valid JSON', url };
  }
}

export async function fetchAthleteHistoryHtml(nid: string): Promise<string | ProviderBlocked> {
  const url = `https://sportstats.one/results/athlete/${encodeURIComponent(nid)}`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  return result.text;
}

/** Raw shape of a single getsingleresult response — kept loose/`unknown`-heavy since it's an
 *  undocumented internal API; normalize.ts is responsible for defensively reading out of it. */
export type RawSingleResult = Record<string, unknown>;

export async function fetchSingleResult(
  rid: string,
  pid: string,
): Promise<RawSingleResult | ProviderBlocked> {
  const url = `https://public.sportstats.one/getsingleresult?rid=${encodeURIComponent(rid)}&potype=pid&poid=${encodeURIComponent(pid)}`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  try {
    return JSON.parse(result.text) as RawSingleResult;
  } catch {
    return { blocked: true, reason: 'getsingleresult response was not valid JSON', url } as ProviderBlocked;
  }
}
