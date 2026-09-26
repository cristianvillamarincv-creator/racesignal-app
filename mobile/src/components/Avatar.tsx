import { StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

interface AvatarProps {
  initials: string;
  size?: number;
}

/** A quiet identity marker — a thin hairline ring, not a solid filled badge — so it reads as a
 *  restrained affordance next to header icons rather than a decorative circle competing with them.
 *  Never the visual hero of a screen (see Settings' identity header, which leads with the name). */
export function Avatar({ initials, size = 36 }: AvatarProps) {
  const palette = useBrandPalette();
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, borderColor: palette.hairline },
      ]}>
      <Text style={[styles.initials, { fontSize: size * 0.38, color: palette.inkSecondary }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  initials: {
    fontWeight: '600',
  },
});
