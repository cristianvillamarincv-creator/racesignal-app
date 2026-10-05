import type { Race } from '@/fixtures/races';
import { CHECKLIST_TEMPLATE } from '@/lib/checklistTemplate';
import { promptById } from '@/lib/notifications/prompts';
import { uncheckedRelevantItems } from '@/lib/notifications/relevance';

/**
 * What a notification carries (its `data`) and how a tap on it is validated and routed. Every tap is checked against the signed-in athlete
 * and the data as it is NOW: a notification for another account does nothing, a deleted or completed race falls back to the Races list, and an item
 * that has since been checked opens the checklist without highlighting anything.
 */
export const PAYLOAD_VERSION = 1;

export type TapPayload =
  | { v: 1; a: string; t: 'prep'; r: string; i?: string }
  | { v: 1; a: string; t: 'prep-list' }
  | { v: 1; a: string; t: 'between'; p: string };

export function parsePayload(data: unknown): TapPayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.v !== PAYLOAD_VERSION || typeof d.a !== 'string' || d.a.length === 0) return null;
  if (d.t === 'prep' && typeof d.r === 'string' && d.r.length > 0) {
    return { v: 1, a: d.a, t: 'prep', r: d.r, ...(typeof d.i === 'string' ? { i: d.i } : {}) };
  }
  if (d.t === 'prep-list') return { v: 1, a: d.a, t: 'prep-list' };
  if (d.t === 'between' && typeof d.p === 'string') return { v: 1, a: d.a, t: 'between', p: d.p };
  return null;
}

export type Destination =
  | { kind: 'none' }
  | { kind: 'race'; raceId: string; itemId: string | null }
  | { kind: 'races' }
  | { kind: 'signal'; promptId: string };

/** `expand` for a race with no item to highlight. */
export const PREP_EXPAND_ONLY = '1';

export function resolveDestination(payload: TapPayload | null, signedInAthleteId: string | null, races: Race[]): Destination {
  if (!payload || !signedInAthleteId || payload.a !== signedInAthleteId) return { kind: 'none' };
  if (payload.t === 'prep-list') return { kind: 'races' };
  if (payload.t === 'between') return promptById(payload.p) ? { kind: 'signal', promptId: payload.p } : { kind: 'none' };
  const race = races.find((candidate) => candidate.id === payload.r);
  if (!race || race.status === 'completed') return { kind: 'races' };
  const itemId =
    payload.i &&
    CHECKLIST_TEMPLATE.some((item) => item.id === payload.i) &&
    uncheckedRelevantItems(race.sport, race.checklistCompleted).some((item) => item.id === payload.i)
      ? payload.i
      : null;
  return { kind: 'race', raceId: race.id, itemId };
}

/** The route and params for a destination, or null for none. The Races list is the first tab. */
export function routeFor(destination: Destination): { pathname: string; params?: Record<string, string> } | null {
  switch (destination.kind) {
    case 'none':
      return null;
    case 'races':
      return { pathname: '/' };
    case 'race':
      return { pathname: '/race/[id]', params: { id: destination.raceId, prep: destination.itemId ?? PREP_EXPAND_ONLY } };
    case 'signal':
      return { pathname: '/signal', params: { starter: destination.promptId } };
  }
}
