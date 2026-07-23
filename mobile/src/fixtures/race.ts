export interface NextRace {
  id: string;
  name: string;
  sport: string;
  distanceLabel: string;
  eventDate: string;
  city: string;
  region: string;
  friendCount: number;
}

export const nextRacePopulated: NextRace = {
  id: 'muskoka-70-3',
  name: 'Muskoka 70.3',
  sport: 'triathlon',
  distanceLabel: '70.3',
  eventDate: '2026-09-02',
  city: 'Huntsville',
  region: 'Ontario',
  friendCount: 3,
};

export const nextRaceEmpty: NextRace | null = null;
