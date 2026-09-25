import { useColorScheme, type TextStyle } from 'react-native';

/**
 * "Race Morning Precision" — RaceSignal's emerging visual identity (Step 6): a light-first warm
 * paper canvas with dark ink typography, dark mode as a focused performance counterpart, medal
 * gold reserved strictly for earned achievements, and a restrained steel/signal-blue used only for
 * interactive elements. This is a SEPARATE, reusable token system from theme.ts's existing flat
 * dark-only palette — deliberately scoped to the completed race detail screen for now (Step 6.2).
 * Every other screen keeps using theme.ts unchanged until it's deliberately migrated; this module
 * exists precisely so that later migration (Races, Stats, Signal, upcoming race detail) can reuse
 * these same tokens rather than redefining them per screen.
 *
 * Contrast was chosen deliberately, not just for hue: secondary text uses a real mid-tone ink, not
 * a low-opacity gray, so it stays legible on-device; gold and signal-blue are both deep enough to
 * read clearly against the paper canvas rather than washing out.
 */

export interface BrandPalette {
  /** Base screen background — the "paper." */
  canvas: string;
  /** A very subtle step up from canvas, for the rare case something needs to sit slightly apart
   *  without becoming a bordered card. */
  canvasElevated: string;
  /** Primary text — the "ink." */
  ink: string;
  /** Secondary text (dates, paces, labels) — real contrast, not a faded gray. */
  inkSecondary: string;
  /** 1px structural rule color, used instead of card borders. */
  hairline: string;
  /** The one interactive color — links, the back chevron, Ask Signal. Never used decoratively. */
  signalBlue: string;
  /** Reserved strictly for earned achievements (a current PR, a podium) — never a generic accent.
   *  Used as a foreground color (icons, secondary-pill text) against the light canvas/elevated
   *  surfaces, so it stays legible there. */
  medalGold: string;
  /** The PR pill's own solid fill — a warmer, brighter brass than `medalGold` itself. A single
   *  "gold" value can't simultaneously read as a premium filled pill AND stay legible as a small
   *  foreground icon on the light canvas — this is the fill-specific variant; `medalGold` above is
   *  unchanged for every other (foreground) use. In dark mode these are the same value, since
   *  `medalGold` already works well as a fill there. */
  medalGoldFill: string;
  /** Destructive utility actions (Remove). */
  danger: string;
  /** Native header background — matches canvas for a seamless, card-free feel. */
  headerBackground: string;
  /** Text/icon color for content placed ON TOP of a solid `signalBlue` fill (e.g. the Signal
   *  module's arrow circle) — chosen per-mode for real contrast against that specific blue, not
   *  just "white text on a colored chip." */
  onSignalBlue: string;
  /** Same idea as `onSignalBlue`, for content placed on top of the solid `medalGoldFill` (the
   *  primary earned-achievement pill). */
  onMedalGold: string;
  /** Passed straight to expo-status-bar's <StatusBar style=... /> for this screen. */
  statusBarStyle: 'dark' | 'light';
}

const light: BrandPalette = {
  canvas: '#F8F7F3',
  canvasElevated: '#EFEDE6',
  ink: '#0C1720',
  inkSecondary: '#4E5B64',
  hairline: '#DDD9D0',
  signalBlue: '#2C5C82',
  medalGold: '#8A6B22',
  medalGoldFill: '#B8862E',
  danger: '#A63B2E',
  headerBackground: '#F8F7F3',
  onSignalBlue: '#FFFFFF',
  // Dark ink on the brighter brass fill — matches dark mode's own already-correct ink-on-gold
  // pattern below, instead of light-on-dark-gold.
  onMedalGold: '#0C1720',
  statusBarStyle: 'dark',
};

const dark: BrandPalette = {
  canvas: '#0B1218',
  canvasElevated: '#121B23',
  // Warm off-white, deliberately not pure white — reads as ink on a cool dark canvas rather than
  // stark screen-glow white.
  ink: '#F2ECDF',
  inkSecondary: '#B6AF9E',
  hairline: '#22303A',
  signalBlue: '#7CA9CE',
  medalGold: '#D4AF6A',
  // Already reads well as both a fill and a foreground here — no separate value needed.
  medalGoldFill: '#D4AF6A',
  danger: '#E1786A',
  headerBackground: '#0B1218',
  // dark's signalBlue is a light pastel tone (for contrast against the dark canvas) — a light
  // on-color would wash out on top of it, so this uses the dark canvas color instead.
  onSignalBlue: '#0B1218',
  // dark's medalGold is likewise a light tone — dark text/icon on top of it for contrast.
  onMedalGold: '#1A1206',
  statusBarStyle: 'light',
};

/** Picks the light or dark "Race Morning Precision" palette from the device's color scheme. */
export function useBrandPalette(): BrandPalette {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

/** Race data (finish times, splits, rankings) reads as tabular figures, never proportional. */
export const tabularNumerals: TextStyle = { fontVariant: ['tabular-nums'] };

/** Appends an alpha channel to a `#rrggbb` brand color — the shared way this palette's colors get
 *  used as a tint/fill (a pill's quiet background, the Signal module's surface) rather than a solid
 *  color, so every tinted surface derives from the same real color instead of a separately-picked
 *  approximation. */
export function withAlpha(hexColor: string, alpha: number): string {
  const alphaHex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hexColor}${alphaHex}`;
}
