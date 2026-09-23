import { inferSport } from '@/lib/raceMapping';

describe('inferSport', () => {
  // Real-data regression: IRONMAN 70.3 Eagleman's stored category is bare "70.3" — this used to
  // fall through to 'other' since it contains neither "triathlon" nor a running keyword, hiding it
  // under the Triathlon filter and dropping its 70.3 PB from Triathlon Stats.
  it('classifies a bare "70.3" category as triathlon', () => {
    expect(inferSport('70.3', 'IRONMAN 70.3 Eagleman')).toBe('triathlon');
  });

  it('classifies "70.3 Results" as triathlon', () => {
    expect(inferSport('70.3 Results', 'Subaru IRONMAN 70.3 Victoria')).toBe('triathlon');
    expect(inferSport('70.3 Results', 'IRONMAN 70.3 Gulf Coast')).toBe('triathlon');
  });

  // A category alone can never resolve to 'other' when the race is really a 70.3/IRONMAN result —
  // this asserts the negative outcome the bug report was actually about.
  it('never classifies a real 70.3 result as "other"', () => {
    expect(inferSport('70.3', 'IRONMAN 70.3 Eagleman')).not.toBe('other');
    expect(inferSport('70.3 Results', 'Subaru IRONMAN 70.3 Victoria')).not.toBe('other');
  });

  // IRONMAN 70.3 Syracuse's stored category is Sportstats' generic "Overall Results" label, which
  // carries no distance/brand signal on its own — only the event name's "IRONMAN" saves it.
  it('falls back to the event name when the category gives no signal', () => {
    expect(inferSport('Overall Results', 'IRONMAN 70.3 Syracuse')).toBe('triathlon');
  });

  it('still classifies existing known categories correctly', () => {
    expect(inferSport('Olympic Triathlon', 'Wasaga Beach Triathlon')).toBe('triathlon');
    expect(inferSport('Sprint Triathlon', 'NIAGARA SUBARU TRIATHLON')).toBe('triathlon');
    expect(inferSport('10km', 'Under Armour 10K')).toBe('running');
    expect(inferSport('Half Marathon', 'Toronto Marathon')).toBe('running');
    expect(inferSport('Duathlon', 'Some Duathlon')).toBe('duathlon');
  });

  // Conservative on purpose: a category/event name with no triathlon-specific or running-specific
  // signal at all stays 'other' rather than being guessed at.
  it('leaves a genuinely unrecognized category as other', () => {
    expect(inferSport('Infinite Mile', 'Some Ultra Event')).toBe('other');
  });
});
