// Server-side source of the prediction basis: the athlete's own stored races, read here, run through the one shared
// calculation (racePrediction.ts). Nothing the client sends is ever used for a range, and when the stored races cannot
// be read the result says so ('unavailable') instead of pretending the athlete has no comparable history.

import { buildPredictionBases, type PredictionBasis, type PredictionRaceInput } from './racePrediction.ts';

export type SignalPredictionSection = { status: 'ok'; bases: PredictionBasis[] } | { status: 'unavailable' };

/** The columns the calculation needs, and nothing else (no ranks, splits, notes or bib). */
const PREDICTION_COLUMNS = 'id, event_name, sport, category, race_status, event_date, event_year, date_precision, finish_seconds';

export interface PredictionRaceRow {
  id: string;
  event_name: string;
  sport: string | null;
  category: string | null;
  race_status: string;
  event_date: string | null;
  event_year: number;
  date_precision: string;
  finish_seconds: number | null;
}

/** Same date reconstruction as the app's dbRowToRace: a full day only when the row has one, otherwise just the year. */
export function rowToPredictionRace(row: PredictionRaceRow): PredictionRaceInput {
  return {
    id: row.id,
    name: row.event_name,
    sport: row.sport ?? 'other',
    distanceLabel: row.category ?? '',
    eventDate: row.date_precision === 'day' && row.event_date ? row.event_date : String(row.event_year),
    status: row.race_status,
    finishSeconds: row.finish_seconds,
  };
}

/** Structural slice of the supabase-js client this module uses, so a test can pass a fake. */
export interface PredictionQueryClient {
  from(table: 'races'): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/** Today's date in UTC as `YYYY-MM-DD`. The window and the "not in the future" rule use the server's UTC date. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function loadPredictionSection(
  client: PredictionQueryClient,
  athleteId: string,
  seedRaceId: string | undefined,
  today: string = utcToday(),
): Promise<SignalPredictionSection> {
  try {
    const { data, error } = await client
      .from('races')
      .select(PREDICTION_COLUMNS)
      .eq('athlete_id', athleteId)
      .eq('import_status', 'confirmed');
    if (error || !Array.isArray(data)) {
      console.warn('[signal] race history could not be loaded for the prediction section —', error?.message ?? 'no data');
      return { status: 'unavailable' };
    }
    const races = (data as PredictionRaceRow[]).map(rowToPredictionRace);
    return { status: 'ok', bases: buildPredictionBases(races, today, seedRaceId) };
  } catch (err) {
    console.warn('[signal] race history load threw —', (err as Error).message);
    return { status: 'unavailable' };
  }
}
