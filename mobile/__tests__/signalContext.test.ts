import type { Race } from '@/fixtures/races';
import { buildConversationTitle, buildSignalContext, getSuggestedPrompts, hasCompletedResults, hasComparableLegRanks } from '@/lib/signalContext';

/** Minimal synthetic race — only the fields Signal's context assembly actually reads. */
function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'distanceLabel'>): Race {
  return {
    name: overrides.id,
    sport: 'triathlon',
    location: 'Test City',
    status: 'completed',
    ...overrides,
  };
}

describe('buildSignalContext — cross-distance, same-sport tiering', () => {
  // Regression for the exact bug the plan called out: "What does Eagleman 70.3 suggest for
  // IRONMAN California?" — with a same-canonical-distance-only rule, Eagleman (a different
  // distance from full-distance California) would be demoted to a bare compact record on exactly
  // the question it's the evidence for.
  it('gives a different-distance, same-sport race full detail, not a compact record', () => {
    const california = race({
      id: 'ironman-california',
      eventDate: '2026-08-01',
      distanceLabel: 'IRONMAN',
      status: 'registered',
    });
    const eagleman = race({
      id: 'eagleman-70-3',
      eventDate: '2026-06-08',
      distanceLabel: '70.3',
      result: {
        finishSeconds: 17698,
        splits: [{ label: 'Run', elapsedSeconds: 5400 }],
        sourceStatus: 'imported_confirmed',
        overallRank: { place: 100, field: 2000 },
      },
    });

    const context = buildSignalContext([california, eagleman], california.id);

    const eaglemanInContext = context.sameSportDetailed.find((r) => r.id === eagleman.id);
    expect(eaglemanInContext).toBeDefined();
    expect(eaglemanInContext?.finishSeconds).toBe(17698);
    expect(eaglemanInContext?.splits).toEqual([{ label: 'Run', elapsedSeconds: 5400, paceLabel: undefined }]);
    expect(eaglemanInContext?.overallRank?.percentile).toBeDefined();
    // Never silently dropped into the compact-only tier.
    expect(context.otherSportsCompact.some((r) => r.id === eagleman.id)).toBe(false);
  });

  it('orders same-canonical-distance races first within the same-sport tier, without excluding others', () => {
    const seed = race({ id: 'victoria-70-3', eventDate: '2026-06-01', distanceLabel: '70.3 Results' });
    const sameDistance = race({ id: 'gulf-coast-70-3', eventDate: '2019-05-05', distanceLabel: '70.3' });
    const otherDistance = race({ id: 'olympic-tri', eventDate: '2021-07-01', distanceLabel: 'Olympic Triathlon' });

    const context = buildSignalContext([seed, sameDistance, otherDistance], seed.id);

    expect(context.sameSportDetailed.map((r) => r.id)).toEqual([sameDistance.id, otherDistance.id]);
  });

  it('routes a different-sport race to the compact tier, not the detailed one', () => {
    const seed = race({ id: 'seed-tri', eventDate: '2026-01-01', distanceLabel: '70.3' });
    const runningRace = race({ id: 'a-10k', eventDate: '2025-05-01', distanceLabel: '10K', sport: 'running' });

    const context = buildSignalContext([seed, runningRace], seed.id);

    expect(context.sameSportDetailed.some((r) => r.id === runningRace.id)).toBe(false);
    expect(context.otherSportsCompact.map((r) => r.id)).toEqual([runningRace.id]);
  });

  it('with no seed race, gives every completed race full detail and leaves otherSportsCompact empty', () => {
    const a = race({ id: 'a', eventDate: '2025-01-01', distanceLabel: '70.3' });
    const b = race({ id: 'b', eventDate: '2025-02-01', distanceLabel: '10K', sport: 'running' });

    const context = buildSignalContext([a, b]);

    expect(context.seedRace).toBeUndefined();
    expect(context.sameSportDetailed.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(context.otherSportsCompact).toEqual([]);
  });

  it('always includes upcoming races as compact records, regardless of seed', () => {
    const seed = race({ id: 'seed', eventDate: '2025-01-01', distanceLabel: '70.3' });
    const upcoming = race({
      id: 'upcoming-race',
      eventDate: '2027-01-01',
      distanceLabel: 'IRONMAN',
      status: 'registered',
      location: 'Somewhere',
    });

    const context = buildSignalContext([seed, upcoming], seed.id);

    expect(context.upcoming).toEqual([
      { id: 'upcoming-race', name: 'upcoming-race', sport: 'triathlon', distanceLabel: 'IRONMAN', eventDate: '2027-01-01', location: 'Somewhere', finishSeconds: undefined },
    ]);
  });
});

describe('buildSignalContext — precomputed facts (Step 5 accuracy pass)', () => {
  // Regression for a real eval failure: Signal calculated the Eagleman-vs-Victoria run-leg time
  // difference itself from raw split seconds and got it wrong (~13 min instead of the real ~16.5
  // min). The app must hand over an already-correct, already-signed delta instead.
  it('precomputes correct, signed time deltas vs the seed race for matching splits and finish', () => {
    const eagleman = race({
      id: 'eagleman',
      eventDate: '2026-06-08',
      distanceLabel: '70.3',
      result: {
        finishSeconds: 17698,
        splits: [
          { label: 'Run', elapsedSeconds: 5854 },
          { label: 'Bike', elapsedSeconds: 8969 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });
    const victoria = race({
      id: 'victoria',
      eventDate: '2022-06-01',
      distanceLabel: '70.3 Results',
      result: {
        finishSeconds: 20645,
        splits: [
          { label: 'Run', elapsedSeconds: 6846 },
          { label: 'Bike', elapsedSeconds: 10740 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });

    const context = buildSignalContext([eagleman, victoria], eagleman.id);
    const victoriaInContext = context.sameSportDetailed.find((r) => r.id === 'victoria');
    const runDelta = victoriaInContext?.timeDeltasVsSeed?.find((d) => d.label === 'Run');
    const finishDelta = victoriaInContext?.timeDeltasVsSeed?.find((d) => d.label === 'Finish');

    // 6846 - 5854 = 992s = 16m 32s (not ~13 min).
    expect(runDelta?.deltaSeconds).toBe(992);
    expect(runDelta?.description).toBe('16m 32s slower than the seed race');
    expect(finishDelta?.deltaSeconds).toBe(20645 - 17698);

    // The seed race itself never carries a delta against itself.
    expect(context.seedRace?.timeDeltasVsSeed).toBeUndefined();
  });

  it('never computes a delta for a split label the seed race does not have', () => {
    const seed = race({
      id: 'seed',
      eventDate: '2026-01-01',
      distanceLabel: 'Olympic',
      result: { finishSeconds: 9000, splits: [{ label: 'Run', elapsedSeconds: 2500 }], sourceStatus: 'imported_confirmed' },
    });
    const other = race({
      id: 'other',
      eventDate: '2025-01-01',
      distanceLabel: 'Olympic',
      result: {
        finishSeconds: 9500,
        splits: [
          { label: 'Run', elapsedSeconds: 2600 },
          { label: 'Swim', elapsedSeconds: 1200 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });

    const context = buildSignalContext([seed, other], seed.id);
    const otherInContext = context.sameSportDetailed.find((r) => r.id === 'other');
    expect(otherInContext?.timeDeltasVsSeed?.map((d) => d.label)).toEqual(['Finish', 'Run']);
  });

  // Regression for a real eval failure: Signal generalized a top-3% half-marathon result onto the
  // 10K, whose actual best result is only top 6% — a different distance's percentile was applied
  // where it didn't belong.
  it('computes one current-PB entry per distance group, each with only that distance\'s own percentiles', () => {
    const halfMarathon = race({
      id: 'half',
      eventDate: '2026-01-01',
      distanceLabel: 'Half Marathon',
      sport: 'running',
      result: {
        finishSeconds: 5216,
        splits: [],
        sourceStatus: 'imported_confirmed',
        ageGroupRank: { place: 17, field: 704 },
      },
    });
    const tenK = race({
      id: 'tenk',
      eventDate: '2025-01-01',
      distanceLabel: '10km',
      sport: 'running',
      result: {
        finishSeconds: 2439,
        splits: [],
        sourceStatus: 'imported_confirmed',
        ageGroupRank: { place: 33, field: 566 },
      },
    });

    const context = buildSignalContext([halfMarathon, tenK]);
    const halfBest = context.bestPerDistance.find((b) => b.canonicalDistance === 'Half Marathon');
    const tenKBest = context.bestPerDistance.find((b) => b.canonicalDistance === '10K');

    expect(halfBest?.ageGroupPercentile).toBe(3); // ceil(17/704*100) = 3
    expect(tenKBest?.ageGroupPercentile).toBe(6); // ceil(33/566*100) = 6 — never 3.
  });
});

/** Minimal completed result for suggestion-eligibility tests. */
function completedResult(finishSeconds: number, splits: { label: string; elapsedSeconds: number }[] = [], extra: Record<string, unknown> = {}) {
  return { finishSeconds, splits, sourceStatus: 'imported_confirmed' as const, ...extra };
}

// The development test account used for the iPhone review: three completed races, no ranks, no splits, no repeated
// distance, no upcoming race.
const THREE_RACE_ACCOUNT: Race[] = [
  race({ id: 'sprint', name: 'Link Test Sprint Triathlon', eventDate: '2024-06-09', distanceLabel: 'Sprint Triathlon', sport: 'triathlon', result: completedResult(4380) }),
  race({ id: 'ten-k', name: 'Link Test 10K', eventDate: '2025-04-20', distanceLabel: '10km', sport: 'running', result: completedResult(2670) }),
  race({ id: 'half', name: 'Link Test Half Marathon', eventDate: '2025-10-05', distanceLabel: 'Half Marathon', sport: 'running', result: completedResult(5892) }),
];

describe('getSuggestedPrompts: unseeded (Signal tab and unseeded chat)', () => {
  it('offers nothing for an athlete with no races, rather than filling slots', () => {
    expect(getSuggestedPrompts([])).toEqual([]);
  });

  it('for the three-race test account: no strongest-discipline and no improvement question, but supported ones', () => {
    const prompts = getSuggestedPrompts(THREE_RACE_ACCOUNT);
    expect(prompts).not.toContain("What's my strongest discipline?");
    expect(prompts).not.toContain("What's my strongest discipline overall?");
    expect(prompts).not.toContain('Have I been improving year over year?');
    expect(prompts).not.toContain('What would most improve my next race?');
    expect(prompts).toEqual(["What's my Half Marathon personal best?", "What's my 10K personal best?", 'How did my Link Test Half Marathon go?']);
  });

  it('offers the year-over-year question only when a distance has two or more completed results', () => {
    const earlier = race({ id: 'ten-k-2024', name: 'Riverside 10K', eventDate: '2024-04-20', distanceLabel: '10K', sport: 'running', result: completedResult(2770) });
    const later = race({ id: 'ten-k-2026', name: 'Riverside 10K', eventDate: '2026-04-19', distanceLabel: '10km', sport: 'running', result: completedResult(2675) });
    expect(getSuggestedPrompts([earlier])).not.toContain('Have I been improving year over year?');
    expect(getSuggestedPrompts([earlier, later])).toContain('Have I been improving year over year?');
    // Same distance in a different sport is not a repeat.
    const otherSport = race({ id: 'ten-k-bike', eventDate: '2025-04-20', distanceLabel: '10K', sport: 'cycling', result: completedResult(1000) });
    expect(getSuggestedPrompts([earlier, otherSport])).not.toContain('Have I been improving year over year?');
  });

  it('offers a strongest-discipline question only when comparable swim, bike, and run leg ranks exist in the context', () => {
    const legs = (withRanks: boolean) =>
      ['Swim', 'Bike', 'Run'].map((label, i) => ({ label, elapsedSeconds: 1000 + i, ...(withRanks ? { legRank: { place: 10 + i, field: 100, percentile: 10 } } : {}) }));
    const tri = (withRanks: boolean): Race =>
      race({ id: 't', eventDate: '2025-06-01', distanceLabel: '70.3', result: completedResult(20000, legs(withRanks)) });
    // The race model has no leg ranks, so a real account never qualifies; with splits alone it must not.
    expect(getSuggestedPrompts([tri(false)])).not.toContain("What's my strongest discipline?");
    // The eligibility check itself reads leg ranks from the context shape the function receives.
    const context = buildSignalContext([tri(false)]);
    expect(hasComparableLegRanks(context)).toBe(false);
    const ranked = { ...context, sameSportDetailed: context.sameSportDetailed.map((r) => ({ ...r, splits: legs(true) })) };
    expect(hasComparableLegRanks(ranked)).toBe(true);
    const partial = { ...context, sameSportDetailed: context.sameSportDetailed.map((r) => ({ ...r, splits: legs(true).slice(0, 2) })) };
    expect(hasComparableLegRanks(partial)).toBe(false);
  });

  it('offers a next-race question only with an upcoming race and completed history', () => {
    const upcoming = race({ id: 'next', name: 'IRONMAN California', eventDate: '2027-04-17', distanceLabel: 'IRONMAN', status: 'registered' });
    expect(getSuggestedPrompts([upcoming])).toEqual([]);
    const withHistory = getSuggestedPrompts([...THREE_RACE_ACCOUNT, upcoming]);
    expect(withHistory).toContain('What does my history suggest for IRONMAN California?');
    expect(hasCompletedResults([upcoming])).toBe(false);
    expect(hasCompletedResults(THREE_RACE_ACCOUNT)).toBe(true);
  });
});

describe('getSuggestedPrompts: seeded race', () => {
  it('suggests prediction questions for an upcoming seed race only when completed history exists', () => {
    const seed = race({ id: 'upcoming', eventDate: '2027-01-01', distanceLabel: 'IRONMAN', status: 'registered' });
    expect(getSuggestedPrompts([seed], seed.id)).toEqual([]);
    const prompts = getSuggestedPrompts([seed, ...THREE_RACE_ACCOUNT], seed.id);
    expect(prompts).toContain('What does my history suggest for this race?');
    // Course and conditions are not in the context, so "what should I expect" is no longer offered.
    expect(prompts).not.toContain('What should I expect going in?');
  });

  it('offers the analysis questions for a completed race with a result, and none for one without', () => {
    const withResult = THREE_RACE_ACCOUNT[1]!;
    expect(getSuggestedPrompts(THREE_RACE_ACCOUNT, withResult.id)).toEqual(['Analyze this race', 'What went well?']);
    const noResult = race({ id: 'blank', eventDate: '2025-01-01', distanceLabel: '10K', sport: 'running' });
    expect(getSuggestedPrompts([noResult], noResult.id)).toEqual([]);
  });

  it('never suggests "strongest discipline" from splits alone: multi-discipline, single-sport, or checkpoint-labelled', () => {
    const triSplits = [{ label: 'Swim', elapsedSeconds: 1500 }, { label: 'Bike', elapsedSeconds: 5000 }, { label: 'Run', elapsedSeconds: 2500 }];
    const tri = race({ id: 'real-tri', eventDate: '2025-01-01', distanceLabel: 'Olympic', result: completedResult(9000, triSplits) });
    const marathon = race({ id: 'm', eventDate: '2025-01-01', distanceLabel: 'Marathon', sport: 'running', result: completedResult(15000, [{ label: '5K', elapsedSeconds: 1500 }, { label: '10K', elapsedSeconds: 3000 }, { label: 'Half', elapsedSeconds: 6300 }]) });
    const checkpoints = race({ id: 'c', eventDate: '2025-01-01', distanceLabel: '70.3', result: completedResult(17698, [{ label: 'Checkpoint 1', elapsedSeconds: 2379 }, { label: 'Checkpoint 2', elapsedSeconds: 223 }, { label: 'Finish', elapsedSeconds: 5854 }]) });
    for (const seed of [tri, marathon, checkpoints]) {
      expect(getSuggestedPrompts([seed], seed.id)).not.toContain('What was my strongest discipline?');
    }
    // The pacing question needs splits to compare, and still appears for any race that has them.
    expect(getSuggestedPrompts([tri], tri.id)).toContain('Where did I lose the most time?');
    expect(getSuggestedPrompts([checkpoints], checkpoints.id)).toContain('Where did I lose the most time?');
  });

  it('offers the pacing question only with two or more splits', () => {
    const none = race({ id: 'a', eventDate: '2025-01-01', distanceLabel: '10K', sport: 'running', result: completedResult(2400, []) });
    const one = race({ id: 'b', eventDate: '2025-01-01', distanceLabel: '10K', sport: 'running', result: completedResult(2400, [{ label: 'Half', elapsedSeconds: 1200 }]) });
    const two = race({ id: 'c', eventDate: '2025-01-01', distanceLabel: '10K', sport: 'running', result: completedResult(2400, [{ label: 'Mile 1', elapsedSeconds: 400 }, { label: 'Mile 2', elapsedSeconds: 800 }]) });
    expect(getSuggestedPrompts([none], none.id)).not.toContain('Where did I lose the most time?');
    expect(getSuggestedPrompts([one], one.id)).not.toContain('Where did I lose the most time?');
    expect(getSuggestedPrompts([two], two.id)).toContain('Where did I lose the most time?');
  });

  it('offers a comparison only with another completed result at the same sport and distance', () => {
    const seed = race({ id: 'solo-tri', eventDate: '2025-01-01', distanceLabel: 'Olympic', result: completedResult(9000) });
    expect(getSuggestedPrompts([seed], seed.id).some((p) => p.startsWith('How does this compare'))).toBe(false);
    // A different distance in the same sport is not a like-for-like comparison.
    const otherDistance = race({ id: 'other-tri', eventDate: '2024-01-01', distanceLabel: '70.3', result: completedResult(18000) });
    expect(getSuggestedPrompts([seed, otherDistance], seed.id).some((p) => p.startsWith('How does this compare'))).toBe(false);
    const sameDistance = race({ id: 'same-tri', eventDate: '2024-06-01', distanceLabel: 'Olympic Triathlon', result: completedResult(9100) });
    expect(getSuggestedPrompts([seed, sameDistance], seed.id)).toContain('How does this compare with my other Olympic races?');
  });
});

describe('buildConversationTitle', () => {
  it('titles a seeded completed race as "[name] race analysis"', () => {
    const seed = race({ id: 'a', eventDate: '2025-01-01', distanceLabel: '70.3', name: 'IRONMAN 70.3 Eagleman' });
    expect(buildConversationTitle(seed, 'irrelevant')).toBe('IRONMAN 70.3 Eagleman race analysis');
  });

  it('titles a seeded upcoming race as the bare race name', () => {
    const seed = race({ id: 'b', eventDate: '2027-01-01', distanceLabel: 'IRONMAN', status: 'registered', name: 'IRONMAN California' });
    expect(buildConversationTitle(seed, 'irrelevant')).toBe('IRONMAN California');
  });

  it('titles an unseeded conversation from the first user message, untruncated when short', () => {
    expect(buildConversationTitle(undefined, "What's my strongest discipline?")).toBe("What's my strongest discipline?");
  });

  it('safely truncates a long first message with an ellipsis', () => {
    const long = 'a'.repeat(100);
    const title = buildConversationTitle(undefined, long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });
});
