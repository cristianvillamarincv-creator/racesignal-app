import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import type { Highlight } from '@/lib/highlights';
import { AppIcon } from '@/lib/icons';
import { colors, spacing, typography } from '@/lib/theme';

interface HighlightCardProps {
  highlight: Highlight;
  onPress: () => void;
}

/**
 * A tappable "achievement, worth screenshotting" card: what happened, the number, and where —
 * replaces the old plain-text Notable Performances list.
 */
export function HighlightCard({ highlight, onPress }: HighlightCardProps) {
  const { race, icon, label, value } = highlight;
  const year = race.eventDate.slice(0, 4);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${value ? `, ${value}` : ''}, ${race.name}, ${year}`}>
      <Card style={styles.card}>
        <View style={styles.labelRow}>
          <AppIcon name={icon} size={16} color={colors.accent} />
          <Text style={styles.label}>{label}</Text>
        </View>
        {value ? <Text style={styles.value}>{value}</Text> : null}
        <View style={styles.footerRow}>
          <Text style={styles.raceLabel}>
            {race.name} · {year}
          </Text>
          <Text style={styles.arrow}>→</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...typography.subtitle,
  },
  value: {
    ...typography.display,
    fontSize: 26,
    color: colors.accent,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  raceLabel: {
    ...typography.caption,
    flexShrink: 1,
  },
  arrow: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
});
