// Diagnostic-only script (not a standing regression case) — reproduces the mobile app's EXACT
// call pattern: a real supabase-js client, a real session set via setSession() (not a one-off
// fetch), autoRefreshToken left on (matching lib/supabaseClient.ts), calling
// client.functions.invoke('signal', {body}) — exactly what lib/signal.ts does — for a two-turn
// Eagleman conversation. Purpose: isolate whether the physical-device turn-2 failure reproduces
// through the supabase-js client library itself (outside React Native entirely) or is specific to
// the RN/device runtime.
import { createClient } from '@supabase/supabase-js';
import { buildSignalContext } from '../../src/lib/signalContext';
import { fetchTestAthleteRaces, mintTestSession } from './harness';

async function main() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const email = process.env.SIGNAL_EVAL_EMAIL!;
  if (!supabaseUrl || !anonKey || !email) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / SIGNAL_EVAL_EMAIL');

  const session = await mintTestSession(supabaseUrl, email);
  const races = await fetchTestAthleteRaces(supabaseUrl, anonKey, session.access_token);
  const eagleman = races.find((r) => r.name.includes('Eagleman'));
  if (!eagleman) throw new Error('No Eagleman race found for this athlete.');

  // Mirrors mobile/src/lib/supabaseClient.ts's config (minus AsyncStorage — no RN runtime here).
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false, flowType: 'pkce' },
  });
  const { error: setSessionError } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setSessionError) throw setSessionError;

  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  const prompts = ['Analyze this race', 'How does this compare to Victoria?'];

  for (const [i, prompt] of prompts.entries()) {
    const context = buildSignalContext(races, eagleman.id);
    const body = { context, history, message: prompt };
    console.log(`\n=== turn ${i + 1}: ${prompt} ===`);
    console.log('requestBytes=', JSON.stringify(body).length, 'historyTurns=', history.length);
    const startedAt = Date.now();
    const { data, error } = await client.functions.invoke('signal', { body });
    console.log('elapsedMs=', Date.now() - startedAt);
    if (error) {
      console.log('ERROR name=', error.name, 'message=', error.message);
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        console.log('context status=', ctx.status);
        try {
          console.log('context body=', await ctx.text());
        } catch (e) {
          console.log('could not read context body:', e);
        }
      } else {
        console.log('no response context at all — this is a true fetch-level failure, not an HTTP error response.');
      }
      return;
    }
    console.log('available=', data?.available);
    if (data?.available) {
      console.log('reply (first 200 chars):', String(data.data.reply).slice(0, 200));
      history.push({ role: 'user', text: prompt });
      history.push({ role: 'assistant', text: data.data.reply });
    } else {
      console.log('clean unavailable response:', JSON.stringify(data));
    }
  }
  console.log('\nBoth turns completed without a functions.invoke() error.');
}

main().catch((err) => {
  console.error('HARNESS ERROR', err);
  process.exit(1);
});
