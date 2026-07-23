import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

interface AvatarProps {
  initials: string;
  size?: number;
}

export function Avatar({ initials, size = 36 }: AvatarProps) {
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: colors.accent,
    fontWeight: '700',
  },
});
