import type { Race, RaceResultDetail, SportCategory } from '@/fixtures/races';
import type { CandidateRace, RaceDetailPayload } from '@/lib/raceDiscovery';

/**
 * Sportstats' `rlbl` category label ("Olympic Triathlon", "10km", "Half Marathon", ...) doesn't
 * map onto a distinct sport field in its own data — this is a light, presentation-layer inference
 * so Races/Stats' sport filter has something meaningful to group by, not a claim about what
 * Sportstats itself asserts.
 *
 * Confirmed bug (live data): a category of bare "70.3" or "70.3 Results" (IRONMAN 70.3 Eagleman,
 * Gulf Coast, Victoria) contains neither "triathlon" nor a running keyword, so it fell through to
 * 'other' — hiding those races under the Triathlon filter and dropping their 70.3 PB/fastest-run
 * highlights from Triathlon Stats. "70.3" and "ironman" are unambiguous triathlon-distance/brand
 * tokens, so they're added here; this stays conservative — it does not touch "sprint" or bare
 * "olympic", which are genuinely ambiguous outside a triathlon-specific category string.
 *
 * One known category value gives no signal at all: Sportstats' generic "Overall Results" label
 * (IRONMAN 70.3 Syracuse's stored category) could belong to any race type, so it's not matched
 * here — `eventName` is checked as a narrow fallback instead, since "IRONMAN" in the event name
 * itself is just as unambiguous a brand signal as it is in a category string.
 */
export function inferSport(category: string, eventName: string): SportCategory {
  const compact = category.toLowerCase().replace(/\s/g, '');
  if (compact.includes('duathlon')) return 'duathlon';
  if (compact.includes('triathlon') || compact.includes('70.3') || compact.includes('ironman')) return 'triathlon';
  if (compact.includes('run') || compact.includes('5k') || compact.includes('10k') || compact.includes('marathon')) {
    return 'running';
  }
  if (eventName.toLowerCase().includes('ironman')) return 'triathlon';
  return 'other';
}

/** Shape of a row in Supabase's `races` table (snake_case, as returned by supabase-js). */
export interface RaceRow {
  id: string;
  athlete_id: string;
  import_status: 'candidate' | 'confirmed' | 'rejected' | 'removed';
  race_status: 'considering' | 'registered' | 'completed';
  provider: string;
  provider_result_id: string | null;
  source_url: string | null;
  import_method: string;
  source_notes: string[] | null;
  event_date: string | null; // 'YYYY-MM-DD' or null
  event_year: number;
  date_precision: 'day' | 'year';
  event_name: string;
  location: string | null;
  sport: string | null;
  category: string | null;
  finish_seconds: number | null;
  bib: string | null;
  overall_rank_place: number | null;
  overall_rank_field: number | null;
  gender_rank_place: number | null;
  gender_rank_field: number | null;
  age_group_rank_place: number | null;
  age_group_rank_field: number | null;
  age_group_category: string | null;
  splits: { label: string; splitSeconds?: number; totalSeconds: number; pace?: string }[] | null;
  checklist_completed: string[] | null;
  /** The provider's own recorded display name for whichever identity this race was matched under
   *  — distinct from athlete_profiles.racing_name, and never used to overwrite it. Null when the
   *  import path didn't have it on hand (e.g. a resumed draft after an interrupted sign-in). */
  provider_athlete_name: string | null;
}

/**
 * DB row -> the app's existing `Race` shape. This is the entire integration boundary — everything
 * downstream (lib/stats.ts, lib/highlights.ts, lib/format.ts, every screen/component) already
 * operates on `Race`/`RaceResultDetail` and needs no changes. `eventDate` is reconstructed here
 * from (event_date, event_year, date_precision) into the single string format those already
 * expect ('YYYY-MM-DD' or bare 'YYYY') — no fabricated day/month for a year-only record.
 */
export function dbRowToRace(row: RaceRow): Race {
  const eventDate = row.date_precision === 'day' && row.event_date ? row.event_date : String(row.event_year);

  const hasResult = row.race_status === 'completed' && row.finish_seconds != null;
  const result: RaceResultDetail | undefined = hasResult
    ? {
        finishSeconds: row.finish_seconds!,
        bib: row.bib ?? undefined,
        splits: (row.splits ?? []).map((split) => ({
          label: split.label,
          elapsedSeconds: split.splitSeconds ?? split.totalSeconds,
          paceLabel: split.pace,
        })),
        overallRank: row.overall_rank_place != null ? { place: row.overall_rank_place, field: row.overall_rank_field ?? undefined } : undefined,
        genderRank: row.gender_rank_place != null ? { place: row.gender_rank_place, field: row.gender_rank_field ?? undefined } : undefined,
        ageGroupRank:
          row.age_group_rank_place != null
            ? { place: row.age_group_rank_place, field: row.age_group_rank_field ?? undefined, ageGroup: row.age_group_category ?? undefined }
            : undefined,
        sourceStatus: row.provider === 'manual' ? 'self_reported' : 'imported_confirmed',
        sourceNotes: row.source_notes ?? undefined,
      }
    : undefined;

  return {
    id: row.id,
    name: row.event_name,
    sport: (row.sport as Race['sport']) ?? 'other',
    distanceLabel: row.category ?? '',
    eventDate,
    location: row.location ?? '',
    status: row.race_status,
    locked: false, // Premium gating is explicitly out of scope for B.1 — every persisted race is fully viewable
    isManual: row.provider === 'manual',
    result,
    checklistCompleted: row.checklist_completed ?? undefined,
  };
}

/** Builds an insertable row from a selected discovery candidate + its fetched detail — the shape
 *  `insertConfirmedRaces` writes through RLS after the athlete picks "Add N races". */
export function candidateDetailToInsertRow(
  athleteId: string,
  candidate: CandidateRace,
  detail: RaceDetailPayload,
  providerAthleteName?: string,
) {
  return {
    athlete_id: athleteId,
    import_status: 'confirmed' as const,
    race_status: 'completed' as const,
    provider: candidate.provider,
    provider_result_id: candidate.providerResultId,
    provider_athlete_name: providerAthleteName ?? null,
    source_url: candidate.sourceUrl,
    import_method: 'discovery_automated' as const,
    event_date: candidate.eventDate,
    event_year: candidate.eventYear,
    date_precision: 'day' as const, // Sportstats always gives a full date for its own results
    event_name: candidate.eventName,
    category: candidate.category,
    sport: inferSport(candidate.category, candidate.eventName),
    finish_seconds: detail.finishSeconds ?? null,
    bib: detail.bib ?? null,
    overall_rank_place: detail.overallRank?.place ?? null,
    overall_rank_field: detail.overallRank?.field ?? null,
    gender_rank_place: detail.genderRank?.place ?? null,
    gender_rank_field: detail.genderRank?.field ?? null,
    age_group_rank_place: detail.ageGroupRank?.place ?? null,
    age_group_rank_field: detail.ageGroupRank?.field ?? null,
    age_group_category: detail.ageGroupCategory ?? null,
    splits: detail.splits,
  };
}
