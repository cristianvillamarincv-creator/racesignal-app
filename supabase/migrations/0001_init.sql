-- RaceSignal B.1 — initial schema.
-- One athlete profile per authenticated user, one races table covering discovered, confirmed,
-- and manually-added races (both historical and upcoming). See B1_ARCHITECTURE.md for the
-- reasoning behind each decision below.

create table athlete_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  racing_name  text not null,
  birth_year   int,               -- optional; match-evidence only, never identity proof
  created_at   timestamptz not null default now()
);

create table races (
  id                    uuid primary key default gen_random_uuid(),
  athlete_id            uuid not null references athlete_profiles(id) on delete cascade,

  -- import lifecycle. Only 'confirmed'/'removed' are used in B.1 — discovery candidates stay
  -- ephemeral/client-side and are never written here until the athlete selects them. The check
  -- constraint is written to allow 'candidate'/'rejected' to be added later without a migration
  -- that touches existing rows.
  import_status         text not null default 'confirmed'
                           check (import_status in ('candidate', 'confirmed', 'rejected', 'removed')),

  -- race lifecycle — distinct from import_status. Mirrors mobile/src/fixtures/races.ts's
  -- RaceStatus so the DB→app mapping is a straight passthrough for this field.
  race_status           text not null default 'completed'
                           check (race_status in ('considering', 'registered', 'completed')),

  -- provenance
  provider              text not null,          -- 'sportstats' | 'manual'
  provider_result_id    text,                    -- null for manual entries
  source_url            text,
  import_method          text not null,          -- 'discovery_automated' | 'manual_entry'
  imported_at            timestamptz not null default now(),
  confirmed_at            timestamptz not null default now(),
  match_evidence          jsonb,                  -- string[]; informational only, not queried post-import
  source_notes            text[],

  -- date model: exact date for upcoming races and any historical race where the day is known;
  -- year-only for historical races where the source never recorded an exact date. Never invent a
  -- January 1st.
  event_date              date,
  event_year              int not null,
  date_precision          text not null check (date_precision in ('day', 'year')),

  -- race data
  event_name              text not null,
  location                text,
  sport                   text,
  category                text,
  finish_seconds           int,
  bib                      text,
  overall_rank_place       int,
  overall_rank_field       int,
  gender_rank_place        int,
  gender_rank_field        int,
  age_group_rank_place     int,
  age_group_rank_field     int,
  age_group_category       text,
  splits                   jsonb,                -- RaceSplit[]: [{label, splitSeconds, totalSeconds, pace}]

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint event_date_precision_consistent check (
    (date_precision = 'day'  and event_date is not null) or
    (date_precision = 'year' and event_date is null)
  )
);

-- Duplicate protection: the same provider result can never be imported twice for one athlete.
-- Partial index so manual entries (provider_result_id is null) are never constrained against
-- each other.
create unique index races_athlete_provider_result_uniq
  on races (athlete_id, provider, provider_result_id)
  where provider_result_id is not null;

create index races_athlete_id_idx on races (athlete_id);

alter table athlete_profiles enable row level security;
alter table races enable row level security;

create policy "own profile select" on athlete_profiles for select using (id = auth.uid());
create policy "own profile insert" on athlete_profiles for insert with check (id = auth.uid());
create policy "own profile update" on athlete_profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "own races select" on races for select using (athlete_id = auth.uid());
create policy "own races insert" on races for insert with check (athlete_id = auth.uid());
create policy "own races update" on races for update using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());

-- Provider infrastructure — kill switch + outbound-request rate limiting for the race-discovery
-- Edge Function. RLS is enabled with NO policies: the mobile client (anon/authenticated key) gets
-- zero access via PostgREST either way. Only the Edge Function's service-role client touches
-- these two tables — it is never used to write athlete_profiles/races, which stay
-- client-authenticated + RLS-governed per the B.1 architecture decision.
create table provider_config (
  provider     text primary key,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table provider_config enable row level security;
insert into provider_config (provider, enabled) values ('sportstats', true);

create table discovery_rate_limit (
  ip_address     text not null,
  window_date    date not null,
  request_count  int not null default 0,
  primary key (ip_address, window_date)
);
alter table discovery_rate_limit enable row level security;
