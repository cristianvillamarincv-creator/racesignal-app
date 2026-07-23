export type SeasonSportFilter =
  | 'all'
  | 'triathlon'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'duathlon'
  | 'other';

export interface SeasonRace {
  id: string;
  name: string;
  sport: Exclude<SeasonSportFilter, 'all'>;
  distanceLabel: string;
  eventDate: string;
  location: string;
  status: 'considering' | 'registered' | 'completed' | 'dns' | 'dnf';
}

export const mySeasonUpcomingPopulated: SeasonRace[] = [
  {
    id: 'muskoka-70-3',
    name: 'Muskoka 70.3',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2026-09-02',
    location: 'Huntsville, ON',
    status: 'registered',
  },
  {
    id: 'toronto-fall-10k',
    name: 'Toronto Fall 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2026-10-18',
    location: 'Toronto, ON',
    status: 'considering',
  },
];

export const mySeasonCompletedPopulated: SeasonRace[] = [
  {
    id: 'goodlife-half-marathon-2026',
    name: 'GoodLife Toronto Half Marathon',
    sport: 'running',
    distanceLabel: 'Half Marathon',
    eventDate: '2026-05-03',
    location: 'Toronto, ON',
    status: 'completed',
  },
];

export const mySeasonUpcomingEmpty: SeasonRace[] = [];
export const mySeasonCompletedEmpty: SeasonRace[] = [];

export interface FriendSeasonMember {
  name: string;
  status: 'considering' | 'registered';
}

export interface FriendSeasonEntry {
  raceId: string;
  raceName: string;
  eventDate: string;
  location: string;
  members: FriendSeasonMember[];
}

export const friendsSeasonPopulated: FriendSeasonEntry[] = [
  {
    raceId: 'muskoka-70-3',
    raceName: 'Muskoka 70.3',
    eventDate: '2026-09-02',
    location: 'Huntsville, ON',
    members: [
      { name: 'James', status: 'registered' },
      { name: 'Mike', status: 'considering' },
    ],
  },
  {
    raceId: 'ottawa-race-weekend',
    raceName: 'Ottawa Race Weekend',
    eventDate: '2026-05-24',
    location: 'Ottawa, ON',
    members: [{ name: 'Alanna', status: 'registered' }],
  },
];

export const friendsSeasonEmpty: FriendSeasonEntry[] = [];

export interface SeasonYearOption {
  year: number;
  locked: boolean;
}

export const seasonYears: SeasonYearOption[] = [
  { year: 2026, locked: false },
  { year: 2025, locked: true },
  { year: 2024, locked: true },
];
