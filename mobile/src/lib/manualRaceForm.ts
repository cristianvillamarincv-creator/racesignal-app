import type { Race, SportCategory } from '@/fixtures/races';

/** A brand-new manual race starts with no sport chosen; editing an existing one preserves whatever
 *  sport it already has. Defaulting to Triathlon (the previous behavior) let an athlete type a
 *  free-text category like "10K" without ever touching the sport selector, producing a
 *  contradictory race (Triathlon + 10K). Kept as its own pure function — rather than inline in a
 *  `useState` initializer in mobile/src/app/race/add.tsx — specifically so this rule has direct
 *  regression coverage without needing to import that screen file itself (it transitively pulls in
 *  AsyncStorage via racesContext/auth/supabaseClient, which this project's Jest setup doesn't mock).
 */
export function initialSportForManualRace(editingRace: Race | undefined): SportCategory | null {
  return editingRace?.sport ?? null;
}

/** Save requires a non-empty event name AND an explicitly chosen sport — a contradictory race can
 *  no longer be saved with the sport silently left at a default. Exported for the same testability
 *  reason as `initialSportForManualRace` above. */
export function canSaveManualRace({
  eventName,
  sport,
  isSaving,
}: {
  eventName: string;
  sport: SportCategory | null;
  isSaving: boolean;
}): boolean {
  return eventName.trim().length > 0 && sport !== null && !isSaving;
}

/** Contextual examples for the free-text Distance/category field — guidance only, never inferred
 *  back into a sport selection. Cycling/Swimming/Duathlon/Other and the unselected state keep the
 *  existing generic treatment (no placeholder) since there's no established canonical example for
 *  them yet — this isn't inventing a new taxonomy, just reusing what already exists for Running and
 *  Triathlon (see highlights.ts's canonicalDistanceLabel alias table). */
export function categoryPlaceholderFor(sport: SportCategory | null): string | undefined {
  if (sport === 'running') return 'e.g. 5K, 10K, Half Marathon';
  if (sport === 'triathlon') return 'e.g. Sprint, Olympic, 70.3';
  return undefined;
}
