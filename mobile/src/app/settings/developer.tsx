import { Pressable, Text, View } from 'react-native';

import { NotificationDevTools } from '@/components/notifications/NotificationDevTools';
import { SettingsScroll, useSettingsStyles } from '@/components/settings/SettingsRows';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';
import { AppIcon } from '@/lib/icons';

/**
 * Settings → Developer tools: testing infrastructure, not product UI. Reached only from the single Developer entry, which is
 * shown only in development; each tool here keeps its own visibility gate (Preview onboarding needs the development preview
 * opt-in, the notification tools need the development app variant), so a production build shows neither.
 */
export default function DeveloperToolsScreen() {
  const { enterOnboardingReplayFromSettings } = useDevPreview();
  const showPreviewOnboarding = isDevPreviewAvailable();
  const { styles, palette } = useSettingsStyles();
  return (
    <SettingsScroll>
      {showPreviewOnboarding ? (
        <View style={styles.devSection}>
          <Pressable onPress={enterOnboardingReplayFromSettings} accessibilityRole="button" accessibilityLabel="Preview onboarding" style={styles.devRow}>
            <Text style={styles.devRowLabel}>Preview onboarding</Text>
            <AppIcon name="chevron-right" size={16} color={palette.inkSecondary} />
          </Pressable>
        </View>
      ) : null}
      <NotificationDevTools />
    </SettingsScroll>
  );
}
