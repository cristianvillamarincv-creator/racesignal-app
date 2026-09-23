// Ported from spikes/race-recovery/src/sportstatsClient.ts (B.0, validated end-to-end against a
// real second athlete — see B0_FINDINGS.md). Same three public, unauthenticated Sportstats
// endpoints, same constraints: sequential, low-volume, no login, no CAPTCHA solving, no proxy
// rotation, stop immediately on anything that looks like a block/challenge.
//
// This file is the ONLY place Sportstats-specific request logic lives — per the B.1 architecture
// decision, nothing above this Edge Function's boundary knows these endpoints exist.

const USER_AGENT = 'RaceSignal-B1/0.1 (private beta; see repo owner for contact)';
const BLOCK_MARKERS = [
  'captcha',
  'verify you are human',
  'just a moment',
  'cf-browser-verification',
  'access denied',
  'attention required',
];

export interface ProviderBlocked {
  blocked: true;
  reason: string;
}

export function isBlocked(result: unknown): result is ProviderBlocked {
  return typeof result === 'object' && result !== null && (result as ProviderBlocked).blocked === true;
}

async function politeFetch(url: string): Promise<{ text: string } | ProviderBlocked> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
    });
  } catch (err) {
    return { blocked: true, reason: `network error: ${(err as Error).message}` };
  }

  if (response.status === 403 || response.status === 429 || response.status === 503) {
    return { blocked: true, reason: `HTTP ${response.status}` };
  }
  if (!response.ok) {
    return { blocked: true, reason: `HTTP ${response.status} (unexpected)` };
  }

  const text = await response.text();
  const lower = text.toLowerCase();
  if (BLOCK_MARKERS.some((marker) => lower.includes(marker))) {
    return { blocked: true, reason: 'response body matched a block/challenge marker' };
  }
  return { text };
}

export interface RawAthleteSearchResult {
  nid: string;
  dn: string;
  nc?: string;
}

export async function searchAthlete(name: string): Promise<RawAthleteSearchResult[] | ProviderBlocked> {
  const url = `https://public.sportstats.one/namesearch?dn=${encodeURIComponent(name)}&limitcount=30`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  try {
    return JSON.parse(result.text) as RawAthleteSearchResult[];
  } catch {
    return { blocked: true, reason: 'namesearch response was not valid JSON' };
  }
}

export async function fetchAthleteHistoryHtml(nid: string): Promise<string | ProviderBlocked> {
  const url = `https://sportstats.one/results/athlete/${encodeURIComponent(nid)}`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  return result.text;
}

export type RawSingleResult = Record<string, unknown>;

export async function fetchSingleResult(rid: string, pid: string): Promise<RawSingleResult | ProviderBlocked> {
  const url = `https://public.sportstats.one/getsingleresult?rid=${encodeURIComponent(rid)}&potype=pid&poid=${encodeURIComponent(pid)}`;
  const result = await politeFetch(url);
  if (isBlocked(result)) return result;
  try {
    return JSON.parse(result.text) as RawSingleResult;
  } catch {
    return { blocked: true, reason: 'getsingleresult response was not valid JSON' };
  }
}
