import type { SportCategory } from '@/fixtures/races';
import type { TrainingBlock } from '@/fixtures/training';

export interface TrainingTotals {
  sessions: number;
  hours: number;
  swimKm: number;
  bikeKm: number;
  runKm: number;
  totalDistanceKm: number;
}

const EMPTY_TOTALS: TrainingTotals = {
  sessions: 0,
  hours: 0,
  swimKm: 0,
  bikeKm: 0,
  runKm: 0,
  totalDistanceKm: 0,
};

/**
 * Sums whichever training blocks match the filter. Blocks are one row per (year, sportCategory)
 * with no duplicates, so this never double-counts — "overall" for a year is just every distinct
 * sport-category row for that year added together.
 */
export function getTrainingTotals(
  blocks: TrainingBlock[],
  filter: { sportCategory?: SportCategory; year?: number } = {},
): TrainingTotals {
  const matching = blocks.filter(
    (block) =>
      (filter.sportCategory === undefined || block.sportCategory === filter.sportCategory) &&
      (filter.year === undefined || block.year === filter.year),
  );

  return matching.reduce((totals, block) => {
    const distance = block.swimKm + block.bikeKm + block.runKm;
    return {
      sessions: totals.sessions + block.sessions,
      hours: totals.hours + block.hours,
      swimKm: totals.swimKm + block.swimKm,
      bikeKm: totals.bikeKm + block.bikeKm,
      runKm: totals.runKm + block.runKm,
      totalDistanceKm: totals.totalDistanceKm + distance,
    };
  }, EMPTY_TOTALS);
}

export function getCurrentTrainingBlock(blocks: TrainingBlock[], raceId: string): TrainingBlock | null {
  return blocks.find((block) => block.raceId === raceId) ?? null;
}
