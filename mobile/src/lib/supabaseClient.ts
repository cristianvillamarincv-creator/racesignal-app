import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import './environment'; // startup guard: throws before any client exists if the backend does not match the app variant

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // createClient() throws synchronously on an empty/malformed URL, which would crash the app at
  // launch — worse than a warning + every network call failing normally through the app's
  // existing error states. See mobile/.env.example / supabase/README.md for setup.
  console.warn(
    'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set — copy mobile/.env.example to mobile/.env and fill them in (see supabase/README.md).',
  );
}

// A syntactically valid but unreachable placeholder when unconfigured — satisfies createClient()'s
// URL validation without crashing; every real call then fails as a normal (catchable) network
// error instead of an import-time throw.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // supabase-js defaults to 'implicit', which returns Google/magic-link redirects with tokens
    // in the URL FRAGMENT (#access_token=...). Our redirect handling (lib/auth.tsx) expects a
    // `?code=` query param, which only 'pkce' produces — this was the root cause of Google
    // sign-in silently failing in the first B.1 device test. lib/auth.tsx still falls back to
    // parsing fragment tokens defensively, but pkce is the actual fix, not the fallback.
    flowType: 'pkce',
  },
});
