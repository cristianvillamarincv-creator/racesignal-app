-- Durable onboarding-complete signal, replacing "does an athlete_profiles row exist" (which we
-- observed can be true in a broken/incomplete state — a row with an empty racing_name and zero
-- races) and replacing a local-only AsyncStorage flag (which doesn't survive a force-close before
-- the athlete taps through the summary screen). Set exactly once, at the end of the onboarding
-- import attempt (see OnboardingFlow.tsx's runImport), regardless of how many races were saved —
-- an athlete completing onboarding with zero races is a valid, complete state, not an error.
alter table athlete_profiles add column onboarding_completed_at timestamptz;
