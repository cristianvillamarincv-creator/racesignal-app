import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography } from '@/lib/theme';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function EmptyState({ title, subtitle, children }: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="text">
      <Text style={typography.subtitle}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
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
  subtitle: {
    ...typography.body,
    textAlign: 'center',
  },
  actions: {
    marginTop: spacing.md,
  },
});
