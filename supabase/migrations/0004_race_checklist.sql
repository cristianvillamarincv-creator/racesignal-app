-- Restores the Race Prep checklist as a real, persisted feature (Step 4 final pass, round 2) —
-- previously a static, read-only fixture with hardcoded checked/unchecked state, identical for
-- every race. Only which items are checked off is persisted; the item labels/sections stay a
-- small fixed client-side template (mobile/src/lib/checklistTemplate.ts), matching the existing
-- `race.category`/`sport` pattern of not storing display copy in the database. Defaults to an
-- empty array so every existing row is valid with no backfill, and the existing "own races
-- update" RLS policy (migrations/0001_init.sql) already covers this column — no new policy needed.
alter table races add column checklist_completed text[] not null default '{}';
