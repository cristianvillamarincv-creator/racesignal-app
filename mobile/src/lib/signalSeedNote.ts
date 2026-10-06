import type { Race } from '@/fixtures/races';

/** The line under the Signal header saying what Signal already has. A race with a recorded result is "your <name> result";
 *  any other race (upcoming, or completed without a recorded result) has details only, not a result. */
export function seedNoteText(seedRace: Pick<Race, 'name' | 'result'> | undefined): string {
  if (!seedRace) return 'Signal has your full race history.';
  if (seedRace.result) return `Signal has your ${seedRace.name} result and your full race history.`;
  return 'Signal has your race details and your full race history.';
}
