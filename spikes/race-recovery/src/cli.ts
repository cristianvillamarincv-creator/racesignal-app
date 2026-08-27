import { fetchAthleteHistoryHtml, fetchSingleResult, isBlocked, searchAthlete } from './sportstatsClient.js';
import { extractInitialResults, parseSingleResultDetail, toRaceCandidates } from './normalize.js';
import { checkBarrelman, checkTorontoHalf } from './acceptanceCheck.js';
import type { KnownRaceAnchor, ProviderBlocked, RaceCandidate } from './types.js';

/**
 * B.0 standalone spike CLI.
 *
 * Flow: racingName -> Sportstats athlete match -> lightweight candidate list (discovery) ->
 * full detail fetched ONLY for candidates matching a --known-race anchor (selection), mirroring
 * the intended product architecture: name search -> lightweight list -> user selects -> detail
 * fetched only for what was selected.
 *
 * Usage:
 *   npm start -- --name "Alanna Harvey" --birthYear 1991 \
 *     --knownRace "Toronto Marathon:2026" --knownRace "Barrelman:2025"
 *
 * With no args, runs the exact Alanna Harvey B.0 evaluation case by default.
 */

function parseArgs(argv: string[]) {
  let name: string | undefined;
  let birthYear: number | undefined;
  const knownRaces: KnownRaceAnchor[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') name = argv[++i];
    else if (arg === '--birthYear') birthYear = Number(argv[++i]);
    else if (arg === '--knownRace') {
      const raw = argv[++i] ?? '';
      const [eventQuery, yearStr] = raw.split(':');
      if (eventQuery && yearStr) knownRaces.push({ eventQuery: eventQuery.trim(), approximateYear: Number(yearStr.trim()) });
    }
  }

  return {
    name: name ?? 'Alanna Harvey',
    birthYear: birthYear ?? 1991,
    knownRaces: knownRaces.length > 0
      ? knownRaces
      : [
          { eventQuery: 'Toronto Marathon', approximateYear: 2026 },
          { eventQuery: 'Barrelman', approximateYear: 2025 },
        ],
  };
}

function printBlocked(step: string, result: ProviderBlocked) {
  console.error(`\n🛑 STOPPED at "${step}" — Sportstats responded in a way that looks like a block/challenge.`);
  console.error(`   reason: ${result.reason}`);
  if (result.httpStatus) console.error(`   http status: ${result.httpStatus}`);
  console.error(`   url: ${result.url}`);
  console.error('   Per B.0 constraints: no retry, no backoff, no proxy rotation, no CAPTCHA solving. Stopping now.');
}

function printCandidate(c: RaceCandidate, index: number) {
  console.log(`\nCandidate ${index + 1}`);
  console.log(`  ${c.eventName}`);
  console.log(`  ${c.eventDateRaw} — ${c.category}`);
  console.log(`  Provider: Sportstats`);
  console.log(`  Source: ${c.sourceUrl}`);
  console.log(`  Match evidence:`);
  for (const evidence of c.matchEvidence) console.log(`    - ${evidence}`);
  console.log(`  Confidence: ${c.confidence}`);
  if (c.detail) {
    console.log(`  Detail:`);
    console.log(`    Bib: ${c.detail.bib ?? '(not available)'}`);
    console.log(`    Finish: ${c.detail.finishTime ?? '(not available)'}`);
    if (c.detail.overallRank) console.log(`    Overall: ${c.detail.overallRank.place}/${c.detail.overallRank.field ?? '?'}`);
    if (c.detail.genderRank) console.log(`    Gender: ${c.detail.genderRank.place}/${c.detail.genderRank.field ?? '?'}`);
    if (c.detail.ageGroupRank) console.log(`    Age group: ${c.detail.ageGroupRank.place}/${c.detail.ageGroupRank.field ?? '?'}`);
    if (c.detail.splits.length > 0) {
      console.log(`    Splits:`);
      for (const split of c.detail.splits) {
        console.log(`      ${split.label}: ${split.splitTime ?? '?'}${split.pace ? ` (${split.pace}/km)` : ''}`);
      }
    }
  }
}

