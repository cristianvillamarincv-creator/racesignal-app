-- Preserves the provider's own recorded athlete display name on each imported race's provenance,
-- separate from athlete_profiles.racing_name (the authoritative name the athlete types and search
-- is run against). Populated when available (the discovery session that found this race knew
-- which identity it matched); left null otherwise rather than guessed.
alter table races add column provider_athlete_name text;
