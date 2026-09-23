/**
 * Minimal, honest normalization — no fuzzy/alias inference. Two names that only differ by
 * surrounding whitespace, doubled internal spaces, or letter case are treated as the same input;
 * anything beyond that (nicknames, initials, reordered names, misspellings) is deliberately left
 * alone for a future milestone.
 */

/**
 * Collapses repeated internal whitespace and trims the ends, preserving original casing — this
 * is what actually gets sent as the search query and stored for display.
 *
 * Casing is deliberately NOT lower-cased here: verified live against
 * public.sportstats.one/namesearch (three requests, "Cristian Villamarin" /
 * "cristian villamarin" / "CRISTIAN VILLAMARIN") that Sportstats' own search is already
 * case-insensitive — all three returned the identical set of candidate athlete IDs. See
 * B1_ARCHITECTURE.md for the raw results. Forcing lowercase before sending the query would only
 * discard the athlete's original capitalization for no discovery benefit.
 */
export function normalizeNameForQuery(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Same whitespace normalization, additionally lower-cased — for comparing two names, never for
 *  display or for what's sent to a provider. */
export function normalizeNameForComparison(name: string): string {
  return normalizeNameForQuery(name).toLowerCase();
}

export function namesAreEquivalent(a: string, b: string): boolean {
  return normalizeNameForComparison(a) === normalizeNameForComparison(b);
}
