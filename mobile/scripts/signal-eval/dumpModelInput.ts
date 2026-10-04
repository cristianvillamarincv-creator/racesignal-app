// Evaluation-only: prints the EXACT system prompt the deployed function would send the model for a context variant, with no
// model call. Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx --env-file=.env.development scripts/signal-eval/dumpModelInput.ts <plain|legranks> <out.txt>
import { writeFileSync } from 'node:fs';
import { buildSignalContext } from '../../src/lib/signalContext';
import { buildSystemPrompt } from '../../../supabase/functions/signal/systemPrompt';
import { fetchTestAthleteRaces, mintTestSession } from './harness';
import { withLegRanks } from './legRankFixture';

async function main() {
  const [variant, out] = process.argv.slice(2);
  if (!variant || !out) throw new Error('usage: dumpModelInput.ts <plain|legranks> <out.txt>');
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const session = await mintTestSession(url, 'signal.eval@example.com');
  const races = await fetchTestAthleteRaces(url, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, session.access_token);
  const built = buildSignalContext(races, undefined);
  const context = variant === 'legranks' ? withLegRanks(built) : built;
  // The function JSON-parses the request body and passes the context through untouched (isValidContext only checks the four
  // arrays), so a JSON round trip is the faithful serialisation.
  const roundTripped = JSON.parse(JSON.stringify(context));
  writeFileSync(out, buildSystemPrompt(roundTripped));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