async function main() {
  const { name, birthYear, knownRaces } = parseArgs(process.argv.slice(2));

  console.log(`RaceSignal B.0 spike — Sportstats candidate discovery`);
  console.log(`Searching: "${name}" (birthYear=${birthYear}, used only as match evidence, never identity proof)`);

  // --- Step 1: name search -> athlete ID ---
  const searchResult = await searchAthlete(name);
  if (isBlocked(searchResult)) return printBlocked('name search', searchResult) as never;
  if (searchResult.length === 0) {
    console.log('No athlete found for that name. Nothing more to do.');
    return;
  }
  if (searchResult.length > 1) {
    console.log(`Found ${searchResult.length} athletes matching "${name}" — not auto-picking one:`);
    for (const match of searchResult) console.log(`  - ${match.dn} (nid=${match.nid})`);
    console.log('Re-run with a more specific name, or extend the CLI to disambiguate. Stopping.');
    return;
  }
  const athlete = searchResult[0]!;
  console.log(`Matched athlete profile: ${athlete.dn} (nid=${athlete.nid})`);

  // --- Step 2: candidate discovery (lightweight — no detail fetches yet) ---
  const historyHtml = await fetchAthleteHistoryHtml(athlete.nid);
  if (isBlocked(historyHtml)) return printBlocked('athlete history page', historyHtml) as never;

  const rawEntries = extractInitialResults(historyHtml);
  const candidates = toRaceCandidates(rawEntries, name, knownRaces);
  console.log(`\n=== DISCOVERY: ${candidates.length} candidate race(s) found ===`);
  candidates.forEach(printCandidate);

  // --- Step 3: fetch full detail ONLY for candidates matching a known-race anchor ---
  const toFetchDetail = candidates.filter((c) => c.confidence === 'HIGH');
  console.log(`\n=== DETAIL: fetching full result detail for ${toFetchDetail.length} anchor-matched candidate(s) only ===`);

  for (const candidate of toFetchDetail) {
    const pid = candidate.sourceUrl.match(/focus=(\d+)/)?.[1];
    if (!pid) continue;
    const raw = await fetchSingleResult(candidate.providerResultId, pid);
    if (isBlocked(raw)) return printBlocked(`result detail (${candidate.eventName})`, raw) as never;
    candidate.detail = parseSingleResultDetail(raw);
  }

  console.log('\n=== Anchor candidates with full detail ===');
  toFetchDetail.forEach((c, i) => printCandidate(c, i));

  // --- Step 4: acceptance check against the manual benchmark ---
  console.log('\n=== ACCEPTANCE CHECK vs. manual benchmark ===');
  const torontoHalf = toFetchDetail.find((c) => c.eventName.toLowerCase().includes('toronto marathon'));
  const barrelman = toFetchDetail.find((c) => c.eventName.toLowerCase().includes('barrelman'));

  let allPass = true;
  if (torontoHalf?.detail) {
    console.log('\nToronto Half Marathon 2026:');
    for (const check of checkTorontoHalf(torontoHalf)) {
      console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.field}: expected ${check.expected}, got ${check.actual}`);
      if (!check.pass) allPass = false;
    }
  } else {
    console.log('\nToronto Half Marathon 2026: NOT MATCHED — cannot run acceptance check.');
    allPass = false;
  }

  if (barrelman?.detail) {
    console.log('\nNiagara Falls Barrelman (Olympic) 2025:');
    for (const check of checkBarrelman(barrelman)) {
      console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.field}: expected ${check.expected}, got ${check.actual}`);
      if (!check.pass) allPass = false;
    }
  } else {
    console.log('\nNiagara Falls Barrelman (Olympic) 2025: NOT MATCHED — cannot run acceptance check.');
    allPass = false;
  }

  console.log(`\n=== RESULT: ${allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} ===`);
  console.log(`Discovery: ${candidates.length} candidates recovered (manual benchmark: ~17).`);

  console.log('\n=== Full normalized RaceCandidate[] JSON ===');
  console.log(JSON.stringify(candidates, null, 2));
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
