import { NotificationSettingsSection } from '@/components/notifications/NotificationSettingsSection';
import { SettingsScroll } from '@/components/settings/SettingsRows';

/** Settings → Notifications: the per-type switches, the editable schedule and the iOS permission message (all unchanged). */
export default function NotificationsSettingsScreen() {
  return (
    <SettingsScroll>
      <NotificationSettingsSection showHeader={false} />
    </SettingsScroll>
  );
}
