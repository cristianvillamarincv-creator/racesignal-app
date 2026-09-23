import { createContext, useContext, useState, type ReactNode } from 'react';

import type { SportCategory } from '@/fixtures/races';

export const ALL_SPORTS = 'all' as const;
export const ALL_YEARS = 'all' as const;

interface RaceFilterContextValue {
  sportFilter: SportCategory | typeof ALL_SPORTS;
  setSportFilter: (sport: SportCategory | typeof ALL_SPORTS) => void;
  yearFilter: number | typeof ALL_YEARS;
  setYearFilter: (year: number | typeof ALL_YEARS) => void;
  /** Bumped by `requestSearchFocus` — the Races screen focuses its (local-only) search field on
   *  every change. A counter rather than a boolean so a second request while already on Races
   *  still refocuses instead of being a no-op state change. */
  searchFocusRequestId: number;
  requestSearchFocus: () => void;
}

const RaceFilterContext = createContext<RaceFilterContextValue | null>(null);

/**
 * Sport + year filter, shared between the Races and Stats tabs for the lifetime of the app
 * session only — plain in-memory React state, never persisted, so a cold launch always starts
 * back at "All sports" / "All years". Race-name search itself is intentionally NOT shared state:
 * it stays local to the Races screen — only a request to focus it (see `searchFocusRequestId`)
 * crosses tabs, for a header search entry point reachable from Stats without a second search
 * field living there.
 */
export function RaceFilterProvider({ children }: { children: ReactNode }) {
  const [sportFilter, setSportFilter] = useState<SportCategory | typeof ALL_SPORTS>(ALL_SPORTS);
  const [yearFilter, setYearFilter] = useState<number | typeof ALL_YEARS>(ALL_YEARS);
  const [searchFocusRequestId, setSearchFocusRequestId] = useState(0);
  const requestSearchFocus = () => setSearchFocusRequestId((id) => id + 1);

  return (
    <RaceFilterContext.Provider
      value={{ sportFilter, setSportFilter, yearFilter, setYearFilter, searchFocusRequestId, requestSearchFocus }}>
      {children}
    </RaceFilterContext.Provider>
  );
}

export function useRaceFilter(): RaceFilterContextValue {
  const context = useContext(RaceFilterContext);
  if (!context) {
    throw new Error('useRaceFilter must be used within a RaceFilterProvider');
  }
  return context;
}
