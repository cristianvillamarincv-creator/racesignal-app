import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/lib/theme';

interface ErrorStateProps {
  title?: string;
  subtitle?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  subtitle = "We couldn't load this right now. Please try again shortly.",
}: ErrorStateProps) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    ...typography.subtitle,
    color: colors.danger,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
  },
});
