import { Image, type ImageSourcePropType } from 'react-native';

interface TabIconImageProps {
  source: ImageSourcePropType;
  color: string;
  size?: number;
}

/**
 * Renders one of the supplied production tab-bar glyphs (mobile/src/assets/races-tab-icon.png,
 * stats-tab-icon.png) — flat monochrome transparent PNGs meant to be tinted by the app, same
 * `tintColor` pattern SignalMark.tsx already uses for the Signal tab's own mark. Never redraws,
 * recolors the source file, or generates a filled/outline pair — a single asset tinted per active/
 * inactive state via `tabBarActiveTintColor`/`tabBarInactiveTintColor`, exactly like SignalMark.
 */
export function TabIconImage({ source, color, size = 22 }: TabIconImageProps) {
  return <Image source={source} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />;
}
