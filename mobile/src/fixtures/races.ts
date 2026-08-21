/**
 * Single consolidated race-history fixture. Replaces the old race.ts / season.ts / medals.ts
 * split — Home's next race, Season's upcoming/completed lists, Stats' race history and PRs, and
 * the onboarding recovery flow's "candidates" are all views over this one dataset, so the numbers
 * never disagree across tabs. See src/lib/races.ts and src/lib/stats.ts for derived views.
 */

export type SportCategory = 'triathlon' | 'running' | 'cycling' | 'swimming' | 'duathlon' | 'other';
export type RaceStatus = 'considering' | 'registered' | 'completed';

export interface RaceSplit {
  label: string;
  elapsedSeconds: number;
  /** Authored directly (e.g. "1:48/100m", "33.3 km/h avg") rather than computed from distance. */
  paceLabel?: string;
}

export interface RaceRank {
  place: number;
  field: number;
}

export interface RaceResultDetail {
  finishSeconds: number;
  splits: RaceSplit[];
  overallRank?: RaceRank;
  genderRank?: RaceRank;
  ageGroupRank?: RaceRank & { ageGroup: string };
  sourceStatus: 'official_confirmed' | 'imported_confirmed' | 'self_reported';
  /** This race is the athlete's fastest at this exact distanceLabel. */
  isDistancePR: boolean;
  /** This race is the athlete's fastest on this exact course (same race name). */
  isCourseBest: boolean;
  podium: boolean;
  /**
   * Curated highlight strings — authored directly rather than computed by a cross-race
   * comparison engine (this is mock data; the "engine" would just be us). Intentionally includes
   * highlights that are NOT the overall distance PR (e.g. a fast split in an otherwise ordinary
   * race), matching the product requirement that those still surface.
   */
  achievements: string[];
}

export interface Race {
  id: string;
  name: string;
  sport: SportCategory;
  distanceLabel: string;
  eventDate: string;
  location: string;
  status: RaceStatus;
  /** Gates the full result-detail view (Premium, visual-only — see results/[id].tsx). */
  locked: boolean;
  result?: RaceResultDetail;
}

const h = (hours: number, minutes: number, seconds: number) => hours * 3600 + minutes * 60 + seconds;

