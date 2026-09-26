import type { Highlight } from '@/lib/highlights';

/**
 * Recognized, standard race-distance labels — DISPLAY grouping only, so Personal Bests reads as a
 * set of comparable peer achievements. Spellings match exactly what highlights.ts's
 * `canonicalDistanceLabel`/`CANONICAL_DISTANCE_ALIASES` table produces (this list is intentionally
 * NOT a copy of that table — it's a presentation allowlist over its OUTPUT). Per physical-device
 * review, anything real but not in this set (a noncanonical/free-typed label, e.g. a live-data
 * "Overall Results"/"Infinite Mile") is excluded from Stats entirely for V1 — never silently
 * promoted into the grid as a peer of 5K/10K/Half Marathon/etc. (an athlete's full history,
 * canonical or not, still lives on Races/Result Detail — this exclusion is presentation-only on
 * Stats, never a change to the underlying data). Extracted into its own module (rather than left
 * local to (tabs)/stats.tsx) specifically so this rule has direct regression coverage with
 * synthetic malformed labels — see __tests__/statsPresentation.test.ts.
 */
export const CANONICAL_DISTANCE_DISPLAY_LABELS = new Set<string>([
  '5K',
  '10K',
  '15K',
  'Half Marathon',
  'Marathon',
  'Sprint',
  'Olympic',
  '70.3',
  '140.6',
]);

/** Personal Bests filter — only a canonical distance label renders in the Record Board at all. */
export function isDistanceCanonicalForStats(distanceLabel: string): boolean {
  return CANONICAL_DISTANCE_DISPLAY_LABELS.has(distanceLabel);
}

/**
 * Matches exactly the three label shapes `lib/highlights.ts`'s `distancePRHighlight()` produces —
 * `"${groupKey} PR"`, `"${groupKey} PR Performance"`, `"First recorded ${groupKey}"` — each of which
 * embeds the same distance/category grouping key Personal Bests validates above. Any OTHER
 * highlight label (age-group podium, notable age-group finish, course best, fastest split, etc.)
 * doesn't match any of these and is left alone: this only ever validates a highlight that is
 * *itself* a distance/category PR, never every highlight on the screen.
 */
const DISTANCE_TIED_HIGHLIGHT_LABEL_PATTERNS = [/^(.+) PR$/, /^(.+) PR Performance$/, /^First recorded (.+)$/];

/** Presentation-only filter, mirroring the exact principle already applied to Personal Bests: a
 *  PR-type highlight tied to a noncanonical/unrecognized distance (e.g. a live-data "Infinite Mile
 *  PR" or "Overall Results PR") is excluded from Stats — never deleted from the underlying race
 *  record, never remapped, never invented a canonical spelling for. */
export function isHighlightCanonicalForStats(highlight: Highlight): boolean {
  for (const pattern of DISTANCE_TIED_HIGHLIGHT_LABEL_PATTERNS) {
    const match = highlight.label.match(pattern);
    if (match) return CANONICAL_DISTANCE_DISPLAY_LABELS.has(match[1]!);
  }
  return true;
}
