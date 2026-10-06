import type { Race } from '@/fixtures/races';
import { seedNoteText } from '@/lib/signalSeedNote';

const race = (overrides: Partial<Race>): Race => ({ id: 'r', name: 'Lakefront Olympic', sport: 'triathlon', distanceLabel: 'Olympic', eventDate: '2027-06-13', location: '', status: 'registered', ...overrides });

describe('seedNoteText: what Signal says it has for the opened race', () => {
  it('says "result" only for a race with a recorded result', () => {
    const done = race({ status: 'completed', result: { finishSeconds: 9715, splits: [], sourceStatus: 'self_reported' } });
    expect(seedNoteText(done)).toBe('Signal has your Lakefront Olympic result and your full race history.');
  });

  it('uses race details for an upcoming race (registered or considering) and for a completed race with no recorded result', () => {
    for (const status of ['registered', 'considering', 'completed'] as const) {
      expect(seedNoteText(race({ status }))).toBe('Signal has your race details and your full race history.');
    }
  });

  it('is the history-only line when no race is open', () => {
    expect(seedNoteText(undefined)).toBe('Signal has your full race history.');
  });
});
