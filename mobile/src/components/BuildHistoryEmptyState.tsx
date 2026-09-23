import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/lib/theme';

/**
 * The shared zero-race-history empty state — shown on Home, Season, and Stats whenever the
 * athlete has no confirmed races at all. Primary action is discovery (the highest-value path);
 * manual entry stays available as the fallback for races Sportstats can't find.
 */
export function BuildHistoryEmptyState() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={typography.title}>Build your race history</Text>
      <Text style={styles.subtitle}>Search race results to add your past races.</Text>

      <Pressable
        onPress={() => router.push('/find-races')}
        accessibilityRole="button"
        accessibilityLabel="Find my races"
        style={styles.primaryButton}>
        <Text style={styles.primaryButtonLabel}>Find my races</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/race/add')}
        accessibilityRole="button"
        accessibilityLabel="Add race manually"
        style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonLabel}>Add race manually</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  primaryButtonLabel: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  secondaryButtonLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
