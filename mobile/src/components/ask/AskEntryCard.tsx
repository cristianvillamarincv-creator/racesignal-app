import { Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/Card';
import type { AskEntry } from '@/fixtures/ask';
import { spacing, typography } from '@/lib/theme';

interface AskEntryCardProps {
  entry: AskEntry;
  onPress: () => void;
}

export function AskEntryCard({ entry, onPress }: AskEntryCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={entry.title}
      style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.card}>
        <Text style={typography.subtitle}>{entry.title}</Text>
        <Text style={styles.description}>{entry.description}</Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  description: {
    ...typography.caption,
  },
  pressed: {
    opacity: 0.8,
  },
});
