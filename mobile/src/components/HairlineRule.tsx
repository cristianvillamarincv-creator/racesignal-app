import { StyleSheet, View } from 'react-native';

/**
 * A single 1px structural rule — the editorial alternative to wrapping every section in a bordered
 * card. Takes `color` as a prop rather than importing a palette directly, so it stays reusable
 * across whichever theme system (theme.ts today, brandTheme.ts's "Race Morning Precision" tokens
 * as they propagate) a given screen is using.
 */
export function HairlineRule({ color }: { color: string }) {
  return <View style={[styles.rule, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  rule: {
    height: StyleSheet.hairlineWidth,
  },
});
