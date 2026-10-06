import { useEffect, useState } from 'react';
import { ActionRow, PlanStatusRow, SettingsScroll, SettingsSection } from '@/components/settings/SettingsRows';
import { useAuth } from '@/lib/auth';
import { clearSignalConsent, hasAgreedToSignalDisclosure } from '@/lib/signalConsent';

/**
 * Settings → Signal privacy & consent. The sheet in components/SignalConsentSheet.tsx re-prompts the very next time Signal would
 * send anything once consent is withdrawn. Nothing to withdraw before the athlete has ever agreed, so that case is a quiet status line.
 */
export default function SignalPrivacyScreen() {
  const { session } = useAuth();
  const [hasSignalConsent, setHasSignalConsent] = useState(false);

  useEffect(() => {
    const athleteId = session?.user.id;
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const agreed = await hasAgreedToSignalDisclosure(athleteId);
      if (!cancelled) setHasSignalConsent(agreed);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  async function handleWithdrawSignalConsent() {
    await clearSignalConsent();
    setHasSignalConsent(false);
  }

  return (
    <SettingsScroll>
      <SettingsSection>
        <PlanStatusRow
          title="Signal & Anthropic"
          icon="shield-lock-outline"
          detail={hasSignalConsent ? 'You’ve agreed to share race data with Anthropic for Signal.' : 'Not yet agreed — you’ll be asked before your first Signal question.'}
        />
        {hasSignalConsent ? <ActionRow label="Withdraw Signal consent" icon="close-circle-outline" onPress={handleWithdrawSignalConsent} /> : null}
      </SettingsSection>
    </SettingsScroll>
  );
}