export const racesPopulated: Race[] = [
  // --- Upcoming ---
  {
    id: 'ironman-ottawa-2026',
    name: 'IRONMAN Ottawa',
    sport: 'triathlon',
    distanceLabel: 'IRONMAN',
    eventDate: '2026-10-02',
    location: 'Ottawa, ON',
    status: 'registered',
    locked: false,
  },
  {
    id: 'toronto-fall-10k-2026',
    name: 'Toronto Fall 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2026-11-01',
    location: 'Toronto, ON',
    status: 'considering',
    locked: false,
  },

  // --- Completed, newest first ---
  {
    id: 'goodlife-half-marathon-2026',
    name: 'GoodLife Toronto Half Marathon',
    sport: 'running',
    distanceLabel: 'Half Marathon',
    eventDate: '2026-05-03',
    location: 'Toronto, ON',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(1, 36, 18),
      splits: [
        { label: '5K', elapsedSeconds: h(0, 22, 40) },
        { label: '10K', elapsedSeconds: h(0, 45, 32) },
        { label: 'Half', elapsedSeconds: h(1, 36, 18), paceLabel: '4:34/km avg' },
      ],
      overallRank: { place: 210, field: 3400 },
      genderRank: { place: 165, field: 1600 },
      ageGroupRank: { place: 22, field: 210, ageGroup: 'M35-39' },
      sourceStatus: 'imported_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['Half Marathon PR'],
    },
  },
  {
    id: 'ironman-mont-tremblant-2025',
    name: 'IRONMAN Mont-Tremblant',
    sport: 'triathlon',
    distanceLabel: 'IRONMAN',
    eventDate: '2025-09-14',
    location: 'Mont-Tremblant, QC',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(11, 45, 45),
      splits: [
        { label: 'Swim', elapsedSeconds: h(1, 12, 40), paceLabel: '1:54/100m' },
        { label: 'T1', elapsedSeconds: h(0, 4, 10) },
        { label: 'Bike', elapsedSeconds: h(6, 5, 22), paceLabel: '29.6 km/h avg' },
        { label: 'T2', elapsedSeconds: h(0, 3, 45) },
        { label: 'Run', elapsedSeconds: h(4, 19, 48), paceLabel: '6:09/km avg' },
      ],
      overallRank: { place: 412, field: 1800 },
      genderRank: { place: 350, field: 1400 },
      ageGroupRank: { place: 18, field: 120, ageGroup: 'M35-39' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: true,
      podium: false,
      achievements: ['First full-distance finish', 'IRONMAN PR'],
    },
  },
  {
    id: 'muskoka-70-3-2025',
    name: 'Muskoka 70.3',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2025-07-07',
    location: 'Huntsville, ON',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(5, 41, 18),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 34, 12), paceLabel: '1:48/100m' },
        { label: 'T1', elapsedSeconds: h(0, 3, 5) },
        { label: 'Bike', elapsedSeconds: h(2, 42, 10), paceLabel: '33.3 km/h avg' },
        { label: 'T2', elapsedSeconds: h(0, 2, 20) },
        { label: 'Run', elapsedSeconds: h(2, 19, 31), paceLabel: '6:37/km avg' },
      ],
      overallRank: { place: 42, field: 850 },
      genderRank: { place: 38, field: 520 },
      ageGroupRank: { place: 3, field: 45, ageGroup: 'M35-39' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: true,
      podium: true,
      achievements: ['70.3 PR', 'Course best', 'Age-group podium'],
    },
  },
  {
    id: 'toronto-triathlon-festival-olympic-2024',
    name: 'Toronto Triathlon Festival',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2024-07-21',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 31, 42),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 18, 4) },
        { label: 'T1', elapsedSeconds: h(0, 2, 1) },
        { label: 'Bike', elapsedSeconds: h(1, 12, 40) },
        { label: 'T2', elapsedSeconds: h(0, 1, 30) },
        { label: 'Run', elapsedSeconds: h(0, 57, 27) },
      ],
      overallRank: { place: 88, field: 600 },
      genderRank: { place: 71, field: 340 },
      ageGroupRank: { place: 9, field: 60, ageGroup: 'M35-39' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['Olympic distance PR', '2nd-fastest run split (Olympic distance)'],
    },
  },
  {
    id: 'goodlife-10k-2024',
    name: 'GoodLife Toronto 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2024-05-05',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 44, 10),
      splits: [
        { label: '5K', elapsedSeconds: h(0, 21, 50) },
        { label: '10K', elapsedSeconds: h(0, 44, 10) },
      ],
      overallRank: { place: 140, field: 2100 },
      genderRank: { place: 110, field: 980 },
      ageGroupRank: { place: 12, field: 130, ageGroup: 'M35-39' },
      sourceStatus: 'imported_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['10K PR'],
    },
  },
  {
    id: 'toronto-triathlon-festival-sprint-2023',
    name: 'Toronto Triathlon Festival',
    sport: 'triathlon',
    distanceLabel: 'Sprint',
    eventDate: '2023-07-16',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(1, 22, 15),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 12, 10) },
        { label: 'T1', elapsedSeconds: h(0, 1, 30) },
        { label: 'Bike', elapsedSeconds: h(0, 38, 20) },
        { label: 'T2', elapsedSeconds: h(0, 1, 15) },
        { label: 'Run', elapsedSeconds: h(0, 29, 0) },
      ],
      overallRank: { place: 65, field: 480 },
      genderRank: { place: 52, field: 260 },
      ageGroupRank: { place: 6, field: 40, ageGroup: 'M30-34' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['Sprint distance PR', 'Fastest swim pace across all races'],
    },
  },
  {
    id: 'goodlife-10k-2022',
    name: 'GoodLife Toronto 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2022-05-01',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 48, 55),
      splits: [
        { label: '5K', elapsedSeconds: h(0, 23, 50) },
        { label: '10K', elapsedSeconds: h(0, 48, 55) },
      ],
      overallRank: { place: 260, field: 2000 },
      genderRank: { place: 190, field: 950 },
      ageGroupRank: { place: 2, field: 55, ageGroup: 'M30-34' },
      sourceStatus: 'self_reported',
      isDistancePR: false,
      isCourseBest: false,
      podium: true,
      achievements: ['Age-group podium'],
    },
  },
  {
    id: 'toronto-waterfront-marathon-2021',
    name: 'Scotiabank Toronto Waterfront Marathon',
    sport: 'running',
    distanceLabel: 'Marathon',
    eventDate: '2021-10-10',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(3, 58, 20),
      splits: [
        { label: '10K', elapsedSeconds: h(0, 55, 40) },
        { label: 'Half', elapsedSeconds: h(1, 57, 30) },
        { label: '30K', elapsedSeconds: h(2, 48, 10) },
        { label: 'Finish', elapsedSeconds: h(3, 58, 20) },
      ],
      overallRank: { place: 1800, field: 14000 },
      genderRank: { place: 1250, field: 6800 },
      ageGroupRank: { place: 140, field: 900, ageGroup: 'M30-34' },
      sourceStatus: 'official_confirmed',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['Marathon PR', 'Sub-4 marathon'],
    },
  },
  {
    id: 'barrie-sprint-triathlon-2021',
    name: 'Barrie Sprint Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Sprint',
    eventDate: '2021-08-15',
    location: 'Barrie, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(1, 35, 40),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 15, 40) },
        { label: 'T1', elapsedSeconds: h(0, 2, 30) },
        { label: 'Bike', elapsedSeconds: h(0, 42, 10) },
        { label: 'T2', elapsedSeconds: h(0, 2, 0) },
        { label: 'Run', elapsedSeconds: h(0, 33, 20) },
      ],
      overallRank: { place: 210, field: 340 },
      genderRank: { place: 130, field: 190 },
      ageGroupRank: { place: 22, field: 30, ageGroup: 'M30-34' },
      sourceStatus: 'self_reported',
      isDistancePR: false,
      isCourseBest: false,
      podium: false,
      achievements: ['First triathlon finish'],
    },
  },
  {
    id: 'milton-triathlon-2020',
    name: 'Milton Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2020-09-20',
    location: 'Milton, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 45, 15),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 19, 50) },
        { label: 'T1', elapsedSeconds: h(0, 2, 40) },
        { label: 'Bike', elapsedSeconds: h(1, 18, 20) },
        { label: 'T2', elapsedSeconds: h(0, 2, 10) },
        { label: 'Run', elapsedSeconds: h(1, 2, 15) },
      ],
      overallRank: { place: 190, field: 400 },
      genderRank: { place: 120, field: 220 },
      ageGroupRank: { place: 18, field: 32, ageGroup: 'M25-29' },
      sourceStatus: 'self_reported',
      isDistancePR: false,
      isCourseBest: false,
      podium: false,
      achievements: [],
    },
  },
  {
    id: 'turkey-trot-5k-2019',
    name: 'Toronto Turkey Trot',
    sport: 'running',
    distanceLabel: '5K',
    eventDate: '2019-06-16',
    location: 'Toronto, ON',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 24, 10),
      splits: [
        { label: '1K', elapsedSeconds: h(0, 4, 45) },
        { label: '5K', elapsedSeconds: h(0, 24, 10) },
      ],
      overallRank: { place: 320, field: 1500 },
      genderRank: { place: 210, field: 700 },
      ageGroupRank: { place: 28, field: 95, ageGroup: 'M25-29' },
      sourceStatus: 'self_reported',
      isDistancePR: true,
      isCourseBest: false,
      podium: false,
      achievements: ['5K PR'],
    },
  },
];

export const racesEmpty: Race[] = [];
