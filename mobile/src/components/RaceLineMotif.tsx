import { Image, StyleSheet, type ImageStyle } from 'react-native';

import { useColorScheme } from '@/lib/appearance';

interface RaceLineMotifProps {
  /** No longer applied to the image — kept only so this component's 5 existing call sites
   *  (results/[id].tsx, race/[id].tsx, SignalModule.tsx, RaceCountdownCard.tsx, OnboardingFlow.tsx)
   *  don't need to change. The supplied production artwork is a finished, theme-tuned asset — see
   *  this component's own doc comment — and is never recolored. */
  tintColor?: string;
  /** No longer applied — every existing call site still passes its own low value (0.035-0.07),
   *  tuned for the OLD procedurally-tinted asset. The final supplied PNGs already bake in their own
   *  intended subtle alpha, so stacking a second opacity multiplier on top of that crushed the
   *  motif to near-invisible on the physical device. Kept in the signature purely so those 5 call
   *  sites — all of them inside screens/components explicitly frozen for this pass — never need to
   *  change; the component itself always renders at the PNG's own baked-in alpha instead. */
  opacity?: number;
  style?: ImageStyle;
}

/**
 * RaceSignal's proprietary course-line motif — final production artwork, supplied directly as a
 * dark-mode/light-mode PNG pair (mobile/src/assets/race-line-motif-dark.png /
 * race-line-motif-light.png), never procedurally generated, traced, or recolored. The correct
 * asset for the device's current appearance is picked internally via `useColorScheme()` — the same
 * way brandTheme.ts's `useBrandPalette()` picks its own palette — so no call site needs to know or
 * pass which theme is active. Rendered at `opacity: 1` — the supplied PNGs already carry their own
 * intended subtle alpha baked in, so this reads as texture behind content without a second
 * attenuation pass fading it below visibility. Used behind the race hero/header identity block
 * (Race Detail, upcoming Race Detail, the Races-tab upcoming hero, onboarding's identity headline)
 * and behind the Signal module — nowhere else, and never on a new screen.
 */
export function RaceLineMotif({ style }: RaceLineMotifProps) {
  const scheme = useColorScheme();
  const source = scheme === 'dark' ? require('../assets/race-line-motif-dark.png') : require('../assets/race-line-motif-light.png');
  return <Image source={source} resizeMode="cover" style={[StyleSheet.absoluteFillObject, { opacity: 1 }, style]} />;
}
