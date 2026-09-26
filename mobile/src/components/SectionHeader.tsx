import { StyleSheet, Text, View } from 'react-native';

import { useBrandPalette } from '@/lib/brandTheme';

interface SectionHeaderProps {
  title: string;
  action?: string;
}

/** Plain title-case editorial label, matching the north-star Result Detail screen's section
 *  headers ("Splits", "Placement") — tracked uppercase captions are reserved for the hero kicker
 *  line only, not used generically for every section title. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  const palette = useBrandPalette();
  return (
    <View style={styles.row} accessibilityRole="header">
      <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
      {action ? <Text style={[styles.action, { color: palette.signalBlue }]}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  action: {
    fontSize: 13,
    fontWeight: '600',
  },
});
