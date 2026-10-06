import { NotificationDevTools } from '@/components/notifications/NotificationDevTools';
import { ActionRow, SettingsScroll, SettingsSection } from '@/components/settings/SettingsRows';
import { isDevPreviewAvailable, useDevPreview } from '@/lib/devPreview';

/**
 * Settings → Developer tools: testing infrastructure, not product UI. Reached only from the single Developer entry, which is
 * shown only in development; each tool here keeps its own visibility gate (Preview onboarding needs the development preview
 * opt-in, the notification tools need the development app variant), so a production build shows neither.
 */
export default function DeveloperToolsScreen() {
  const { enterOnboardingReplayFromSettings } = useDevPreview();
  const showPreviewOnboarding = isDevPreviewAvailable();
  return (
    <SettingsScroll>
      {showPreviewOnboarding ? (
        <SettingsSection dashed>
          <ActionRow label="Preview onboarding" icon="play-circle-outline" onPress={enterOnboardingReplayFromSettings} />
        </SettingsSection>
      ) : null}
      <NotificationDevTools />
    </SettingsScroll>
  );
}
