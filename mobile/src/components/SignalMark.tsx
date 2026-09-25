import { Image } from 'react-native';

/**
 * RaceSignal's own proprietary signal mark — three restrained, parallel racing/timing lines,
 * staggered in length. Deliberately not an icon-library glyph (which reads as generic workflow/
 * network iconography): a small static raster asset, generated offline (no native SVG dependency,
 * no dev-client rebuild), recolored via `tintColor` like `RaceLineMotif`. Distinct from that
 * background texture — this is a small, bold, fully-opaque mark meant to stay legible as an actual
 * icon around 18-20px, not a low-opacity decorative wash.
 */
export function SignalMark({ color, size = 18 }: { color: string; size?: number }) {
  return <Image source={require('../assets/signal-mark.png')} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />;
}
