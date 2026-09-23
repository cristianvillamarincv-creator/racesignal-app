import { supabase } from '@/lib/supabaseClient';
import type { RaceRow } from '@/lib/raceMapping';

const RACE_COLUMNS =
  'id, athlete_id, import_status, race_status, provider, provider_result_id, provider_athlete_name, source_url, import_method, source_notes, event_date, event_year, date_precision, event_name, location, sport, category, finish_seconds, bib, overall_rank_place, overall_rank_field, gender_rank_place, gender_rank_field, age_group_rank_place, age_group_rank_field, age_group_category, splits, checklist_completed';

export async function fetchConfirmedRaces(athleteId: string): Promise<RaceRow[]> {
  const { data, error } = await supabase
    .from('races')
    .select(RACE_COLUMNS)
    .eq('athlete_id', athleteId)
    .eq('import_status', 'confirmed')
    .order('event_year', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as RaceRow[];
}

/**
 * Bulk-persists selected discovery candidates against three possible prior states for each
 * `provider_result_id`:
 *  - never seen before -> INSERT.
 *  - already `confirmed` -> skip (harmless no-op; re-running discovery and re-selecting an
 *    already-imported race must not fail the whole batch).
 *  - previously imported then `removed` (or `rejected`) -> UPDATE that same row back to
 *    `confirmed` with the freshly-fetched detail data, rather than inserting a new row. The
 *    duplicate-protection index (races_athlete_provider_result_uniq, migrations/0001_init.sql) is
 *    `unique (athlete_id, provider, provider_result_id)` with NO `import_status` filter, so a
 *    removed race's row permanently occupies that slot — a plain INSERT for it would violate the
 *    index, and the old pre-fix version of this function silently treated it as "already
 *    imported" and did nothing at all, so a removed provider race could never be brought back.
 *    Reviving with the fresh row also means a re-import always reflects the latest normalization
 *    (e.g. corrected splits), not stale data from whenever it was first imported.
 *
 * This still pre-filters with a SELECT rather than `upsert(..., {onConflict, ignoreDuplicates:
 * true})`: the index above is PARTIAL (`where provider_result_id is not null`, so manual entries
 * with a null id never collide with each other) — Postgres requires `ON CONFLICT (...) WHERE ...`
 * to target a partial index, and PostgREST's `onConflict` option has no way to express that
 * predicate, so a plain upsert against this index fails with "no unique or exclusion constraint
 * matching the ON CONFLICT specification." The partial index still backstops a genuine race
 * condition on the INSERT path — a 23505 there is caught and treated as a harmless duplicate, not
 * a hard failure.
 *
 * Returns every row actually persisted (inserted or revived) so callers can merge them straight
 * into in-memory state instead of triggering a full refetch (see racesContext.tsx).
 */
export async function insertConfirmedRaces(rows: Record<string, unknown>[]): Promise<RaceRow[]> {
  if (rows.length === 0) {
    console.warn('[db/races] insertConfirmedRaces called with an empty rows array — nothing to insert.');
    return [];
  }

  const athleteId = rows[0]!.athlete_id as string;
  const provider = rows[0]!.provider as string;
  const resultIds = rows.map((row) => row.provider_result_id as string);
  console.log('[db/races] insertConfirmedRaces:', rows.length, 'row(s) for athlete', athleteId, 'provider', provider);

  const { data: existing, error: selectError } = await supabase
    .from('races')
    .select('id, provider_result_id, import_status')
    .eq('athlete_id', athleteId)
    .eq('provider', provider)
    .in('provider_result_id', resultIds);
  if (selectError) {
    console.warn('[db/races] pre-insert duplicate-check SELECT failed:', selectError.message, selectError.code);
    throw selectError;
  }

  const existingByResultId = new Map(
    (existing ?? []).map((row) => [row.provider_result_id as string, row as { id: string; import_status: string }]),
  );

  const toInsert: Record<string, unknown>[] = [];
  const toRevive: { id: string; row: Record<string, unknown> }[] = [];
  let alreadyConfirmedCount = 0;

  for (const row of rows) {
    const match = existingByResultId.get(row.provider_result_id as string);
    if (!match) {
      toInsert.push(row);
    } else if (match.import_status === 'confirmed') {
      alreadyConfirmedCount += 1;
    } else {
      toRevive.push({ id: match.id, row: { ...row, import_status: 'confirmed' } });
    }
  }

  const persisted: RaceRow[] = [];

  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabase.from('races').insert(toInsert).select(RACE_COLUMNS);
    if (insertError && insertError.code !== '23505') {
      console.warn('[db/races] INSERT failed:', insertError.message, 'code=', insertError.code, 'details=', insertError.details, 'hint=', insertError.hint);
      throw insertError;
    }
    persisted.push(...((inserted ?? []) as unknown as RaceRow[]));
    console.log('[db/races] inserted', inserted?.length ?? 0, 'new row(s)');
  }

  for (const { id, row } of toRevive) {
    const { data: revived, error: reviveError } = await supabase.from('races').update(row).eq('id', id).select(RACE_COLUMNS).maybeSingle();
    if (reviveError) {
      console.warn('[db/races] reviving removed race', id, 'failed:', reviveError.message, reviveError.code);
      throw reviveError;
    }
    if (revived) persisted.push(revived as unknown as RaceRow);
  }
  if (toRevive.length > 0) console.log('[db/races] revived', toRevive.length, 'previously-removed row(s)');
  if (alreadyConfirmedCount > 0) console.log('[db/races]', alreadyConfirmedCount, 'row(s) were already confirmed — skipped.');

  return persisted;
}

