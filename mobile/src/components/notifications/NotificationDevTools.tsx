import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { HairlineRule } from '@/components/HairlineRule';
import { SectionHeader } from '@/components/SectionHeader';
import { useAuth } from '@/lib/auth';
import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { getAppVariant } from '@/lib/environment';
import { diagnose, describeError, runDeliveryTest, TEST_LABELS, withTimeout, type TestKind } from '@/lib/notifications/devTests';
import { useNotifications } from '@/lib/notifications/NotificationsProvider';
import { describePending, cancelTests } from '@/lib/notifications/reconcile';
import { useAthleteRaces } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

/**
 * Development-variant-only tools to prove notifications without waiting a week. Every button reports what happened on screen: the real iOS
 * permission, any missing prerequisite, the identifier it scheduled and when iOS says it will fire, and whether iOS lists it as pending afterwards.
 * Every step is time-bounded and the busy state is always cleared, so the screen cannot stay stuck. Test notifications are identified "rs-test:" and
 * are never touched by normal reconciliation. Start with "Test notification in 60 seconds": it needs no race, entitlement or model call.
 */
const ORDER: TestKind[] = ['basic', 'calendar', 'weekly', 'seven', 'two', 'between'];

interface Result {
  ok: boolean;
  text: string;
  at: string;
  needsSettings?: boolean;
}

