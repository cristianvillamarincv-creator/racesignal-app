import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { SettingsGroup, TEXT_DIVIDER_INSET } from '@/components/settings/SettingsRows';
import { useColorScheme } from '@/lib/appearance';
import { AppIcon } from '@/lib/icons';
import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { formatLocalMoment, formatTimeOfDay, formatWeeklySlot, SIGNAL_ASK_NOTE } from '@/lib/notifications/format';
import { useNotifications, type NotificationType, type ScheduleStatusEntry } from '@/lib/notifications/NotificationsProvider';
import { weekdayName, type Weekday } from '@/lib/notifications/prefs';
import { minTouchSize, spacing } from '@/lib/theme';

type Editor = 'racePrepWeekly' | 'racePrepMilestone' | 'betweenWeekly' | null;
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const NOTIFICATION_COPY = {
  racePrep: {
    title: 'Race-prep reminders',
    detail: 'A weekly check-in about something still unchecked on your Race Prep list, plus a note one week and two days before each race.',
  },
  betweenRace: {
    title: 'Between-race prompts',
    detail: `A weekly question to help you think about what comes next, while you have no upcoming race. Tapping it opens a Signal draft you can edit. ${SIGNAL_ASK_NOTE}`,
  },
  permissionOff: 'Notifications are turned off for RaceSignal in iOS Settings, so these reminders cannot be delivered.',
} as const;

