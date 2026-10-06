import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, PlanStatusRow, SettingsScroll, SettingsSection } from '@/components/settings/SettingsRows';
import { usePremium } from '@/lib/premium';
import { presentPremiumPaywall } from '@/lib/purchases';
import { SETTINGS_FREE_DETAIL, SETTINGS_FREE_TITLE, SETTINGS_PREMIUM_DETAIL, SETTINGS_UPGRADE_LABEL } from '@/lib/signalUsage';

/** Settings → Subscription: the current plan, the existing Premium offer and Restore Purchases. No live balance is shown here. */
export default function SubscriptionScreen() {
  const { isPremium, refresh: refreshPremiumStatus, restorePurchases } = usePremium();
  const [isRestoring, setIsRestoring] = useState(false);

  async function handleUpgradePress() {
    await presentPremiumPaywall();
    await refreshPremiumStatus();
  }

  async function handleRestorePress() {
    if (isRestoring) return;
    setIsRestoring(true);
    const restored = await restorePurchases();
    setIsRestoring(false);
    Alert.alert(
      restored ? 'Purchases restored' : 'Nothing to restore',
      restored ? 'Your RaceSignal Premium subscription is active on this device.' : 'No active RaceSignal Premium purchase was found for this account.',
    );
  }

  return (
    <SettingsScroll>
      <SettingsSection>
        {isPremium ? (
          <PlanStatusRow title="RaceSignal Premium" badge="ACTIVE" detail={SETTINGS_PREMIUM_DETAIL} icon="credit-card-outline" />
        ) : (
          <PlanStatusRow title={SETTINGS_FREE_TITLE} detail={SETTINGS_FREE_DETAIL} icon="credit-card-outline" />
        )}
        {isPremium ? null : <ActionRow label={SETTINGS_UPGRADE_LABEL} detail={SETTINGS_PREMIUM_DETAIL} icon="star-outline" onPress={handleUpgradePress} />}
        <ActionRow label={isRestoring ? 'Restoring…' : 'Restore Purchases'} icon="restore" onPress={handleRestorePress} />
      </SettingsSection>
    </SettingsScroll>
  );
}
