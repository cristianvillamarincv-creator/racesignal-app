/**
 * Single consolidated race-history fixture — now the athlete's REAL race history, transcribed
 * from "Cristian Races (Wabi Sabi).md". Nothing here is invented: missing times, ranks, field
 * sizes, dates, and splits are left absent rather than guessed, and anything ambiguous in the
 * source is preserved via `sourceNotes` rather than silently resolved. See the A.3 plan for the
 * full data-normalization writeup.
 *
 * Home's next race, Season's upcoming/completed lists, Stats' race history/PRs, and onboarding's
 * recovered-race summary are all views over this one dataset. Achievements/PR status are
 * COMPUTED from this data (see src/lib/highlights.ts), not authored here — with real numbers,
 * hand-authoring a "PR" label risks it silently going stale or disagreeing with the numbers.
 */

export type SportCategory = 'triathlon' | 'running' | 'cycling' | 'swimming' | 'duathlon' | 'other';
export type RaceStatus = 'considering' | 'registered' | 'completed';

export interface RaceSplit {
  label: string;
  elapsedSeconds: number;
  /** Preserved verbatim from the source (e.g. two ambiguous pace figures), not computed. */
  paceLabel?: string;
}

export interface RaceRank {
  place: number;
  /** Absent when the source only gives a placement with no field size (e.g. "AG: 33"). */
  field?: number;
}

export interface RaceResultDetail {
  finishSeconds: number;
  splits: RaceSplit[];
  overallRank?: RaceRank;
  genderRank?: RaceRank;
  /** The source never states an age-group bracket (e.g. "M35-39") — `ageGroup` stays absent. */
  ageGroupRank?: RaceRank & { ageGroup?: string };
  sourceStatus: 'official_confirmed' | 'imported_confirmed' | 'self_reported';
  /** Literal preserved notes: weather, injury, source annotations, data-quality caveats. */
  sourceNotes?: string[];
  /** Source gave no usable rank data at all for this race (e.g. "AS KALIL"). Never fabricate. */
  needsConfirmation?: boolean;
  /** This race's rank numbers look internally inconsistent in the source. Preserved as given,
   *  but excluded from every computed percentile/aggregate ranking calculation until corrected. */
  rankingNeedsConfirmation?: boolean;
}

export interface Race {
  id: string;
  name: string;
  sport: SportCategory;
  distanceLabel: string;
  /** Full `YYYY-MM-DD`, or a bare `YYYY` when the source only records the year. */
  eventDate: string;
  location: string;
  status: RaceStatus;
  /** Gates the full result-detail view (Premium, visual-only — see results/[id].tsx). */
  locked: boolean;
  result?: RaceResultDetail;
}

const h = (hours: number, minutes: number, seconds: number) => hours * 3600 + minutes * 60 + seconds;

