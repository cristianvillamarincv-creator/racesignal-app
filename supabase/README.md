# RaceSignal — Supabase (B.1)

Schema + Edge Function for the B.1 real-athlete beta. Nothing here runs automatically — you need
to provision a real Supabase project and point the app at it before testing on-device.

## One-time setup

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine for a 1–2 person
   private beta).
2. Install the Supabase CLI (`brew install supabase/tap/supabase` or see their docs) and log in:
   ```bash
   supabase login
   ```
3. From the repo root:
   ```bash
   supabase link --project-ref <your-project-ref>   # find this in the project's Settings > General
   supabase db push                                  # runs migrations/0001_init.sql
   supabase functions deploy race-discovery
   ```
4. **Enable email OTP auth**: in the Supabase dashboard, Authentication → Providers → Email —
   make sure "Confirm email" / OTP sign-in is enabled (it is by default). No other provider is
   needed for this milestone (Google is implemented but intentionally hidden — see
   `B1_ARCHITECTURE.md`).

   **Known release-readiness gap, not a B.1 blocker**: without custom SMTP configured,
   Supabase Auth serves magic-link emails through its own shared/default sender, which enforces a
   very low **project-wide** rate limit (confirmed directly against this project:
   `over_email_send_rate_limit` after a handful of sends in a session). That's fine for this beta,
   but real customers would hit it almost immediately — configure a real SMTP provider (Resend,
   Postmark, SES, SendGrid, etc.) under Authentication → Emails, with a verified sending domain,
   before App Store release.
5. **Set the daily Sportstats request cap** (optional — defaults to 30/IP/UTC-calendar-day if
   unset; this project currently runs with 300, raised from the original default after it proved
   too aggressive for a normal onboarding + multi-search + large-import session):
   ```bash
   supabase secrets set SPORTSTATS_DAILY_REQUEST_CAP=300
   ```
   The window resets at UTC midnight, not 24h after the first request — see `discovery_rate_limit`
   in `migrations/0001_init.sql` and `checkAndIncrementRateLimit()` in `functions/race-discovery/
   index.ts`.
6. Copy `mobile/.env.example` to `mobile/.env` and fill in your project's URL and anon key (both
   found in Settings → API — **never put the service-role key or DB password in the mobile app**):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

## Kill switch

To disable Sportstats discovery without shipping an app update — e.g. if the provider starts
blocking traffic — flip the row directly:

```sql
update provider_config set enabled = false where provider = 'sportstats';
```

The app falls back to Manual Add Race automatically when discovery reports itself unavailable.

## What's here

- `migrations/0001_init.sql` — `athlete_profiles`, `races` (RLS-scoped per athlete, duplicate
  protection on `(athlete_id, provider, provider_result_id)`), and the provider-infrastructure
  tables `provider_config` / `discovery_rate_limit` (RLS enabled, no policies — only the Edge
  Function's service-role client touches them; the mobile app has zero access to either).
- `functions/race-discovery/` — the only place Sportstats-specific request/parsing logic lives.
  Three actions (`search`, `history` — unauthenticated; `detail` — requires a valid Supabase JWT,
  checked explicitly inside the function). Never writes to `races`/`athlete_profiles` — the
  authenticated mobile client persists selected races itself, through RLS.
