import { readFileSync } from 'fs';
import { join } from 'path';

import * as mirror from '@/lib/racePrediction';

// The Edge Function derives every prediction basis from supabase/functions/signal/racePrediction.ts; the app mirrors it
// byte for byte only to decide which suggestions to show. If these differ, the app could suggest a question the server
// would answer differently.
const SOURCE = join(__dirname, '..', '..', 'supabase', 'functions', 'signal', 'racePrediction.ts');
const MIRROR = join(__dirname, '..', 'src', 'lib', 'racePrediction.ts');

describe('racePrediction mirror', () => {
  it('is byte-identical to the Edge Function source of truth', () => {
    const source = readFileSync(SOURCE, 'utf8');
    const copy = readFileSync(MIRROR, 'utf8');
    if (source !== copy) {
      throw new Error('mobile/src/lib/racePrediction.ts differs from supabase/functions/signal/racePrediction.ts. Edit the supabase copy, then run: cp supabase/functions/signal/racePrediction.ts mobile/src/lib/racePrediction.ts');
    }
    expect(copy).toBe(source);
  });

  it('has no imports, so it can be copied verbatim between the Deno and Expo projects', () => {
    expect(readFileSync(SOURCE, 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  it('behaves the same in the app: representative scenarios', () => {
    const done = (id: string, date: string, seconds: number | null, label = 'Olympic', sport = 'triathlon') => ({ id, name: id, sport, distanceLabel: label, eventDate: date, status: 'completed', finishSeconds: seconds });
    const target = { id: 't', name: 'T', sport: 'triathlon', distanceLabel: 'Olympic', eventDate: '2027-06-14', status: 'registered' };
    const today = '2026-10-05';

    const range = mirror.buildPredictionBasisFor([target, done('a', '2026-08-17', 9715), done('b', '2025-07-06', 10100)], 't', today);
    expect([range?.kind, range?.fastest?.finishText, range?.slowest?.finishText, range?.spreadText]).toEqual(['range', '2:41:55', '2:48:20', '6 minutes 25 seconds']);
    expect(mirror.buildPredictionBasisFor([target, done('a', '2026-08-17', 9715)], 't', today)?.kind).toBe('single');
    expect(mirror.buildPredictionBasisFor([target, done('a', '2023-08-17', 9715)], 't', today)?.kind).toBe('older_only');
    expect(mirror.buildPredictionBasisFor([target], 't', today)?.kind).toBe('none');
    expect(mirror.predictionDistanceKey('triathlon', 'Ironman')).toBeNull();
    expect(mirror.predictionDistanceKey('triathlon', 'Sprint')).toBeNull();
    expect(mirror.predictionDistanceKey('running', 'Half Marathon')).toBe('Half Marathon');
    expect(mirror.isPredictionSuggestionEligible([target, done('a', '2026-08-17', 9715), done('b', '2025-07-06', 10100)], 't', today)).toBe(true);
    expect(mirror.isPredictionSuggestionEligible([{ ...target, status: 'considering' }, done('a', '2026-08-17', 9715), done('b', '2025-07-06', 10100)], 't', today)).toBe(false);
  });

  it('recognizes every distance the existing PR grouping aliases, as the same canonical label', () => {
    // highlights.ts's alias table (observed real variants) must stay a subset of the prediction table, with the same label.
    const { canonicalDistanceLabel } = jest.requireActual('@/lib/highlights') as typeof import('@/lib/highlights');
    const cases: [string, string][] = [['running', '5k'], ['running', '5km'], ['running', '5 km'], ['running', '10k'], ['running', '10km'], ['triathlon', '70.3'], ['triathlon', '70.3 Results'], ['triathlon', 'Olympic'], ['triathlon', 'Olympic Triathlon']];
    for (const [sport, label] of cases) expect([label, mirror.predictionDistanceKey(sport, label)]).toEqual([label, canonicalDistanceLabel(label)]);
  });
});
