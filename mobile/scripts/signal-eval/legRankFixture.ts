// Evaluation-only fixture: synthetic, comparable discipline-level evidence (the athlete's rank in each leg against the same
// race field) for the two 70.3s of the synthetic rich athlete. The app does not produce leg ranks today; this is how the
// "valid evidence exists" branch of the strongest-discipline rule is exercised against the real deployed function.
// Answer key: bike is the strongest-ranked discipline in both races (Top 6% and Top 9%), then run (Top 11%, Top 14%), then swim
// (Top 24% in both). Only these two races carry leg ranks; the Olympic and Sprint triathlons do not.
import type { SignalContext } from '../../src/lib/signalContext';

const LEG_RANKS: Record<string, Record<string, { place: number; field: number; percentile: number }>> = {
  Ridgeline: { Swim: { place: 412, field: 1720, percentile: 24 }, Bike: { place: 96, field: 1720, percentile: 6 }, Run: { place: 188, field: 1720, percentile: 11 } },
  Coastal: { Swim: { place: 395, field: 1650, percentile: 24 }, Bike: { place: 143, field: 1650, percentile: 9 }, Run: { place: 221, field: 1650, percentile: 14 } },
};

export function withLegRanks(context: SignalContext): SignalContext {
  return {
    ...context,
    sameSportDetailed: context.sameSportDetailed.map((race) => {
      const key = Object.keys(LEG_RANKS).find((name) => race.name.includes(name));
      if (!key) return race;
      return { ...race, splits: race.splits?.map((split) => ({ ...split, legRank: LEG_RANKS[key]![split.label] })) } as typeof race;
    }),
  };
}
