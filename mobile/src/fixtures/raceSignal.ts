/**
 * "Race Signal" — a motivational momentum summary, NOT a fitness/readiness/medical score.
 * Curated mock data per the product direction ("the value may be curated mock data rather than
 * calculated by a sophisticated algorithm... do not build a real scoring engine").
 */
export interface RaceSignalData {
  score: number;
  deltaLabel: string;
  momentumLabel: string;
}

export const raceSignalPopulated: RaceSignalData = {
  score: 82,
  deltaLabel: '↑ 6 this week',
  momentumLabel: 'Strong momentum',
};

export const raceSignalEmpty: RaceSignalData | null = null;
