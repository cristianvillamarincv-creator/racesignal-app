import React from 'react';
import { render } from '@testing-library/react-native';

import { RaceRow } from '@/components/races/RaceRow';
import { previewRaces } from '@/fixtures/previewRaces';

/**
 * Races and Stats are free. Developer Preview used to flag most sample races as "locked" (a lock icon and "full result is Premium"),
 * which no longer matches the app: no race carries a lock, and a row announces nothing about Premium.
 */
describe('no Premium race lock', () => {
  it('no preview race carries a locked flag', () => {
    expect(previewRaces.length).toBeGreaterThan(0);
    for (const race of previewRaces) expect('locked' in race).toBe(false);
  });

  it('a completed race row has no lock label or Premium wording, and keeps its distance label', async () => {
    const race = previewRaces.find((candidate) => candidate.status === 'completed')!;
    const ui = await render(<RaceRow race={race} primaryHighlight={undefined} onPress={() => {}} />);
    const json = JSON.stringify(ui.toJSON());
    expect(json).not.toMatch(/locked|Premium/i);
    expect(ui.getByText(race.distanceLabel)).toBeTruthy();
  });
});