export const racesPopulated: Race[] = [
  // --- 70.3 (IRONMANS section, standard 1.9K/90K/21K only — Kingston below is a custom distance) ---
  {
    id: 'ironman-70-3-syracuse-2018',
    name: 'IRONMAN 70.3 Syracuse',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2018',
    location: 'Syracuse',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(6, 36, 45),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 39, 52), paceLabel: '2:03/100m' },
        { label: 'Bike', elapsedSeconds: h(3, 22, 18) },
        { label: 'Run', elapsedSeconds: h(2, 21, 59) },
      ],
      overallRank: { place: 535 },
      genderRank: { place: 427 },
      ageGroupRank: { place: 55 },
      sourceStatus: 'self_reported',
      sourceNotes: [
        'Exact event date not recorded in source — year only.',
        'Location recorded as "Syracuse" only; state/country not specified in source.',
      ],
    },
  },
  {
    id: 'ironman-70-3-gulf-coast-2019',
    name: 'IRONMAN 70.3 Gulf Coast',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2019-05-11',
    location: 'Panama City Beach, FL, USA',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(5, 32, 11),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 45, 29) },
        { label: 'Bike', elapsedSeconds: h(2, 41, 27), paceLabel: '33.5 km/h avg' },
        { label: 'Run', elapsedSeconds: h(1, 57, 39), paceLabel: '5:34.8/km' },
      ],
      overallRank: { place: 256 },
      genderRank: { place: 201 },
      ageGroupRank: { place: 40 },
      sourceStatus: 'self_reported',
    },
  },
  {
    id: 'ironman-70-3-victoria-2022',
    name: 'IRONMAN 70.3 Victoria',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2022-05-29',
    location: 'Victoria, BC, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(5, 44, 5),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 39, 56) },
        { label: 'Bike', elapsedSeconds: h(2, 59, 0) },
        { label: 'Run', elapsedSeconds: h(1, 54, 6) },
      ],
      overallRank: { place: 530 },
      genderRank: { place: 530 },
      ageGroupRank: { place: 83 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source lists Overall and Men placements as the same number (530); preserved as given.'],
    },
  },
  {
    id: 'ironman-70-3-eagleman-2026',
    name: 'IRONMAN 70.3 Eagleman',
    sport: 'triathlon',
    distanceLabel: '70.3',
    eventDate: '2026-06-14',
    location: 'Cambridge, MD, USA',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(4, 54, 58),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 39, 39) },
        { label: 'Bike', elapsedSeconds: h(2, 29, 29), paceLabel: '36.4 km/h avg' },
        { label: 'Run', elapsedSeconds: h(1, 37, 34), paceLabel: '4:39/km avg' },
      ],
      overallRank: { place: 108, field: 2421 },
      genderRank: { place: 97, field: 1601 },
      ageGroupRank: { place: 14, field: 205 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source swim time recorded as "00:39:39k" — trailing character treated as a typo, not a unit.'],
    },
  },

  // --- Custom distance, explicitly excluded from the 70.3/Olympic comparison pools ---
  {
    id: 'kingston-multisport-2024',
    name: 'MultiSport Canada Triathlon Series — K-Town/Kingston',
    sport: 'triathlon',
    distanceLabel: 'Custom — 2K/55K/15K',
    eventDate: '2024-07-28',
    location: 'Kingston, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(4, 6, 9),
      splits: [
        { label: 'Swim (2K)', elapsedSeconds: h(0, 48, 4) },
        { label: 'Bike (55K)', elapsedSeconds: h(1, 45, 59) },
        { label: 'Run (15K)', elapsedSeconds: h(1, 22, 56) },
      ],
      overallRank: { place: 83 },
      genderRank: { place: 65 },
      ageGroupRank: { place: 11 },
      sourceStatus: 'self_reported',
      sourceNotes: [
        'Non-standard distance (2K swim / 55K bike / 15K run) — excluded from Olympic/70.3 personal-best comparisons.',
      ],
    },
  },

  // --- Olympic (1.5K/40K/10K per source section header) ---
  {
    id: 'gravenhurst-triathlon-2021',
    name: 'MultiSport Canada Gravenhurst Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2021-09-11',
    location: 'Gravenhurst, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 30, 49),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 33, 59) },
        { label: 'Bike', elapsedSeconds: h(1, 10, 30), paceLabel: '34.0 km/h avg' },
        { label: 'Run', elapsedSeconds: h(0, 41, 58), paceLabel: '4:12/km' },
      ],
      overallRank: { place: 41 },
      genderRank: { place: 37 },
      ageGroupRank: { place: 8 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source labeled this race "PR #2" — exact meaning not specified.'],
    },
  },
  {
    id: 'wasaga-beach-triathlon-2022',
    name: 'MultiSport Canada Triathlon Series — Wasaga Beach',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2022-08-27',
    location: 'Wasaga Beach, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 32, 25),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 30, 22), paceLabel: '2:01/100m' },
        { label: 'Bike', elapsedSeconds: h(1, 11, 37) },
        { label: 'Run', elapsedSeconds: h(0, 46, 16) },
      ],
      overallRank: { place: 50 },
      genderRank: { place: 39 },
      ageGroupRank: { place: 10 },
      sourceStatus: 'self_reported',
    },
  },
  {
    id: 'wasaga-beach-triathlon-2024',
    name: 'MultiSport Canada Triathlon Series — Wasaga Beach',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2024-08-27',
    location: 'Wasaga Beach, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 51, 48),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 39, 0) },
        { label: 'Bike', elapsedSeconds: h(1, 14, 25) },
        { label: 'Run', elapsedSeconds: h(0, 51, 4) },
      ],
      overallRank: { place: 191 },
      genderRank: { place: 145 },
      ageGroupRank: { place: 17 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source note: "Post injury."'],
    },
  },
  {
    id: 'rose-city-welland-triathlon-2025',
    name: 'MultiSport Canada Triathlon Series — Rose City',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2025-06-21',
    location: 'Welland, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 45, 29),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 33, 27) },
        { label: 'Bike', elapsedSeconds: h(1, 18, 24) },
        { label: 'Run', elapsedSeconds: h(0, 48, 38) },
      ],
      overallRank: { place: 91 },
      genderRank: { place: 74 },
      ageGroupRank: { place: 9 },
      sourceStatus: 'self_reported',
    },
  },
  {
    id: 'bracebridge-triathlon-2025',
    name: 'Bracebridge Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2025-07-12',
    location: 'Bracebridge, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 47, 14),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 34, 33) },
        { label: 'Bike', elapsedSeconds: h(1, 20, 0) },
        { label: 'Run', elapsedSeconds: h(0, 48, 15) },
      ],
      overallRank: { place: 24 },
      genderRank: { place: 19 },
      ageGroupRank: { place: 2 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source note: "+30 degrees weather."'],
    },
  },
  {
    id: 'wasaga-beach-triathlon-2025',
    name: 'MultiSport Canada Triathlon Series — Wasaga Beach',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2025-08-23',
    location: 'Wasaga Beach, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 30, 59),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 28, 29) },
        { label: 'Bike', elapsedSeconds: h(1, 12, 7) },
        { label: 'Run', elapsedSeconds: h(0, 45, 43) },
      ],
      overallRank: { place: 56, field: 339 },
      genderRank: { place: 46 },
      ageGroupRank: { place: 10 },
      sourceStatus: 'self_reported',
      sourceNotes: [
        'Overall field size (339) matches Niagara Falls Barrelman (Sep 14, 2025) exactly — possible copy/paste artifact in source; preserved as given for both races.',
      ],
    },
  },
  {
    id: 'niagara-falls-barrelman-2025',
    name: 'Niagara Falls Barrelman Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2025-09-14',
    location: 'Niagara Falls, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(2, 30, 43),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 30, 23) },
        { label: 'Bike', elapsedSeconds: h(1, 14, 14) },
        { label: 'Run', elapsedSeconds: h(0, 41, 27), paceLabel: '4:08.4/km' },
      ],
      overallRank: { place: 56, field: 339 },
      genderRank: { place: 17, field: 114 },
      ageGroupRank: { place: 5, field: 17 },
      sourceStatus: 'self_reported',
      sourceNotes: [
        'Source labeled this race "PR."',
        'Event name ("Barrelman") suggests a possibly non-standard distance; source groups it under Olympic (1.5K/40K/10K) with no distance breakdown given — classification is source-derived, not independently confirmed.',
        'Overall field size (339) matches Wasaga Beach Aug 23, 2025 exactly — possible copy/paste artifact in source; preserved as given for both races.',
      ],
    },
  },
  {
    id: 'bracebridge-triathlon-2026',
    name: 'Bracebridge Triathlon',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2026-07-11',
    location: 'Bracebridge, ON, CAN',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(2, 31, 45),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 30, 46) },
        { label: 'Bike', elapsedSeconds: h(1, 16, 46) },
        { label: 'Run', elapsedSeconds: h(0, 40, 56) },
      ],
      overallRank: { place: 12, field: 264 },
      genderRank: { place: 10, field: 177 },
      ageGroupRank: { place: 2, field: 24 },
      sourceStatus: 'self_reported',
    },
  },
  {
    id: 'supertri-toronto-2026',
    name: 'Supertri Toronto',
    sport: 'triathlon',
    distanceLabel: 'Olympic',
    eventDate: '2026-07-26',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(2, 35, 7),
      splits: [
        { label: 'Swim', elapsedSeconds: h(0, 36, 10) },
        { label: 'Bike', elapsedSeconds: h(1, 10, 47) },
        { label: 'Run', elapsedSeconds: h(0, 38, 57), paceLabel: '4:03/km' },
      ],
      sourceStatus: 'self_reported',
      needsConfirmation: true,
      sourceNotes: [
        'Source rank field contains "AS KALIL" instead of Overall/Men/AG numbers — meaning unclear; no ranking data available for this race.',
        'Event name ("Supertri") suggests a possibly non-standard/shortened distance; source groups it under Olympic (1.5K/40K/10K) with no distance breakdown given — classification is source-derived, not independently confirmed.',
      ],
    },
  },

  // --- Half Marathon ---
  {
    id: 'toronto-marathon-half-2023',
    name: 'Toronto Marathon',
    sport: 'running',
    distanceLabel: 'Half Marathon',
    eventDate: '2023-05-07',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(1, 30, 16),
      splits: [],
      overallRank: { place: 18, field: 201 },
      genderRank: { place: 127 },
      ageGroupRank: { place: 33 },
      sourceStatus: 'self_reported',
      rankingNeedsConfirmation: true,
      sourceNotes: [
        'Source pace figures: 4:14.4/km, 4:16.8/km (segment not specified).',
        'Source labeled this race "PR."',
        'Ranking fields appear internally inconsistent (Overall 18/201 implies a much stronger result than Men 127th or AG 33rd would suggest) — preserved as given; excluded from percentile calculations pending confirmation.',
      ],
    },
  },
  {
    id: 'toronto-marathon-half-2026',
    name: 'Toronto Marathon',
    sport: 'running',
    distanceLabel: 'Half Marathon',
    eventDate: '2026-05-03',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: false,
    result: {
      finishSeconds: h(1, 26, 56),
      splits: [{ label: 'Half', elapsedSeconds: h(1, 26, 56), paceLabel: '4:07/km' }],
      overallRank: { place: 139, field: 10576 },
      genderRank: { place: 129, field: 5835 },
      ageGroupRank: { place: 17, field: 704 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source labeled this race "PR."'],
    },
  },

  // --- 10K (includes the Sporting Life 10K's own 5K split — see sourceNotes) ---
  {
    id: 'sporting-life-10k-2024',
    name: 'Sporting Life 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2024-05-12',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 44, 26),
      splits: [
        { label: '5K', elapsedSeconds: h(0, 20, 56), paceLabel: '4:11/km, 4:10/km' },
        { label: '10K', elapsedSeconds: h(0, 44, 26), paceLabel: '4:21/km, 4:26.4/km' },
      ],
      overallRank: { place: 937 },
      genderRank: { place: 779 },
      ageGroupRank: { place: 162 },
      sourceStatus: 'self_reported',
      sourceNotes: [
        'Source\'s separate "5K" section entry for this same event/date (20:56) is this race\'s 5K split, not a standalone race — attached above rather than imported as a second result.',
        '5K split ranking (per source "5K" section): Overall 215, Men 201, AG 23 — preserved here as a note since the data model does not carry separate rankings per split.',
      ],
    },
  },
  {
    id: 'under-armour-10k-2024',
    name: 'Under Armour Toronto 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2024-06-15',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 44, 19),
      splits: [{ label: '10K', elapsedSeconds: h(0, 44, 19), paceLabel: '4:24/km, 4:25.8/km' }],
      overallRank: { place: 484 },
      genderRank: { place: 406 },
      ageGroupRank: { place: 93 },
      sourceStatus: 'self_reported',
    },
  },
  {
    id: 'under-armour-10k-2025',
    name: 'Under Armour Toronto 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2025-06-14',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 40, 39),
      splits: [{ label: '10K', elapsedSeconds: h(0, 40, 39), paceLabel: '4:04.2/km' }],
      overallRank: { place: 210 },
      genderRank: { place: 178 },
      ageGroupRank: { place: 33 },
      sourceStatus: 'self_reported',
      sourceNotes: ['Source labeled this race "PR."'],
    },
  },
  {
    id: 'sporting-life-10k-2026',
    name: 'Sporting Life 10K',
    sport: 'running',
    distanceLabel: '10K',
    eventDate: '2026-05-10',
    location: 'Toronto, ON, CAN',
    status: 'completed',
    locked: true,
    result: {
      finishSeconds: h(0, 51, 46),
      splits: [],
      sourceStatus: 'self_reported',
      sourceNotes: ['Source note: "Run with Juan" — no ranking data recorded for this race.'],
    },
  },
];

/** Empty-state fixture variant for `DEV_FIXTURE_MODE` testing — unrelated to the fact that
 *  `racesPopulated` itself also has zero upcoming races (no upcoming race is confirmed by the
 *  imported source; see the A.3 plan, decision #4). */
export const racesEmpty: Race[] = [];
