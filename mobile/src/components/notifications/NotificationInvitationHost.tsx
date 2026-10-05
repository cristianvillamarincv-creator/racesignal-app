import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInitialPaywallSettled } from '@/components/InitialPaywallGate';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { formatWeeklyPhrase, SIGNAL_ASK_NOTE } from '@/lib/notifications/format';
import { useNotifications, type Invitation } from '@/lib/notifications/NotificationsProvider';
import { useOverlayBlocked } from '@/lib/overlayBlockers';
import { spacing } from '@/lib/theme';

/**
 * The root-level notification invitation sheet. It appears only when an invitation is due AND it is safe: the initial paywall has settled and no
 * other overlay (the paywall itself, the Signal consent sheet) is showing; onboarding never reaches here (this lives in the app phase). Once
 * presented it stays until the athlete decides: "Enable" asks iOS for permission (only then), "Not now" dismisses the invitation permanently.
 * If iOS permission is denied the sheet explains where to turn it on and leaves the type off.
 */
export function NotificationInvitationHost() {
  const { invitation, prefs, enable, dismissInvitation, markInvitationPresented, openSystemSettings } = useNotifications();
  const settled = useInitialPaywallSettled();
  const blocked = useOverlayBlocked();
  const palette = useBrandPalette();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [active, setActive] = useState<Invitation | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Latch the invitation when it first becomes showable, so presenting it (which marks the one-time invitation as shown) does not remove it.
  useEffect(() => {
    if (active || !invitation || !settled || blocked) return;
    setActive(invitation);
    setDenied(false);
    if (invitation.kind === 'betweenRace') markInvitationPresented();
  }, [active, invitation, settled, blocked, markInvitationPresented]);

  if (!active) return null;

  const close = () => {
    setActive(null);
    setDenied(false);
  };

  async function onEnable() {
    if (busy || !active) return;
    setBusy(true);
    try {
      const result = await enable(active.kind);
      if (result === 'enabled') close();
      else setDenied(true);
    } finally {
      setBusy(false);
    }
  }

  async function onNotNow() {
    await dismissInvitation();
    close();
  }

  async function onDeniedClose() {
    await dismissInvitation(); // permission was refused: do not ask again; Settings explains how to turn it on
    close();
  }

  const racePrep = active.kind === 'racePrep';
  const weekly = formatWeeklyPhrase(prefs.racePrep.weeklyDay, prefs.racePrep.weeklyHour, prefs.racePrep.weeklyMinute);
  const between = formatWeeklyPhrase(prefs.betweenRace.day, prefs.betweenRace.hour, prefs.betweenRace.minute);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={denied ? onDeniedClose : onNotNow} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="notification-invitation">
          {denied ? (
            <>
              <Text style={styles.heading} accessibilityRole="header">
                Notifications are off for RaceSignal
              </Text>
              <Text style={styles.body}>
                iOS is not allowing notifications from RaceSignal. You can turn them on in iOS Settings, then switch these reminders on under Settings in RaceSignal.
              </Text>
              <Pressable onPress={() => void openSystemSettings()} accessibilityRole="button" accessibilityLabel="Open iOS Settings" style={[styles.primary, { backgroundColor: palette.signalBlue }]}>
                <Text style={[styles.primaryLabel, { color: palette.onSignalBlue }]}>Open iOS Settings</Text>
              </Pressable>
              <Pressable onPress={onDeniedClose} accessibilityRole="button" accessibilityLabel="Close" style={[styles.secondary, { borderColor: palette.hairline }]}>
                <Text style={[styles.secondaryLabel, { color: palette.ink }]}>Close</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.heading} accessibilityRole="header">
                {racePrep ? 'Stay ahead of race prep' : 'Think about what comes next'}
              </Text>
              <Text style={styles.body}>
                {racePrep
                  ? `Get a check-in ${weekly} about something still unchecked on your Race Prep list, plus a note one week and two days before each race. You can change the schedule or turn it off in Settings.`
                  : `Get one question ${between} to help you think about your next season. Tapping it opens a Signal draft you can edit. ${SIGNAL_ASK_NOTE} You can change the schedule or turn it off in Settings.`}
              </Text>
              <Pressable
                onPress={onEnable}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={racePrep ? 'Enable reminders' : 'Enable prompts'}
                style={[styles.primary, { backgroundColor: palette.signalBlue }, busy && styles.busy]}>
                <Text style={[styles.primaryLabel, { color: palette.onSignalBlue }]}>{racePrep ? 'Enable reminders' : 'Enable prompts'}</Text>
              </Pressable>
              <Pressable onPress={onNotNow} disabled={busy} accessibilityRole="button" accessibilityLabel="Not now" style={[styles.secondary, { borderColor: palette.hairline }]}>
                <Text style={[styles.secondaryLabel, { color: palette.ink }]}>Not now</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

interface Styles {
  overlay: ViewStyle;
  sheet: ViewStyle;
  heading: TextStyle;
  body: TextStyle;
  primary: ViewStyle;
  primaryLabel: TextStyle;
  secondary: ViewStyle;
  secondaryLabel: TextStyle;
  busy: ViewStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' },
    sheet: {
      backgroundColor: palette.canvasElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      gap: spacing.sm,
    },
    heading: { fontSize: 19, fontWeight: '700', color: palette.ink },
    body: { fontSize: 14, lineHeight: 20, color: palette.inkSecondary },
    primary: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 999, marginTop: spacing.sm },
    primaryLabel: { fontWeight: '700', fontSize: 15 },
    secondary: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 999, borderWidth: 1 },
    secondaryLabel: { fontWeight: '600', fontSize: 15 },
    busy: { opacity: 0.6 },
  });
}
