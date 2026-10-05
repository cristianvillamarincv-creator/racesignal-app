import { racesPopulated, type Race } from '@/fixtures/races';

/**
 * `racesPopulated` (20 real, completed races transcribed from the athlete's actual history — see
 * races.ts) has zero upcoming/registered races, so Developer Preview adds exactly one synthetic
 * upcoming race on top of it — enough to exercise the Races tab's next-race hero, the countdown
 * card, upcoming Race Detail, and the Race Prep checklist without touching real account storage.
 * Comfortably ahead of "today" so the countdown reads well regardless of when preview is used.
 */
const SAMPLE_UPCOMING_RACE: Race = {
  id: 'preview-upcoming-race',
  name: 'IRONMAN 70.3 Muskoka',
  sport: 'triathlon',
  distanceLabel: '70.3',
  eventDate: '2027-06-13',
  location: 'Huntsville, ON, CAN',
  status: 'registered',
  isManual: true,
  checklistCompleted: [],
};

/**
 * Fixture data for Developer Preview's "Browse app with sample data" and "Replay onboarding
 * (simulated)" modes (see lib/devPreview.tsx, lib/previewRacesContext.tsx). This is the ONLY data
 * source for preview mode — never a real Supabase query — so it's safe to use on a physical device
 * with no account and no network dependency.
 */
export const previewRaces: Race[] = [...racesPopulated, SAMPLE_UPCOMING_RACE];
