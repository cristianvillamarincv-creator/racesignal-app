import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

/**
 * The shared zero-race-history empty state — shown on Races and Stats whenever the athlete has no
 * confirmed races at all. Primary action is discovery (the highest-value path);
 * manual entry stays available as the fallback for races Sportstats can't find.
 */
export function BuildHistoryEmptyState() {
  const router = useRouter();
  const palette = useBrandPalette();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: palette.ink }]}>Build your race history</Text>
      <Text style={[styles.subtitle, { color: palette.inkSecondary }]}>Search race results to add your past races.</Text>

      <Pressable
        onPress={() => router.push('/find-races')}
        accessibilityRole="button"
        accessibilityLabel="Find my races"
        style={[styles.primaryButton, { backgroundColor: palette.signalBlue }]}>
        <Text style={[styles.primaryButtonLabel, { color: palette.onSignalBlue }]}>Find my races</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/race/add')}
        accessibilityRole="button"
        accessibilityLabel="Add race manually"
        style={[styles.secondaryButton, { borderColor: palette.hairline }]}>
        <Text style={[styles.secondaryButtonLabel, { color: palette.ink }]}>Add race manually</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: 999,
    marginTop: 12,
  },
  primaryButtonLabel: {
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});
