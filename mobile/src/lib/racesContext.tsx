import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { Race } from '@/fixtures/races';
import { useAuth } from '@/lib/auth';
import { fetchConfirmedRaces, insertManualRace, removeRace as removeRaceRow, updateManualRace } from '@/lib/db/races';
import { dbRowToRace, type RaceRow } from '@/lib/raceMapping';
import { supabase } from '@/lib/supabaseClient';

export interface ManualRaceInput {
  eventName: string;
  location?: string;
  sport: Race['sport'];
  category?: string;
  raceStatus: Race['status'];
  eventDate: string; // 'YYYY-MM-DD'
  finishSeconds?: number;
  bib?: string;
}

interface AthleteRacesContextValue {
  isLoading: boolean;
  isError: boolean;
  data: Race[];
  /** The name entered at onboarding — null until the profile row loads (or if signed out). Used
   *  in place of any hardcoded display name, since this app now has more than one real athlete. */
  racingName: string | null;
  refetch: () => void;
  removeRace: (raceId: string) => Promise<void>;
  addManualRace: (input: ManualRaceInput) => Promise<Race>;
  updateManualRace: (raceId: string, input: ManualRaceInput) => Promise<Race>;
  /** Merges freshly-inserted-or-revived provider rows (see db/races.ts's insertConfirmedRaces)
   *  straight into shared state — the discovery flows (onboarding, Find My Races) call this
   *  instead of `refetch()` so a successful import is reflected everywhere immediately, without
   *  waiting on a second round-trip. */
  applyImportedRaces: (rows: RaceRow[]) => void;
}

const AthleteRacesContext = createContext<AthleteRacesContextValue | null>(null);

/**
 * Single source of truth for the authenticated athlete's persisted races — replaces the A.3
 * fixture-driven `useFixtureData(racesPopulated, racesEmpty)`. Every screen that used to read
 * fixtures/races.ts directly now reads this context instead; lib/stats.ts, lib/highlights.ts,
 * lib/format.ts, lib/races.ts need no changes since this still hands them a plain `Race[]`.
 */
export function AthleteRacesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const athleteId = session?.user.id;

  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [data, setData] = useState<Race[]>([]);
  const [racingName, setRacingName] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!athleteId) {
      setData([]);
      setRacingName(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    fetchConfirmedRaces(athleteId)
      .then((rows) => {
        if (cancelled) return;
        setData(rows.map(dbRowToRace));
      })
      .catch(() => {
        if (!cancelled) setIsError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    supabase
      .from('athlete_profiles')
      .select('racing_name')
      .eq('id', athleteId)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (!cancelled) setRacingName(profile?.racing_name ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [athleteId, reloadToken]);

  const refetch = useCallback(() => setReloadToken((token) => token + 1), []);

  /** Merges rows into shared state by id — same id replaces in place (a revived provider race
   *  keeps its original id), anything else is appended. This is the shared source of truth every
   *  screen (Home/Season/Stats) reads via `data`, so a merge here is visible everywhere the moment
   *  it happens, with no dependency on a second fetch completing or on which tab is focused. */
  const mergeRaces = useCallback((races: Race[]) => {
    if (races.length === 0) return;
    setData((current) => {
      const byId = new Map(current.map((race) => [race.id, race]));
      for (const race of races) byId.set(race.id, race);
      return Array.from(byId.values());
    });
  }, []);

  const removeRace = useCallback(async (raceId: string) => {
    await removeRaceRow(raceId);
    setData((current) => current.filter((race) => race.id !== raceId));
  }, []);

  const addManualRace = useCallback(
    async (input: ManualRaceInput): Promise<Race> => {
      if (!athleteId) throw new Error('Cannot add a race while signed out.');
      const row = await insertManualRace({
        athlete_id: athleteId,
        import_status: 'confirmed',
        race_status: input.raceStatus,
        provider: 'manual',
        provider_result_id: null,
        source_url: null,
        import_method: 'manual_entry',
        event_date: input.eventDate,
        event_year: Number(input.eventDate.slice(0, 4)),
        date_precision: 'day',
        event_name: input.eventName,
        location: input.location ?? null,
        sport: input.sport,
        category: input.category ?? null,
        finish_seconds: input.finishSeconds ?? null,
        bib: input.bib ?? null,
      });
      const race = dbRowToRace(row);
      mergeRaces([race]);
      return race;
    },
    [athleteId, mergeRaces],
  );

  const updateManualRaceEntry = useCallback(
    async (raceId: string, input: ManualRaceInput): Promise<Race> => {
      const row = await updateManualRace(raceId, {
        race_status: input.raceStatus,
        event_date: input.eventDate,
        event_year: Number(input.eventDate.slice(0, 4)),
        event_name: input.eventName,
        location: input.location ?? null,
        sport: input.sport,
        category: input.category ?? null,
        finish_seconds: input.finishSeconds ?? null,
        bib: input.bib ?? null,
      });
      const race = dbRowToRace(row);
      mergeRaces([race]);
      return race;
    },
    [mergeRaces],
  );

  const applyImportedRaces = useCallback(
    (rows: RaceRow[]) => mergeRaces(rows.map(dbRowToRace)),
    [mergeRaces],
  );

  return (
    <AthleteRacesContext.Provider
      value={{
        isLoading,
        isError,
        data,
        racingName,
        refetch,
        removeRace,
        addManualRace,
        updateManualRace: updateManualRaceEntry,
        applyImportedRaces,
      }}>
      {children}
    </AthleteRacesContext.Provider>
  );
}

export function useAthleteRaces(): AthleteRacesContextValue {
  const context = useContext(AthleteRacesContext);
  if (!context) {
    throw new Error('useAthleteRaces must be used within an AthleteRacesProvider');
  }
  return context;
}
