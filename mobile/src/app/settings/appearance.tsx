import { ChoiceRow, SettingsNote, SettingsScroll, SettingsSection } from '@/components/settings/SettingsRows';
import { APPEARANCE_OPTIONS, setAppearancePreference, useAppearancePreference } from '@/lib/appearance';

/**
 * Settings → Appearance: Dark, Light or System. Presentation only. The choice applies immediately and is saved on this device;
 * with nothing saved the app is Dark.
 */
export default function AppearanceScreen() {
  const preference = useAppearancePreference();
  return (
    <SettingsScroll>
      <SettingsSection>
        {APPEARANCE_OPTIONS.map((option) => (
          <ChoiceRow key={option.value} label={option.label} detail={option.detail} selected={preference === option.value} onPress={() => void setAppearancePreference(option.value)} />
        ))}
      </SettingsSection>
      <SettingsNote>This only changes how RaceSignal looks on this device. It doesn’t change your races, profile or account.</SettingsNote>
    </SettingsScroll>
  );
}
