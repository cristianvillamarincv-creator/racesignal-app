import { useCallback, useState, type ReactNode } from 'react';

import type { Race } from '@/fixtures/races';
import { previewRaces } from '@/fixtures/previewRaces';
import { dbRowToRace, type RaceRow } from '@/lib/raceMapping';
import { AthleteRacesContext, type AthleteRacesContextValue, type ManualRaceInput } from '@/lib/racesContext';

function generatePreviewRaceId(): string {
  return `preview-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds a `RaceRow`-shaped object for a manual add/edit and runs it through the same
 *  `dbRowToRace` mapper the real provider uses — this keeps the preview's manual-race shape
 *  byte-for-byte consistent with what the real app produces, without duplicating that mapping
 *  logic or touching `lib/db/races.ts`. */
function manualInputToRow(id: string, input: ManualRaceInput): RaceRow {
  return {
    id,
    athlete_id: 'preview-athlete',
    import_status: 'confirmed',
    race_status: input.raceStatus,
    provider: 'manual',
    provider_result_id: null,
    source_url: null,
    import_method: 'manual_entry',
    source_notes: null,
    event_date: input.eventDate,
    event_year: Number(input.eventDate.slice(0, 4)),
    date_precision: 'day',
    event_name: input.eventName,
    location: input.location ?? null,
    sport: input.sport,
    category: input.category ?? null,
    finish_seconds: input.finishSeconds ?? null,
    bib: input.bib ?? null,
    overall_rank_place: null,
    overall_rank_field: null,
    gender_rank_place: null,
    gender_rank_field: null,
    age_group_rank_place: null,
    age_group_rank_field: null,
    age_group_category: null,
    splits: null,
    checklist_completed: null,
    provider_athlete_name: null,
  };
}

/**
 * Supplies the SAME `AthleteRacesContext` (racesContext.tsx) the real `AthleteRacesProvider`
 * supplies, but backed entirely by in-memory React state seeded from the `previewRaces` fixture.
 * This NEVER calls anything in `lib/db/races.ts`, never touches Supabase, and never holds a real
 * session — every mutation below only ever updates local component state. Because it's the exact
 * same context, every real screen that reads `useAthleteRaces()` (Races tab, Stats tab, upcoming
 * Race Detail, Result Detail, Signal, RacePrepChecklist) works completely unmodified when mounted
 * under this provider instead of the real one — see _layout.tsx's Developer Preview branch.
 *
 * Mutation logic mirrors the real provider's `mergeRaces`-by-id approach (racesContext.tsx) for
 * consistency, but operates purely on local state.
 */
export function PreviewAthleteRacesProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Race[]>(previewRaces);

  const mergeRaces = useCallback((races: Race[]) => {
    if (races.length === 0) return;
    setData((current) => {
      const byId = new Map(current.map((race) => [race.id, race]));
      for (const race of races) byId.set(race.id, race);
      return Array.from(byId.values());
    });
  }, []);

  const refetch = useCallback(() => {
    // No real query to re-run in preview mode — a no-op, present only for interface conformance.
  }, []);

  const removeRace = useCallback(async (raceId: string) => {
    setData((current) => current.filter((race) => race.id !== raceId));
  }, []);

  const addManualRace = useCallback(
    async (input: ManualRaceInput): Promise<Race> => {
      const row = manualInputToRow(generatePreviewRaceId(), input);
      const race = dbRowToRace(row);
      mergeRaces([race]);
      return race;
    },
    [mergeRaces],
  );

  const updateManualRaceEntry = useCallback(
    async (raceId: string, input: ManualRaceInput): Promise<Race> => {
      const row = manualInputToRow(raceId, input);
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

  const setChecklistCompleted = useCallback(async (raceId: string, completedItemIds: string[]) => {
    setData((current) =>
      current.map((race) => (race.id === raceId ? { ...race, checklistCompleted: completedItemIds } : race)),
    );
  }, []);

  const value: AthleteRacesContextValue = {
    isLoading: false,
    isError: false,
    data,
    racingName: 'Preview Athlete',
    refetch,
    removeRace,
    addManualRace,
    updateManualRace: updateManualRaceEntry,
    applyImportedRaces,
    setChecklistCompleted,
  };

  return <AthleteRacesContext.Provider value={value}>{children}</AthleteRacesContext.Provider>;
}
