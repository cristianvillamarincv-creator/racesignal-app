import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography } from '@/lib/theme';

interface SectionHeaderProps {
  title: string;
  action?: string;
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <Text style={typography.label}>{title.toUpperCase()}</Text>
      {action ? <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  action: {
    ...typography.label,
  },
});
