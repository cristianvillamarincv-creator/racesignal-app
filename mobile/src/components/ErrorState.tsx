import { StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

interface ErrorStateProps {
  title?: string;
  subtitle?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  subtitle = "We couldn't load this right now. Please try again shortly.",
}: ErrorStateProps) {
  const palette = useBrandPalette();
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={[styles.title, { color: palette.danger }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: palette.inkSecondary }]}>{subtitle}</Text>
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
});
