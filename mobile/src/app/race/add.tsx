import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterChip } from '@/components/FilterChip';
import type { Race, SportCategory } from '@/fixtures/races';
import { useAthleteRaces, type ManualRaceInput } from '@/lib/racesContext';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

const SPORTS: SportCategory[] = ['triathlon', 'running', 'cycling', 'swimming', 'duathlon', 'other'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function secondsToHms(totalSeconds: number | undefined): { h: string; m: string; s: string } {
  if (totalSeconds === undefined) return { h: '', m: '', s: '' };
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h: h > 0 ? String(h) : '', m: String(m), s: String(s) };
}

/** Parses a full 'YYYY-MM-DD' as a local calendar date (never UTC — a UTC parse of a bare date
 *  string can land on the previous day for anyone west of Greenwich). A year-only or missing
 *  value (an existing race edited from a source that only recorded a year, or a brand-new race)
 *  defaults to today, since the native picker always needs a concrete starting date. */
function parseIsoDateOrToday(iso: string | undefined): Date {
  if (iso && ISO_DATE_PATTERN.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y!, m! - 1, d!);
  }
  return new Date();
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Manual Add/Edit Race fallback (B.1) — covers both an upcoming race (no result fields, drives
 * Home's countdown) and a historical one the discovery adapter didn't find (e.g. providers other
 * than Sportstats). No screenshot/PDF/AI-extraction ingestion here — plain form fields only.
 *
 * Doubles as the edit screen for an existing manual race (P1-9) via `?raceId=` — an imported race
 * is never editable (see Race.isManual), only removable, so this screen only ever gets a raceId
 * for a manual one; entry points that link here are responsible for that check.
 */
export default function AddRaceScreen() {
  const router = useRouter();
  const { data: races, addManualRace, updateManualRace } = useAthleteRaces();
  const { mode: initialMode, raceId } = useLocalSearchParams<{ mode?: string; raceId?: string }>();
  const editingRace = raceId ? races.find((r) => r.id === raceId) : undefined;

  const [mode, setMode] = useState<'upcoming' | 'completed'>(
    editingRace ? (editingRace.status === 'completed' ? 'completed' : 'upcoming') : initialMode === 'completed' ? 'completed' : 'upcoming',
  );
  const [eventName, setEventName] = useState(editingRace?.name ?? '');
  const [location, setLocation] = useState(editingRace?.location ?? '');
  const [sport, setSport] = useState<SportCategory>(editingRace?.sport ?? 'triathlon');
  const [category, setCategory] = useState(editingRace?.distanceLabel ?? '');
  const [eventDate, setEventDate] = useState(() => parseIsoDateOrToday(editingRace?.eventDate));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const initialHms = secondsToHms(editingRace?.result?.finishSeconds);
  const [finishHours, setFinishHours] = useState(initialHms.h);
  const [finishMinutes, setFinishMinutes] = useState(initialHms.m);
  const [finishSecondsField, setFinishSecondsField] = useState(initialHms.s);
  const [bib, setBib] = useState(editingRace?.result?.bib ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const canSave = eventName.trim().length > 0 && !isSaving;

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'dismissed') return;
    if (selectedDate) setEventDate(selectedDate);
  }

  async function handleSave() {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const input: ManualRaceInput = {
        eventName: eventName.trim(),
        location: location.trim() || undefined,
        sport,
        category: category.trim() || undefined,
        raceStatus: mode === 'upcoming' ? 'registered' : ('completed' as Race['status']),
        eventDate: dateToIso(eventDate),
        finishSeconds: mode === 'completed' ? hmsToSeconds(finishHours, finishMinutes, finishSecondsField) : undefined,
        bib: mode === 'completed' ? bib.trim() || undefined : undefined,
      };
      if (editingRace) {
        await updateManualRace(editingRace.id, input);
        router.back();
      } else {
        const newRace = await addManualRace(input);
        // Straight into the new race's own detail/prep screen — not back to a generic success
        // screen — and `replace` so the now-submitted form isn't left in the back stack behind it.
        // Object form (not a template-string path) is Expo Router's documented way to navigate to
        // a dynamic route reliably.
        if (mode === 'completed') {
          router.replace({ pathname: '/results/[id]', params: { id: newRace.id } });
        } else {
          router.replace({ pathname: '/race/[id]', params: { id: newRace.id } });
        }
      }
    } catch (err) {
      console.warn('[AddRace] save failed:', err);
      Alert.alert('Couldn’t save that race', 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: editingRace ? 'Edit race' : 'Add a race' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.modeRow}>
          <FilterChip label="Upcoming" selected={mode === 'upcoming'} onPress={() => setMode('upcoming')} />
          <FilterChip label="Already completed" selected={mode === 'completed'} onPress={() => setMode('completed')} />
        </View>

        <Field label="Event name" value={eventName} onChangeText={setEventName} />

        <View>
          <Text style={typography.label}>DATE</Text>
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setShowDatePicker((shown) => !shown);
            }}
            accessibilityRole="button"
            accessibilityLabel="Choose date"
            style={styles.dateButton}>
            <Text style={styles.dateButtonLabel}>{formatDisplayDate(eventDate)}</Text>
          </Pressable>
          {showDatePicker ? (
            <DateTimePicker
              value={eventDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleDateChange}
              themeVariant="dark"
            />
          ) : null}
        </View>

        <Field label="Location (optional)" value={location} onChangeText={setLocation} />
        <Field label="Distance / category (optional)" value={category} onChangeText={setCategory} />

        <View>
          <Text style={typography.label}>SPORT</Text>
          <View style={styles.sportRow}>
            {SPORTS.map((option) => (
              <FilterChip key={option} label={capitalize(option)} selected={sport === option} onPress={() => setSport(option)} />
            ))}
          </View>
        </View>

        {mode === 'completed' ? (
          <>
            <View>
              <Text style={typography.label}>FINISH TIME (OPTIONAL)</Text>
              <View style={styles.hmsRow}>
                <HmsField label="Hours" value={finishHours} onChangeText={setFinishHours} />
                <HmsField label="Minutes" value={finishMinutes} onChangeText={setFinishMinutes} max={59} />
                <HmsField label="Seconds" value={finishSecondsField} onChangeText={setFinishSecondsField} max={59} />
              </View>
            </View>
            <Field label="Bib (optional)" value={bib} onChangeText={setBib} />
          </>
        ) : null}

        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save race"
          style={[styles.primaryButton, !canSave && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonLabel}>{isSaving ? 'Saving…' : editingRace ? 'Save changes' : 'Save race'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/** Explicit H/M/S fields -> total seconds — replaces free-text "H:MM:SS" parsing (ambiguous:
 *  "1:30" could mean 1h30m or 1m30s). An all-blank set of fields means "no finish time," not
 *  zero; a partially-filled set (e.g. minutes only) treats the blank fields as 0. */
function hmsToSeconds(hours: string, minutes: string, seconds: string): number | undefined {
  if (!hours.trim() && !minutes.trim() && !seconds.trim()) return undefined;
  const h = Number(hours.trim() || '0');
  const m = Number(minutes.trim() || '0');
  const s = Number(seconds.trim() || '0');
  if ([h, m, s].some((n) => Number.isNaN(n) || n < 0)) return undefined;
  return h * 3600 + m * 60 + s;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** One numeric H/M/S box — clamps to digits only and, when `max` is given, caps the value so
 *  minutes/seconds can't be typed as e.g. "90". */
function HmsField({
  label,
  value,
  onChangeText,
  max,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  max?: number;
}) {
  function handleChange(text: string) {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (max === undefined) {
      onChangeText(digitsOnly);
      return;
    }
    const n = Number(digitsOnly || '0');
    onChangeText(digitsOnly === '' ? '' : String(Math.min(n, max)));
  }

  return (
    <View style={styles.hmsField}>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        style={styles.hmsInput}
        accessibilityLabel={label}
      />
      <Text style={styles.hmsLabel}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numbers-and-punctuation';
}) {
  return (
    <View>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sportRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 4,
  },
  input: {
    minHeight: minTouchSize,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    marginTop: 4,
  },
  dateButton: {
    minHeight: minTouchSize,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    marginTop: 4,
  },
  dateButtonLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  hmsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  hmsField: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  hmsInput: {
    minHeight: minTouchSize,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  hmsLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  primaryButton: {
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonLabel: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 16,
  },
});
