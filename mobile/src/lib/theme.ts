/**
 * Visual tokens for RaceSignal. The full brand system (final palette, iconography, app icon,
 * wordmark) is deferred to a later milestone — this is a lightweight V1 pass toward that
 * direction, not the final system. Two colors carry real meaning now and should be used by
 * intent, not swapped in ad hoc:
 *  - `achievement` (champagne/gold) — a PR, a podium, "you did this." Reserved for actual
 *    accomplishments (AchievementBadge, HighlightCard, Personal Bests, the onboarding reveal)
 *    so it stays special rather than becoming another generic accent.
 *  - `accent` (sage/aqua) — progress, active/selected state, in-flight actions. Everything that
 *    used to be a flat mint accent (buttons, active tabs/filters, progress bars, countdowns)
 *    stays wired to this token, just retinted — no per-screen changes needed for that shift.
 * Swap the values here when a final brand system lands; screens should never hardcode
 * colors/spacing directly.
 */

export const colors = {
  background: '#0B0F14',
  surface: '#141A21',
  surfaceElevated: '#1C232B',
  border: '#2A333D',
  textPrimary: '#F2F5F7',
  textSecondary: '#9AA7B2',
  textMuted: '#6B7680',
  accent: '#5CA896',
  accentMuted: '#2E4A42',
  achievement: '#D4B06A',
  warning: '#E8B34F',
  danger: '#E8615A',
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '700' as const, color: colors.textPrimary },
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.textPrimary },
  subtitle: { fontSize: 17, fontWeight: '600' as const, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.textPrimary },
  caption: { fontSize: 13, fontWeight: '500' as const, color: colors.textSecondary },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.textSecondary },
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const minTouchSize = 44;
