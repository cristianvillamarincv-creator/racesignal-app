import type { Race } from '@/fixtures/races';
import { buildConversationTitle, buildSignalContext, getSuggestedPrompts } from '@/lib/signalContext';

/** Minimal synthetic race — only the fields Signal's context assembly actually reads. */
function race(overrides: Partial<Race> & Pick<Race, 'id' | 'eventDate' | 'distanceLabel'>): Race {
  return {
    name: overrides.id,
    sport: 'triathlon',
    location: 'Test City',
    status: 'completed',
    locked: false,
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

describe('getSuggestedPrompts', () => {
  it('returns generic prompts with no seed race', () => {
    const prompts = getSuggestedPrompts([]);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.join(' ')).not.toMatch(/this race/i);
  });

  it('suggests "strongest discipline" only for a multi-discipline (triathlon-shaped) seed race', () => {
    const seed = race({
      id: 'multi',
      eventDate: '2025-01-01',
      distanceLabel: '70.3',
      result: {
        finishSeconds: 100,
        splits: [
          { label: 'Swim', elapsedSeconds: 10 },
          { label: 'Bike', elapsedSeconds: 50 },
          { label: 'Run', elapsedSeconds: 40 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).toContain('What was my strongest discipline?');
  });

  it('suggests prediction-oriented prompts for an upcoming seed race', () => {
    const seed = race({ id: 'upcoming', eventDate: '2027-01-01', distanceLabel: 'IRONMAN', status: 'registered' });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).toContain('What does my history suggest for this race?');
  });

  // Task 3.2 (chip relevance) regressions — a running race must never surface a swim/bike/run
  // discipline-breakdown chip, even though several distinct CHECKPOINT split labels (not
  // disciplines) can legitimately exist on a single-sport race.
  it('never suggests "strongest discipline" for a single-sport race, even with multiple distinct split labels', () => {
    const seed = race({
      id: 'marathon-with-checkpoints',
      eventDate: '2025-01-01',
      distanceLabel: 'Marathon',
      sport: 'running',
      result: {
        finishSeconds: 15000,
        splits: [
          { label: '5K', elapsedSeconds: 1500 },
          { label: '10K', elapsedSeconds: 3000 },
          { label: 'Half', elapsedSeconds: 6300 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).not.toContain('What was my strongest discipline?');
  });

  it('never suggests a pacing/"where did I lose time" chip for a race with no splits', () => {
    const seed = race({
      id: 'no-splits-run',
      eventDate: '2025-01-01',
      distanceLabel: '10K',
      sport: 'running',
      result: { finishSeconds: 2400, splits: [], sourceStatus: 'imported_confirmed' },
    });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).not.toContain('Where did I lose the most time?');
    expect(prompts).not.toContain('What was my strongest discipline?');
  });

  it('offers the pacing chip, but never the discipline chip, for a running race that does have splits', () => {
    const seed = race({
      id: 'run-with-splits',
      eventDate: '2025-01-01',
      distanceLabel: '10K',
      sport: 'running',
      result: {
        finishSeconds: 2400,
        splits: [
          { label: 'Mile 1', elapsedSeconds: 400 },
          { label: 'Mile 2', elapsedSeconds: 800 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).toContain('Where did I lose the most time?');
    expect(prompts).not.toContain('What was my strongest discipline?');
  });

  it('offers a same-sport comparison chip only when comparable history actually exists', () => {
    const seed = race({ id: 'solo-tri', eventDate: '2025-01-01', distanceLabel: 'Olympic', sport: 'triathlon' });
    const noHistory = getSuggestedPrompts([seed], seed.id);
    expect(noHistory.some((p) => p.startsWith('How does this compare'))).toBe(false);

    const otherTri = race({ id: 'other-tri', eventDate: '2024-01-01', distanceLabel: '70.3', sport: 'triathlon' });
    const withHistory = getSuggestedPrompts([seed, otherTri], seed.id);
    expect(withHistory.some((p) => p.startsWith('How does this compare'))).toBe(true);
  });

  it('still suggests "strongest discipline" for a genuinely multi-discipline triathlon with real per-leg splits', () => {
    const seed = race({
      id: 'real-tri',
      eventDate: '2025-01-01',
      distanceLabel: 'Olympic',
      sport: 'triathlon',
      result: {
        finishSeconds: 9000,
        splits: [
          { label: 'Swim', elapsedSeconds: 1500 },
          { label: 'Bike', elapsedSeconds: 5000 },
          { label: 'Run', elapsedSeconds: 2500 },
        ],
        sourceStatus: 'imported_confirmed',
      },
    });
    const prompts = getSuggestedPrompts([seed], seed.id);
    expect(prompts).toContain('What was my strongest discipline?');
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
