import { StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function EmptyState({ title, subtitle, children }: EmptyStateProps) {
  const palette = useBrandPalette();
  return (
    <View style={styles.container} accessibilityRole="text">
      <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: palette.inkSecondary }]}>{subtitle}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
  },
  actions: {
    marginTop: 12,
  },
});