export async function insertManualRace(row: Record<string, unknown>): Promise<RaceRow> {
  const { data, error } = await supabase.from('races').insert(row).select(RACE_COLUMNS).single();
  if (error) throw error;
  return data as unknown as RaceRow;
}

/** Only ever called for a `provider = 'manual'` row — imported races stay read-only (see
 *  Race.isManual) so the UI never offers this path for them, but this scopes the UPDATE by
 *  provider too as a second guard against editing an imported race by id alone. */
export async function updateManualRace(raceId: string, row: Record<string, unknown>): Promise<RaceRow> {
  const { data, error } = await supabase.from('races').update(row).eq('id', raceId).eq('provider', 'manual').select(RACE_COLUMNS).single();
  if (error) throw error;
  return data as unknown as RaceRow;
}

/** Only ever called for an upcoming race, which (per the import pipeline) is always
 *  `provider = 'manual'` — Sportstats imports are always completed results — but this still scopes
 *  by provider too, same defensive pattern as updateManualRace. */
export async function updateRaceChecklist(raceId: string, completedItemIds: string[]): Promise<RaceRow> {
  const { data, error } = await supabase
    .from('races')
    .update({ checklist_completed: completedItemIds })
    .eq('id', raceId)
    .eq('provider', 'manual')
    .select(RACE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as RaceRow;
}

export async function removeRace(raceId: string): Promise<void> {
  const { error } = await supabase
    .from('races')
    .update({ import_status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', raceId);
  if (error) throw error;
}

export async function upsertAthleteProfile(athleteId: string, racingName: string, birthYear?: number): Promise<void> {
  const { error } = await supabase
    .from('athlete_profiles')
    .upsert({ id: athleteId, racing_name: racingName, birth_year: birthYear ?? null }, { onConflict: 'id' });
  if (error) {
    console.warn('[db/races] athlete_profiles upsert failed:', error.message, error.code);
    throw error;
  }
}

/** Updates only birth_year — never racing_name, so a "Find My Races" search under a different
 *  name can never overwrite the athlete's primary/authoritative racing name. */
export async function updateAthleteBirthYearHint(athleteId: string, birthYear?: number): Promise<void> {
  if (birthYear === undefined) return;
  const { error } = await supabase.from('athlete_profiles').update({ birth_year: birthYear }).eq('id', athleteId);
  if (error) console.warn('[db/races] birth_year update failed:', error.message);
}

/**
 * The durable onboarding-complete signal (see migrations/0003_onboarding_completed_at.sql). Set
 * exactly once, at the end of OnboardingFlow's runImport — reaching that point (regardless of how
 * many races were actually saved; zero is a valid outcome) is what "onboarding genuinely
 * completed" means. Deliberately NOT inferred from athlete_profiles existing (a row can exist in
 * a broken/incomplete state — observed directly: an empty racing_name with zero races) or from
 * race count.
 */
export async function markOnboardingComplete(athleteId: string): Promise<void> {
  const { error } = await supabase
    .from('athlete_profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', athleteId);
  if (error) console.warn('[db/races] markOnboardingComplete failed:', error.message);
}

/** Read once at app launch to classify a signed-in athlete as done-with-onboarding or not. */
export async function fetchOnboardingCompletedAt(athleteId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('athlete_profiles')
    .select('onboarding_completed_at')
    .eq('id', athleteId)
    .maybeSingle();
  if (error) {
    console.warn('[db/races] fetchOnboardingCompletedAt failed:', error.message);
    return null;
  }
  return data?.onboarding_completed_at ?? null;
}

/** Existing confirmed provider_result_ids for one athlete/provider — used to mark discovery
 *  candidates "Already added" before the athlete can select them again. */
export async function fetchImportedProviderResultIds(athleteId: string, provider: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('races')
    .select('provider_result_id')
    .eq('athlete_id', athleteId)
    .eq('provider', provider)
    .eq('import_status', 'confirmed')
    .not('provider_result_id', 'is', null);
  if (error) {
    console.warn('[db/races] fetchImportedProviderResultIds failed:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.provider_result_id as string));
}