export function NotificationDevTools() {
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { api, openSystemSettings } = useNotifications();
  const { session } = useAuth();
  const races = useAthleteRaces();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<string, Result>>>({});
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [pendingLines, setPendingLines] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      return null;
    }
  })();

  const refreshDiagnostics = useCallback(async () => {
    const result = await diagnose({ api, races: races.data, now: new Date(), timeZone });
    if (mounted.current) setDiagnostics(result.lines);
  }, [api, races.data, timeZone]);

  useEffect(() => {
    if (getAppVariant() === 'development') void refreshDiagnostics();
  }, [refreshDiagnostics]);

  if (getAppVariant() !== 'development') return null;

  /** Runs one action with the busy state guaranteed to clear, and never lets an exception escape. */
  async function guarded(key: string, action: () => Promise<Result>) {
    if (busy) return;
    setBusy(key);
    setResults((current) => ({ ...current, [key]: { ok: true, text: 'Working…', at: new Date().toLocaleTimeString() } }));
    let result: Result;
    try {
      result = await withTimeout(action(), 90_000, 'This test');
    } catch (err) {
      result = { ok: false, text: `Failed: ${describeError(err)}`, at: new Date().toLocaleTimeString() };
    }
    console.log(`[notification-test] ${key}:`, result.text);
    if (mounted.current) {
      setResults((current) => ({ ...current, [key]: result }));
      setBusy(null);
      void refreshDiagnostics();
    }
  }

  const runTest = (kind: TestKind) =>
    guarded(kind, async () => {
      const outcome = await runDeliveryTest(kind, { api, athleteId: session?.user.id ?? null, races: races.data, now: new Date(), timeZone });
      return { ok: outcome.ok, text: outcome.message, at: new Date().toLocaleTimeString(), needsSettings: outcome.needsSettings };
    });

  const showPending = () =>
    guarded('pending', async () => {
      const pending = await withTimeout(api.listPending(), 10_000, 'Reading pending notifications');
      const lines = describePending(pending);
      setPendingLines(lines);
      return { ok: true, text: `iOS lists ${pending.length} pending notification${pending.length === 1 ? '' : 's'}.`, at: new Date().toLocaleTimeString() };
    });

  const clearTests = () =>
    guarded('cancel', async () => {
      const count = await withTimeout(cancelTests(api), 10_000, 'Cancelling');
      return { ok: true, text: `Cancelled ${count} test notification${count === 1 ? '' : 's'}.`, at: new Date().toLocaleTimeString() };
    });

  const anyNeedsSettings = Object.values(results).some((result) => result?.needsSettings);

  return (
    <View style={styles.section} testID="notification-dev-tools">
      <SectionHeader title="Notification test tools (development only)" />
      <HairlineRule color={palette.hairline} />

      <View style={styles.diagnostics} testID="notification-diagnostics">
        {diagnostics.map((line, index) => (
          <Text key={index} style={styles.diagnosticLine}>
            {line}
          </Text>
        ))}
        <Pressable onPress={() => void refreshDiagnostics()} accessibilityRole="button" accessibilityLabel="Refresh diagnostics" style={styles.link}>
          <Text style={styles.linkLabel}>Refresh diagnostics</Text>
        </Pressable>
        {anyNeedsSettings ? (
          <Pressable onPress={() => void openSystemSettings()} accessibilityRole="button" accessibilityLabel="Open iOS Settings" style={styles.link}>
            <Text style={styles.linkLabel}>Open iOS Settings</Text>
          </Pressable>
        ) : null}
      </View>

      {ORDER.map((kind) => (
        <View key={kind} style={styles.testBlock}>
          <Pressable
            onPress={() => void runTest(kind)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={TEST_LABELS[kind]}
            accessibilityState={{ disabled: busy !== null, busy: busy === kind }}
            style={[styles.button, busy !== null && styles.dimmed]}>
            <Text style={styles.buttonLabel}>{TEST_LABELS[kind]}</Text>
          </Pressable>
          {results[kind] ? (
            <Text style={[styles.result, results[kind]!.ok ? styles.resultOk : styles.resultError]} accessibilityRole="alert" testID={`result-${kind}`}>
              {`${results[kind]!.at}  ${results[kind]!.text}`}
            </Text>
          ) : null}
        </View>
      ))}

      <Pressable onPress={() => void showPending()} disabled={busy !== null} accessibilityRole="button" accessibilityLabel="Show pending notifications" style={[styles.button, busy !== null && styles.dimmed]}>
        <Text style={styles.buttonLabel}>Show pending notifications</Text>
      </Pressable>
      {results.pending ? <Text style={styles.result}>{`${results.pending.at}  ${results.pending.text}`}</Text> : null}
      {pendingLines.slice(0, 40).map((line, index) => (
        <Text key={index} style={styles.pendingLine}>
          {line}
        </Text>
      ))}
      <Pressable onPress={() => void clearTests()} disabled={busy !== null} accessibilityRole="button" accessibilityLabel="Cancel test notifications" style={[styles.button, busy !== null && styles.dimmed]}>
        <Text style={styles.buttonLabel}>Cancel test notifications</Text>
      </Pressable>
      {results.cancel ? <Text style={styles.result}>{`${results.cancel.at}  ${results.cancel.text}`}</Text> : null}
    </View>
  );
}

interface Styles {
  section: ViewStyle;
  diagnostics: ViewStyle;
  diagnosticLine: TextStyle;
  testBlock: ViewStyle;
  button: ViewStyle;
  buttonLabel: TextStyle;
  dimmed: ViewStyle;
  result: TextStyle;
  resultOk: TextStyle;
  resultError: TextStyle;
  pendingLine: TextStyle;
  link: ViewStyle;
  linkLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    section: { gap: spacing.xs },
    diagnostics: { gap: 2, paddingVertical: spacing.xs },
    diagnosticLine: { fontSize: 12, lineHeight: 17, color: palette.inkSecondary },
    testBlock: { gap: 2 },
    button: { minHeight: minTouchSize, justifyContent: 'center' },
    buttonLabel: { fontSize: 15, fontWeight: '600', color: palette.signalBlue },
    dimmed: { opacity: 0.5 },
    result: { fontSize: 12, lineHeight: 17, color: palette.inkSecondary },
    resultOk: { color: palette.ink },
    resultError: { color: palette.danger },
    pendingLine: { fontSize: 11, color: palette.inkSecondary },
    link: { minHeight: minTouchSize, justifyContent: 'center' },
    linkLabel: { fontSize: 13, fontWeight: '700', color: palette.signalBlue },
  });
}