function DayChips({ value, onPick, styles, palette }: { value: Weekday; onPick: (day: Weekday) => void; styles: Styles; palette: BrandPalette }) {
  return (
    <View style={styles.dayRow}>
      {DAY_LETTERS.map((letter, index) => {
        const selected = value === index;
        return (
          <Pressable
            key={index}
            onPress={() => onPick(index as Weekday)}
            accessibilityRole="button"
            accessibilityLabel={weekdayName(index as Weekday)}
            accessibilityState={{ selected }}
            style={[styles.dayChip, selected && { backgroundColor: palette.signalBlue, borderColor: palette.signalBlue }]}>
            <Text style={[styles.dayLetter, selected && { color: palette.onSignalBlue }]}>{letter}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What is actually scheduled with iOS for this type, read back after the last reconcile (or why nothing is). */
function StatusLine({ entry, styles }: { entry: ScheduleStatusEntry | null | undefined; styles: Styles }) {
  if (!entry) return <Text style={styles.status}>Checking…</Text>;
  if (entry.scheduled === 0) return <Text style={styles.status}>{entry.note ?? 'Nothing scheduled.'}</Text>;
  const count = `${entry.scheduled} reminder${entry.scheduled === 1 ? '' : 's'} scheduled`;
  return <Text style={styles.status}>{entry.next ? `${count}. Next: ${formatLocalMoment(entry.next)}.` : `${count}.`}</Text>;
}

function ScheduleRow({ label, value, open, onPress, styles, palette, children }: { label: string; value: string; open: boolean; onPress: () => void; styles: Styles; palette: BrandPalette; children: ReactNode }) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.scheduleRow, pressed && styles.rowPressed]}>
        <Text style={styles.scheduleLabel}>{label}</Text>
        <Text style={styles.scheduleValue}>{value}</Text>
        <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={withAlpha(palette.inkSecondary, 0.7)} />
      </Pressable>
      {open ? <View style={styles.editor}>{children}</View> : null}
    </View>
  );
}

/**
 * Settings → Notifications: a separate switch for each type (both start off, and iOS permission is requested only when one is switched on),
 * editable weekly day and time (and the race-milestone time), and a clear message with a shortcut when iOS permission is denied or was turned off later.
 */
export function NotificationSettingsSection() {
  const { prefs, permission, scheduleStatus, enable, disable, updateSchedule, openSystemSettings } = useNotifications();
  const palette = useBrandPalette();
  const scheme = useColorScheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [editor, setEditor] = useState<Editor>(null);
  const [denied, setDenied] = useState<NotificationType | null>(null);

  const permissionOff = permission === 'denied';
  const anyEnabled = prefs.racePrep.enabled || prefs.betweenRace.enabled;

  async function onToggle(type: NotificationType, value: boolean) {
    setDenied(null);
    if (!value) {
      await disable(type);
      if (editor && (type === 'racePrep' ? editor !== 'betweenWeekly' : editor === 'betweenWeekly')) setEditor(null);
      return;
    }
    const result = await enable(type);
    if (result === 'denied') setDenied(type);
  }

  function onTime(kind: Exclude<Editor, null>, event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setEditor(null);
    if (event.type === 'dismissed' || !date) return;
    const hour = date.getHours();
    const minute = date.getMinutes();
    if (kind === 'racePrepWeekly') void updateSchedule({ racePrep: { weeklyHour: hour, weeklyMinute: minute } });
    else if (kind === 'racePrepMilestone') void updateSchedule({ racePrep: { milestoneHour: hour, milestoneMinute: minute } });
    else void updateSchedule({ betweenRace: { hour, minute } });
  }

  const pickerValue = (hour: number, minute: number) => new Date(2026, 0, 1, hour, minute);

  const picker = (kind: Exclude<Editor, null>, hour: number, minute: number) => (
    <DateTimePicker
      value={pickerValue(hour, minute)}
      mode="time"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={(event, date) => onTime(kind, event, date)}
      themeVariant={scheme === 'dark' ? 'dark' : 'light'}
    />
  );

  return (
    <View style={styles.section} testID="notification-settings">
      <SettingsGroup inset={TEXT_DIVIDER_INSET}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.title}>{NOTIFICATION_COPY.racePrep.title}</Text>
            <Text style={styles.detail}>{NOTIFICATION_COPY.racePrep.detail}</Text>
          </View>
          <Switch
            value={prefs.racePrep.enabled}
            onValueChange={(value) => void onToggle('racePrep', value)}
            accessibilityLabel={NOTIFICATION_COPY.racePrep.title}
            trackColor={{ true: palette.signalBlue, false: withAlpha(palette.inkSecondary, 0.3) }}
          />
        </View>
        {prefs.racePrep.enabled ? <StatusLine entry={scheduleStatus?.racePrep} styles={styles} /> : null}
        {prefs.racePrep.enabled ? (
          <ScheduleRow
            styles={styles}
            palette={palette}
            label="Weekly reminder"
            value={formatWeeklySlot(prefs.racePrep.weeklyDay, prefs.racePrep.weeklyHour, prefs.racePrep.weeklyMinute)}
            open={editor === 'racePrepWeekly'}
            onPress={() => setEditor(editor === 'racePrepWeekly' ? null : 'racePrepWeekly')}>
            <DayChips styles={styles} palette={palette} value={prefs.racePrep.weeklyDay} onPick={(day) => void updateSchedule({ racePrep: { weeklyDay: day } })} />
            {picker('racePrepWeekly', prefs.racePrep.weeklyHour, prefs.racePrep.weeklyMinute)}
          </ScheduleRow>
        ) : null}
        {prefs.racePrep.enabled ? (
          <ScheduleRow
            styles={styles}
            palette={palette}
            label="One week and two days before a race"
            value={formatTimeOfDay(prefs.racePrep.milestoneHour, prefs.racePrep.milestoneMinute)}
            open={editor === 'racePrepMilestone'}
            onPress={() => setEditor(editor === 'racePrepMilestone' ? null : 'racePrepMilestone')}>
            {picker('racePrepMilestone', prefs.racePrep.milestoneHour, prefs.racePrep.milestoneMinute)}
          </ScheduleRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup inset={TEXT_DIVIDER_INSET}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.title}>{NOTIFICATION_COPY.betweenRace.title}</Text>
            <Text style={styles.detail}>{NOTIFICATION_COPY.betweenRace.detail}</Text>
          </View>
          <Switch
            value={prefs.betweenRace.enabled}
            onValueChange={(value) => void onToggle('betweenRace', value)}
            accessibilityLabel={NOTIFICATION_COPY.betweenRace.title}
            trackColor={{ true: palette.signalBlue, false: withAlpha(palette.inkSecondary, 0.3) }}
          />
        </View>
        {prefs.betweenRace.enabled ? <StatusLine entry={scheduleStatus?.betweenRace} styles={styles} /> : null}
        {prefs.betweenRace.enabled ? (
          <ScheduleRow
            styles={styles}
            palette={palette}
            label="Weekly prompt"
            value={formatWeeklySlot(prefs.betweenRace.day, prefs.betweenRace.hour, prefs.betweenRace.minute)}
            open={editor === 'betweenWeekly'}
            onPress={() => setEditor(editor === 'betweenWeekly' ? null : 'betweenWeekly')}>
            <DayChips styles={styles} palette={palette} value={prefs.betweenRace.day} onPick={(day) => void updateSchedule({ betweenRace: { day } })} />
            {picker('betweenWeekly', prefs.betweenRace.hour, prefs.betweenRace.minute)}
          </ScheduleRow>
        ) : null}
      </SettingsGroup>

      {scheduleStatus?.error ? (
        <View style={styles.warning} accessibilityRole="alert">
          <Text style={styles.warningText}>{scheduleStatus.error}</Text>
        </View>
      ) : null}

      {(permissionOff && anyEnabled) || denied ? (
        <View style={styles.warning} accessibilityRole="alert">
          <Text style={styles.warningText}>{denied ? `${NOTIFICATION_COPY.permissionOff} Turn them on in iOS Settings, then switch this back on here.` : NOTIFICATION_COPY.permissionOff}</Text>
          <Pressable onPress={() => void openSystemSettings()} accessibilityRole="button" accessibilityLabel="Open iOS Settings" style={styles.warningButton}>
            <Text style={styles.warningButtonLabel}>Open iOS Settings</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

interface Styles {
  rowPressed: ViewStyle;
  section: ViewStyle;
  switchRow: ViewStyle;
  switchText: ViewStyle;
  title: TextStyle;
  detail: TextStyle;
  scheduleRow: ViewStyle;
  scheduleLabel: TextStyle;
  scheduleValue: TextStyle;
  editor: ViewStyle;
  dayRow: ViewStyle;
  dayChip: ViewStyle;
  dayLetter: TextStyle;
  status: TextStyle;
  warning: ViewStyle;
  warningText: TextStyle;
  warningButton: ViewStyle;
  warningButtonLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    section: { gap: spacing.lg },
    rowPressed: { backgroundColor: withAlpha(palette.ink, 0.07) },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56 },
    switchText: { flex: 1, gap: 2 },
    title: { fontSize: 17, fontWeight: '500', color: palette.ink },
    detail: { fontSize: 13, lineHeight: 18, color: palette.inkSecondary },
    // The label wraps and the value may wrap too (large text), so neither is ever clipped.
    scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
    scheduleLabel: { flex: 1, flexShrink: 1, fontSize: 16, color: palette.ink },
    scheduleValue: { flexShrink: 1, maxWidth: '50%', fontSize: 15, textAlign: 'right', color: palette.inkSecondary },
    editor: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    dayRow: { flexDirection: 'row', justifyContent: 'space-between' },
    dayChip: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: palette.hairline, alignItems: 'center', justifyContent: 'center' },
    dayLetter: { fontSize: 14, fontWeight: '600', color: palette.ink },
    status: { fontSize: 13, lineHeight: 18, color: palette.inkSecondary, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
    warning: { gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 12, backgroundColor: withAlpha(palette.danger, 0.1) },
    warningText: { fontSize: 13, lineHeight: 18, color: palette.ink },
    warningButton: { minHeight: minTouchSize, justifyContent: 'center' },
    warningButtonLabel: { fontSize: 14, fontWeight: '700', color: palette.signalBlue },
  });
}
