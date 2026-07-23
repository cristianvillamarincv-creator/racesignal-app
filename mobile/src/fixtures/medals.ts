export interface MedalSplit {
  label: string;
  elapsedSeconds: number;
}

export interface MedalCard {
  id: string;
  name: string;
  sportLabel: string;
  eventDate: string;
  location: string;
  finishSeconds: number;
  tag: 'course_best' | 'distance_pr' | null;
  sourceStatus: 'official_confirmed' | 'imported_confirmed' | 'self_reported';
  locked: boolean;
  splits: MedalSplit[];
}

export interface MedalsSummary {
  totalFinishes: number;
  totalTriathlons: number;
  prCount: number;
  highlight: string;
}

export const medalsSummaryPopulated: MedalsSummary = {
  totalFinishes: 5,
  totalTriathlons: 3,
  prCount: 2,
  highlight: 'Muskoka 70.3 — course best 5:41:18',
};

export const medalsSummaryEmpty: MedalsSummary = {
  totalFinishes: 0,
  totalTriathlons: 0,
  prCount: 0,
  highlight: '',
};

// Newest first. Latest 3 are unlocked/expandable; older cards are shown locked (Premium),
// matching Mockup 5's free-plan boundary. Locked state is a plain field on the fixture —
// no config-driven entitlement system yet.
export const medalsPopulated: MedalCard[] = [
  {
    id: 'goodlife-half-marathon-2026',
    name: 'GoodLife Toronto Half Marathon',
    sportLabel: 'Half Marathon',
    eventDate: '2026-05-03',
    location: 'Toronto, ON',
    finishSeconds: 1 * 3600 + 36 * 60 + 18,
    tag: 'distance_pr',
    sourceStatus: 'imported_confirmed',
    locked: false,
    splits: [
      { label: '5K', elapsedSeconds: 22 * 60 + 40 },
      { label: '10K', elapsedSeconds: 45 * 60 + 32 },
      { label: 'Half', elapsedSeconds: 1 * 3600 + 36 * 60 + 18 },
    ],
  },
  {
    id: 'muskoka-70-3-2025',
    name: 'Muskoka 70.3',
    sportLabel: 'Triathlon — 70.3',
    eventDate: '2025-07-07',
    location: 'Huntsville, ON',
    finishSeconds: 5 * 3600 + 41 * 60 + 18,
    tag: 'course_best',
    sourceStatus: 'official_confirmed',
    locked: false,
    splits: [
      { label: 'Swim', elapsedSeconds: 34 * 60 + 12 },
      { label: 'T1', elapsedSeconds: 3 * 60 + 5 },
      { label: 'Bike', elapsedSeconds: 2 * 3600 + 42 * 60 + 10 },
      { label: 'T2', elapsedSeconds: 2 * 60 + 20 },
      { label: 'Run', elapsedSeconds: 2 * 3600 + 19 * 60 + 31 },
    ],
  },
  {
    id: 'toronto-triathlon-festival-2024',
    name: 'Toronto Triathlon Festival',
    sportLabel: 'Triathlon — Olympic',
    eventDate: '2024-07-21',
    location: 'Toronto, ON',
    finishSeconds: 2 * 3600 + 31 * 60 + 42,
    tag: 'distance_pr',
    sourceStatus: 'official_confirmed',
    locked: false,
    splits: [
      { label: 'Swim', elapsedSeconds: 18 * 60 + 4 },
      { label: 'T1', elapsedSeconds: 2 * 60 + 1 },
      { label: 'Bike', elapsedSeconds: 1 * 3600 + 12 * 60 + 40 },
      { label: 'T2', elapsedSeconds: 1 * 60 + 30 },
      { label: 'Run', elapsedSeconds: 57 * 60 + 27 },
    ],
  },
  {
    id: 'toronto-triathlon-festival-2023',
    name: 'Toronto Triathlon Festival',
    sportLabel: 'Triathlon — Sprint',
    eventDate: '2023-07-16',
    location: 'Toronto, ON',
    finishSeconds: 1 * 3600 + 22 * 60 + 15,
    tag: null,
    sourceStatus: 'self_reported',
    locked: true,
    splits: [],
  },
  {
    id: 'goodlife-10k-2022',
    name: 'GoodLife Toronto 10K',
    sportLabel: '10K',
    eventDate: '2022-05-01',
    location: 'Toronto, ON',
    finishSeconds: 48 * 60 + 55,
    tag: null,
    sourceStatus: 'self_reported',
    locked: true,
    splits: [],
  },
];

export const medalsEmpty: MedalCard[] = [];
