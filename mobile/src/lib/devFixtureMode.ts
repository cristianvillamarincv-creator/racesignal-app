/**
 * Milestone A has no backend, so there is no real loading/empty/error state to trigger
 * organically. This single constant stands in for that: edit it by hand and reload the app to
 * preview how each screen looks in that state. A future milestone (once there's a real data
 * layer worth simulating failure/latency for) can replace this with something dynamic.
 */
export type DevFixtureMode = 'populated' | 'empty' | 'error';

export const DEV_FIXTURE_MODE: DevFixtureMode = 'populated';
