/**
 * B.14 — a physical-device recording showed a pasted `mailto:` prefix landing in the Email field
 * (an artifact of copying an email address out of a link rather than plain text) and silently
 * failing sign-in with no explanation. `normalizeEmailInput` strips exactly that one known paste
 * artifact (case-insensitively) plus surrounding whitespace — deliberately narrow, not a general
 * "guess what the user meant" cleanup. `isPlausibleEmail` is a basic, permissive shape check (not
 * full RFC 5322 validation — Supabase Auth is the real authority on whether an address exists) used
 * only to give a clear, immediate "enter a valid email" message instead of sending an obviously
 * malformed value and getting back a generic, confusing "Invalid login credentials".
 */
export function normalizeEmailInput(raw: string): string {
  return raw.trim().replace(/^mailto:/i, '').trim();
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
