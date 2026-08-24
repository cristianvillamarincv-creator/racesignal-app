import type { SportCategory } from '@/fixtures/races';
import type { IconName } from '@/lib/icons';

/**
 * One row per (year, sportCategory) the athlete trained for that year — never two rows for the
 * same pair, so summing rows for "Overall" never double-counts a sport-specific row. A year with
 * two race disciplines (e.g. 2021: a triathlon and a marathon) gets two distinct rows instead of
 * one blended one, keeping the totals honest without needing a day-by-day activity log.
 */
export interface TrainingBlock {
  id: string;
  year: number;
  sportCategory: SportCategory;
  /** Present when this block was built specifically toward one race (e.g. the current block). */
  raceId?: string;
  sessions: number;
  hours: number;
  swimKm: number;
  bikeKm: number;
  runKm: number;
}

export interface RecentActivity {
  id: string;
  sport: 'swim' | 'bike' | 'run' | 'strength' | 'other';
  label: string;
  distanceLabel?: string;
  durationLabel: string;
  whenLabel: string;
}

export interface TrainingMilestone {
  id: string;
  year: number;
  icon: IconName;
  label: string;
  value: string;
}

export const trainingBlocksPopulated: TrainingBlock[] = [
  {
    id: 'block-2026-triathlon',
    year: 2026,
    sportCategory: 'triathlon',
    raceId: 'ironman-ottawa-2026',
    sessions: 186,
    hours: 243,
    swimKm: 121,
    bikeKm: 4211,
    runKm: 923,
  },
  {
    id: 'block-2025-triathlon',
    year: 2025,
    sportCategory: 'triathlon',
    sessions: 210,
    hours: 260,
    swimKm: 95,
    bikeKm: 3800,
    runKm: 780,
  },
  {
    id: 'block-2024-triathlon',
    year: 2024,
    sportCategory: 'triathlon',
    sessions: 140,
    hours: 150,
    swimKm: 60,
    bikeKm: 1800,
    runKm: 420,
  },
  {
    id: 'block-2024-running',
    year: 2024,
    sportCategory: 'running',
    sessions: 60,
    hours: 70,
    swimKm: 0,
    bikeKm: 0,
    runKm: 550,
  },
  {
    id: 'block-2023-triathlon',
    year: 2023,
    sportCategory: 'triathlon',
    sessions: 110,
    hours: 95,
    swimKm: 40,
    bikeKm: 1100,
    runKm: 280,
  },
  {
    id: 'block-2022-running',
    year: 2022,
    sportCategory: 'running',
    sessions: 70,
    hours: 75,
    swimKm: 0,
    bikeKm: 0,
    runKm: 580,
  },
  {
    id: 'block-2021-triathlon',
    year: 2021,
    sportCategory: 'triathlon',
    sessions: 90,
    hours: 80,
    swimKm: 35,
    bikeKm: 900,
    runKm: 220,
  },
  {
    id: 'block-2021-running',
    year: 2021,
    sportCategory: 'running',
    sessions: 95,
    hours: 110,
    swimKm: 0,
    bikeKm: 0,
    runKm: 850,
  },
  {
    id: 'block-2020-triathlon',
    year: 2020,
    sportCategory: 'triathlon',
    sessions: 85,
    hours: 78,
    swimKm: 32,
    bikeKm: 850,
    runKm: 210,
  },
  {
    id: 'block-2019-running',
    year: 2019,
    sportCategory: 'running',
    sessions: 50,
    hours: 45,
    swimKm: 0,
    bikeKm: 0,
    runKm: 320,
  },
];

export const trainingBlocksEmpty: TrainingBlock[] = [];

export const recentActivitiesPopulated: RecentActivity[] = [
  {
    id: 'activity-swim-today',
    sport: 'swim',
    label: 'Swim',
    distanceLabel: '4 km',
    durationLabel: '1h 38m',
    whenLabel: 'Today',
  },
  {
    id: 'activity-bike-yesterday',
    sport: 'bike',
    label: 'Endurance ride',
    distanceLabel: '90 km',
    durationLabel: '3h 15m',
    whenLabel: 'Yesterday',
  },
  {
    id: 'activity-run-2days',
    sport: 'run',
    label: 'Recovery run',
    distanceLabel: '8 km',
    durationLabel: '42m',
    whenLabel: 'Tuesday',
  },
  {
    id: 'activity-swim-4days',
    sport: 'swim',
    label: 'Technique drills',
    distanceLabel: '2.5 km',
    durationLabel: '55m',
    whenLabel: '4 days ago',
  },
];

export const recentActivitiesEmpty: RecentActivity[] = [];

export const trainingMilestonesPopulated: TrainingMilestone[] = [
  { id: 'milestone-longest-swim', year: 2026, icon: 'swim', label: 'Longest swim this year', value: '4.5 km' },
  { id: 'milestone-longest-ride', year: 2026, icon: 'bike', label: 'Longest ride this year', value: '162 km' },
  {
    id: 'milestone-fastest-10k',
    year: 2026,
    icon: 'run',
    label: 'Fastest 10K training run',
    value: '43:21',
  },
  {
    id: 'milestone-biggest-week',
    year: 2026,
    icon: 'fire',
    label: 'Biggest training week',
    value: '14h 32m',
  },
];

export const trainingMilestonesEmpty: TrainingMilestone[] = [];
