-- Signal V1 conversation persistence (Step 5, physical-device finding: losing the whole analysis
-- on leaving the chat was unacceptable — a multi-turn Signal conversation is a valuable artifact,
-- especially once Signal is a paid feature). Deliberately minimal: two tables, no folders/search/
-- favorites, no trigger (matches this project's existing style of explicit multi-step client-side
-- writes rather than DB triggers — see insertConfirmedRaces in lib/db/races.ts).
--
-- Screenshot privacy is unaffected by this table: only text (including the model's own "From your
-- uploaded evidence" description) is ever persisted here — raw image bytes are never sent to
-- these tables, matching the existing per-conversation-turn-only image lifetime.
create table signal_conversations (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references athlete_profiles(id) on delete cascade,
  title         text not null,
  -- The race this conversation was seeded from, if any (Result Detail / upcoming Race Detail).
  -- Nullable, and set null (not cascaded) if that race is later removed — the conversation and its
  -- saved analysis are still worth keeping even if the source race is gone.
  seed_race_id  uuid references races(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table signal_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references signal_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  text             text not null,
  created_at       timestamptz not null default now()
);

create index signal_conversations_athlete_id_idx on signal_conversations (athlete_id);
create index signal_messages_conversation_id_idx on signal_messages (conversation_id);

alter table signal_conversations enable row level security;
alter table signal_messages enable row level security;

create policy "own signal conversations select" on signal_conversations for select using (athlete_id = auth.uid());
create policy "own signal conversations insert" on signal_conversations for insert with check (athlete_id = auth.uid());
-- Update is needed only to bump `updated_at` after a new turn — no title/seed-race editing in V1.
create policy "own signal conversations update" on signal_conversations for update using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());

-- signal_messages has no athlete_id column of its own — ownership is checked by joining through
-- the parent conversation, the only way to scope a child table this way in this schema.
create policy "own signal messages select" on signal_messages for select using (
  exists (select 1 from signal_conversations c where c.id = signal_messages.conversation_id and c.athlete_id = auth.uid())
);
create policy "own signal messages insert" on signal_messages for insert with check (
  exists (select 1 from signal_conversations c where c.id = signal_messages.conversation_id and c.athlete_id = auth.uid())
);
