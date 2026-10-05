import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { HairlineRule } from '@/components/HairlineRule';
import { SectionHeader } from '@/components/SectionHeader';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { getAppVariant } from '@/lib/environment';
import { fromDate } from '@/lib/notifications/localTime';
import { PAYLOAD_VERSION, type TapPayload } from '@/lib/notifications/payload';
import { buildMilestoneContent, buildWeeklyContent, eligibleUpcomingRaces, TEST_IDENTIFIER_PREFIX } from '@/lib/notifications/planner';
import { BETWEEN_RACE_PROMPTS } from '@/lib/notifications/prompts';
import { cancelTests, describePending } from '@/lib/notifications/reconcile';
import { useNotifications } from '@/lib/notifications/NotificationsProvider';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * Development-variant-only tools to try notifications without waiting a week. Each test schedules a REAL local notification with the same
 * content builders, tap payload and calendar trigger a real reminder uses, about 1 to 2 minutes from now (identifiers start with "rs-test:" so
 * normal reconciliation leaves them alone). Not rendered in the production variant.
 */
export function NotificationDevTools() {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { api } = useNotifications();
  const { session } = useAuth();
  const races = useAthleteRaces();
  const [message, setMessage] = useState<string>('');
  const [pendingLines, setPendingLines] = useState<string[]>([]);

  if (getAppVariant() !== 'development') return null;
  const athleteId = session?.user.id;

  async function ensurePermission(): Promise<boolean> {
    let state = await api.getPermission();
    if (state === 'undetermined') state = await api.requestPermission();
    if (state !== 'granted') setMessage('iOS notification permission is not granted for this app.');
    return state === 'granted';
  }

  async function scheduleTest(label: string, title: string, body: string, data: TapPayload) {
    if (!athleteId || !(await ensurePermission())) return;
    // At least 60 seconds ahead, on a minute boundary (calendar triggers have minute resolution).
    const fireDate = new Date(Date.now() + 90_000);
    fireDate.setSeconds(0, 0);
    const fireAt = fromDate(fireDate);
    await api.schedule({ identifier: `${TEST_IDENTIFIER_PREFIX}${athleteId}:${label}:${Date.now()}`, title, body, data: data as unknown as Record<string, unknown>, fireAt });
    setMessage(`Scheduled "${label}" for ${String(fireAt.hour).padStart(2, '0')}:${String(fireAt.minute).padStart(2, '0')}. Background or lock the app to see the banner.`);
  }

  function nearestRace() {
    const first = eligibleUpcomingRaces(races.data, new Date())[0];
    if (!first) setMessage('Save an upcoming race first (race-prep tests use your nearest one).');
    return first?.race ?? null;
  }

  async function raceTest(kind: 'weekly' | 'seven' | 'two') {
    const race = nearestRace();
    if (!race || !athleteId) return;
    const content = kind === 'weekly' ? buildWeeklyContent(race, 21) : buildMilestoneContent(race, kind === 'seven' ? 7 : 2);
    await scheduleTest(kind, 'Race prep', content.body, { v: PAYLOAD_VERSION, a: athleteId, t: 'prep', r: race.id, ...(content.itemId ? { i: content.itemId } : {}) });
  }

  async function promptTest() {
    if (!athleteId) return;
    const prompt = BETWEEN_RACE_PROMPTS[Math.floor(Math.random() * BETWEEN_RACE_PROMPTS.length)]!;
    await scheduleTest('between', 'Think about what comes next', prompt.question, { v: PAYLOAD_VERSION, a: athleteId, t: 'between', p: prompt.id });
  }

  async function showPending() {
    setPendingLines(describePending(await api.listPending()));
  }

  async function clearTests() {
    const count = await cancelTests(api);
    setMessage(`Cancelled ${count} test notification${count === 1 ? '' : 's'}.`);
  }

  const buttons: { label: string; onPress: () => void }[] = [
    { label: 'Race-prep weekly in ~1 min', onPress: () => void raceTest('weekly') },
    { label: 'Seven-day milestone in ~1 min', onPress: () => void raceTest('seven') },
    { label: 'Two-day milestone in ~1 min', onPress: () => void raceTest('two') },
    { label: 'Between-race prompt in ~1 min', onPress: () => void promptTest() },
    { label: 'Show pending notifications', onPress: () => void showPending() },
    { label: 'Cancel test notifications', onPress: () => void clearTests() },
  ];

  return (
    <View style={styles.section} testID="notification-dev-tools">
      <SectionHeader title="Notification test tools (development only)" />
      <HairlineRule color={palette.hairline} />
      {buttons.map((button) => (
        <Pressable key={button.label} onPress={button.onPress} accessibilityRole="button" accessibilityLabel={button.label} style={styles.button}>
          <Text style={styles.buttonLabel}>{button.label}</Text>
        </Pressable>
      ))}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {pendingLines.length > 0 ? (
        <View style={styles.pending}>
          <Text style={styles.message}>{pendingLines.length} pending:</Text>
          {pendingLines.slice(0, 40).map((line, index) => (
            <Text key={index} style={styles.pendingLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface Styles {
  section: ViewStyle;
  button: ViewStyle;
  buttonLabel: TextStyle;
  message: TextStyle;
  pending: ViewStyle;
  pendingLine: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    section: { gap: spacing.xs },
    button: { minHeight: minTouchSize, justifyContent: 'center' },
    buttonLabel: { fontSize: 15, fontWeight: '600', color: palette.signalBlue },
    message: { fontSize: 13, color: palette.inkSecondary },
    pending: { gap: 2 },
    pendingLine: { fontSize: 12, color: palette.inkSecondary },
  });
}
