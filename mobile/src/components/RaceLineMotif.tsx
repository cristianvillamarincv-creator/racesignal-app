import { Image, StyleSheet, type ImageStyle } from 'react-native';

/**
 * RaceSignal's quiet background flourish — a sparse set of drifting, hand-drawn wavy lines,
 * inspired by course-elevation contours and a timing/pulse trace, not a literal topographic map. A
 * single static raster asset (generated offline, not a native SVG dependency — no new native
 * module, no dev-client rebuild needed), recolored per placement via `tintColor` and always kept at
 * a very low opacity so it reads as texture, never as content. Used behind the race hero/header
 * identity block (tinted `ink`) and behind the Signal module (tinted `signalBlue`) — nowhere else.
 */
export function RaceLineMotif({ tintColor, opacity = 0.05, style }: { tintColor: string; opacity?: number; style?: ImageStyle }) {
  return (
    <Image
      source={require('../assets/race-line-motif.png')}
      resizeMode="cover"
      style={[StyleSheet.absoluteFillObject, { tintColor, opacity }, style]}
    />
  );
}
