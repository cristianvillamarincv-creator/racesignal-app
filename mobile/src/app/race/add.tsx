import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderBackButton } from '@/components/HeaderBackButton';
import type { Race, SportCategory } from '@/fixtures/races';
import { type BrandPalette, useBrandPalette, withAlpha } from '@/lib/brandTheme';
import { canSaveManualRace, categoryPlaceholderFor, hmsToSeconds, initialSportForManualRace } from '@/lib/manualRaceForm';
import { useAthleteRaces, type ManualRaceInput } from '@/lib/racesContext';
import { minTouchSize, spacing } from '@/lib/theme';

const SPORTS: SportCategory[] = ['triathlon', 'running', 'cycling', 'swimming', 'duathlon', 'other'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Matches HeaderBackButton's own circular size — used to compute how much top padding the screen's
// own content needs to clear the floating back control (same pattern as results/[id].tsx).
const BACK_BUTTON_SIZE = 44;

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
 *
 * Visual treatment brought in line with the "Race Morning Precision" brand system (see
 * results/[id].tsx, the approved north star): floating circular back control over a hidden native
 * header, a confident headline in place of a generic form-screen title, quiet underline-style
 * fields instead of heavy outlined boxes, a compact segmented control and compact sport chips built
 * locally for this screen, and the app's single signalBlue interactive color on the primary CTA.
 * State, validation, submission and navigation are unchanged from the previous version.
 */
export default function AddRaceScreen() {
  const router = useRouter();
  const { data: races, addManualRace, updateManualRace } = useAthleteRaces();
  const { mode: initialMode, raceId } = useLocalSearchParams<{ mode?: string; raceId?: string }>();
  const editingRace = raceId ? races.find((r) => r.id === raceId) : undefined;
  const palette = useBrandPalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();

  const [mode, setMode] = useState<'upcoming' | 'completed'>(
    editingRace ? (editingRace.status === 'completed' ? 'completed' : 'upcoming') : initialMode === 'completed' ? 'completed' : 'upcoming',
  );
  const [eventName, setEventName] = useState(editingRace?.name ?? '');
  const [location, setLocation] = useState(editingRace?.location ?? '');
  // A brand-new manual race starts with NO sport selected — defaulting to Triathlon (the previous
  // behavior) let an athlete type a category like "10K" without ever touching the sport selector,
  // producing a contradictory race (Triathlon + 10K). Editing an existing race still preserves
  // whatever sport it already has; only a genuinely new entry starts unselected. See
  // __tests__/raceAddValidation.test.ts.
  const [sport, setSport] = useState<SportCategory | null>(initialSportForManualRace(editingRace));
  const [category, setCategory] = useState(editingRace?.distanceLabel ?? '');
  const [eventDate, setEventDate] = useState(() => parseIsoDateOrToday(editingRace?.eventDate));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const initialHms = secondsToHms(editingRace?.result?.finishSeconds);
  const [finishHours, setFinishHours] = useState(initialHms.h);
  const [finishMinutes, setFinishMinutes] = useState(initialHms.m);
  const [finishSecondsField, setFinishSecondsField] = useState(initialHms.s);
  const [bib, setBib] = useState(editingRace?.result?.bib ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const canSave = canSaveManualRace({ eventName, sport, isSaving });
  const topOffset = insets.top + BACK_BUTTON_SIZE + 14;

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'dismissed') return;
    if (selectedDate) setEventDate(selectedDate);
  }

  async function handleSave() {
    if (!canSave || sport === null) return;
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
      <StatusBar style={palette.statusBarStyle} />
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.floatingBack, { top: insets.top + 4 }]}>
        <HeaderBackButton color={palette.signalBlue} circular circleBackground={palette.canvasElevated} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topOffset }]}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {/* Headline — the same confident identity treatment as the result detail north star,
            not a generic form-screen title. */}
        <View style={styles.headlineWrap}>
          <Text style={styles.kicker}>MANUAL ENTRY</Text>
          <Text style={styles.title}>
            {editingRace ? 'Edit race' : mode === 'upcoming' ? 'Your next start line.' : 'Add to your race history.'}
          </Text>
          <Text style={styles.subcopy}>
            {editingRace ? 'Update the details for this race.' : 'Log a race Signal couldn’t find automatically.'}
          </Text>
        </View>

        {/* Group 1 — race identity: status toggle + the race name, given clear visual priority
            over every other field below (larger, bolder text) since it's the one thing every
            other field is describing. */}
        <View style={styles.group}>
          <ModeSegmentedControl mode={mode} onChange={setMode} palette={palette} styles={styles} />

          <Field label="Event name" value={eventName} onChangeText={setEventName} palette={palette} styles={styles} primary />
        </View>

        {/* Group 2 — cluster: when + where */}
        <View style={styles.group}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Date</Text>
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setShowDatePicker((shown) => !shown);
              }}
              accessibilityRole="button"
              accessibilityLabel="Choose date"
              style={styles.underlineControl}>
              <Text style={styles.underlineControlValue}>{formatDisplayDate(eventDate)}</Text>
            </Pressable>
            {showDatePicker ? (
              <DateTimePicker
                value={eventDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={handleDateChange}
                themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
              />
            ) : null}
          </View>
          <Field label="Location (optional)" value={location} onChangeText={setLocation} palette={palette} styles={styles} />
        </View>

        {/* Group 3 — cluster: what kind of race. Sport comes first — classification has to be
            established before category, so an athlete can't type a free-text distance like "10K"
            without ever having chosen a sport, producing a contradictory race. */}
        <View style={styles.group}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Sport</Text>
            <View style={styles.sportRow}>
              {SPORTS.map((option) => (
                <SportChip key={option} label={capitalize(option)} selected={sport === option} onPress={() => setSport(option)} palette={palette} />
              ))}
            </View>
            {sport === null ? <Text style={styles.sportRequiredHint}>Choose a sport</Text> : null}
          </View>
          <Field
            label="Distance / category (optional)"
            value={category}
            onChangeText={setCategory}
            placeholder={categoryPlaceholderFor(sport)}
            palette={palette}
            styles={styles}
          />
        </View>

        {/* Group 4 — result, only for a completed race. The finish time gets its own clearly
            labeled section (hairline break above, section label) rather than blending in as just
            another field cluster, since it's the one result-specific input this form collects. */}
        {mode === 'completed' ? (
          <View style={styles.group}>
            <View style={styles.finishTimeSection}>
              <Text style={styles.sectionLabel}>Finish time</Text>
              <View style={styles.hmsRow}>
                <HmsField label="Hours" value={finishHours} onChangeText={setFinishHours} palette={palette} styles={styles} />
                <HmsField label="Minutes" value={finishMinutes} onChangeText={setFinishMinutes} max={59} palette={palette} styles={styles} />
                <HmsField label="Seconds" value={finishSecondsField} onChangeText={setFinishSecondsField} max={59} palette={palette} styles={styles} />
              </View>
            </View>
            <Field label="Bib (optional)" value={bib} onChangeText={setBib} palette={palette} styles={styles} />
          </View>
        ) : null}

        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save race"
          style={[styles.primaryButton, !canSave && styles.primaryButtonDisabled]}>
          <Text style={[styles.primaryButtonLabel, !canSave && styles.primaryButtonLabelDisabled]}>
            {isSaving ? 'Saving…' : editingRace ? 'Save changes' : 'Save race'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}


function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Compact two-option segmented control (Upcoming / Already completed) — a quiet hairline-bordered
 *  pill track with a filled selected segment, replacing the previous pair of full-size filter
 *  chips. Built locally: a single-select status toggle is semantically distinct from FilterChip's
 *  multi-select filter row, so it gets its own simpler treatment rather than a forced fit. */
function ModeSegmentedControl({
  mode,
  onChange,
  palette,
  styles,
}: {
  mode: 'upcoming' | 'completed';
  onChange: (mode: 'upcoming' | 'completed') => void;
  palette: BrandPalette;
  styles: Styles;
}) {
  const options: { key: 'upcoming' | 'completed'; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Already completed' },
  ];
  return (
    <View style={styles.segmentTrack}>
      {options.map((option, index) => {
        const selected = mode === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[
              styles.segment,
              // A thin tint fill on the selected segment only — not a solid high-contrast block —
              // keeps this control reading as a quiet status toggle, not a dominant capsule.
              selected && { backgroundColor: withAlpha(palette.signalBlue, 0.14) },
              index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.hairline },
            ]}>
            <Text style={[styles.segmentLabel, { color: selected ? palette.signalBlue : palette.inkSecondary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Compact sport selector built locally for this screen — a small chip row (not FilterChip's
 *  multi-select treatment) sized for a single-select choice among six options. */
function SportChip({
  label,
  selected,
  onPress,
  palette,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  palette: BrandPalette;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sport: ${label}`}
      accessibilityState={{ selected }}
      style={[
        chipStyles.chip,
        { borderColor: palette.hairline },
        selected && { backgroundColor: withAlpha(palette.signalBlue, 0.12), borderColor: palette.signalBlue },
      ]}>
      <Text style={[chipStyles.label, { color: selected ? palette.signalBlue : palette.inkSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});

/** One numeric H/M/S box — clamps to digits only and, when `max` is given, caps the value so
 *  minutes/seconds can't be typed as e.g. "90". */
function HmsField({
  label,
  value,
  onChangeText,
  max,
  palette,
  styles,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  max?: number;
  palette: BrandPalette;
  styles: Styles;
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
        placeholderTextColor={palette.inkSecondary}
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
  placeholder,
  palette,
  styles,
  primary,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numbers-and-punctuation';
  placeholder?: string;
  palette: BrandPalette;
  styles: Styles;
  /** The race name gets clear visual priority over every other field — bigger, bolder input
   *  text — since every other field on this screen is just describing it. */
  primary?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, primary && styles.primaryFieldLabel]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkSecondary}
        keyboardType={keyboardType}
        style={[styles.textInput, primary && styles.primaryTextInput]}
        accessibilityLabel={label}
      />
    </View>
  );
}

interface Styles {
  screen: ViewStyle;
  content: ViewStyle;
  floatingBack: ViewStyle;
  headlineWrap: ViewStyle;
  kicker: TextStyle;
  title: TextStyle;
  subcopy: TextStyle;
  group: ViewStyle;
  field: ViewStyle;
  fieldLabel: TextStyle;
  primaryFieldLabel: TextStyle;
  textInput: TextStyle;
  primaryTextInput: TextStyle;
  underlineControl: ViewStyle;
  underlineControlValue: TextStyle;
  segmentTrack: ViewStyle;
  segment: ViewStyle;
  segmentLabel: TextStyle;
  sportRow: ViewStyle;
  sportRequiredHint: TextStyle;
  finishTimeSection: ViewStyle;
  sectionLabel: TextStyle;
  hmsRow: ViewStyle;
  hmsField: ViewStyle;
  hmsInput: TextStyle;
  hmsLabel: TextStyle;
  primaryButton: ViewStyle;
  primaryButtonDisabled: ViewStyle;
  primaryButtonLabel: TextStyle;
  primaryButtonLabelDisabled: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.canvas,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
      // paddingTop is set inline per-render (insets.top + the floating back button's own height +
      // a small gap) — there's no native header reserving space above this content anymore.
    },
    floatingBack: {
      position: 'absolute',
      left: spacing.lg,
      zIndex: 10,
    },
    headlineWrap: {
      marginBottom: spacing.xl,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: palette.inkSecondary,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: palette.ink,
      marginTop: spacing.xs,
    },
    subcopy: {
      fontSize: 15,
      color: palette.inkSecondary,
      marginTop: spacing.xs,
    },
    // Generous whitespace between logical groups (identity / location & sport / result) rather
    // than uniform tight spacing throughout the whole form.
    group: {
      gap: spacing.lg,
      marginBottom: spacing.xl,
    },
    field: {
      gap: spacing.xs,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: palette.inkSecondary,
    },
    // The race name's label/input get real visual priority — bigger, bolder, full-ink text —
    // rather than reading as just another item in a uniform field list.
    primaryFieldLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: palette.ink,
    },
    // Underline-style field language: a quiet hairline-bottom-border instead of a heavy fully
    // outlined box, with generous label-above-field spacing (handled by `field`'s gap).
    textInput: {
      minHeight: minTouchSize,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.hairline,
      paddingVertical: spacing.sm,
      fontSize: 16,
      color: palette.ink,
    },
    primaryTextInput: {
      fontSize: 22,
      fontWeight: '700',
    },
    underlineControl: {
      minHeight: minTouchSize,
      justifyContent: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.hairline,
      paddingVertical: spacing.sm,
    },
    underlineControlValue: {
      fontSize: 16,
      color: palette.ink,
    },
    // Restrained status toggle: compact height, quiet hairline track, no solid high-contrast
    // fill — the selected segment gets only a thin signalBlue tint (see ModeSegmentedControl),
    // so this reads as a small mode switch rather than a dominant capsule at the top of the form.
    segmentTrack: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.hairline,
      borderRadius: 999,
      overflow: 'hidden',
      height: 32,
    },
    segment: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    segmentLabel: {
      fontSize: 12,
      fontWeight: '600',
    },
    sportRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    // Quiet guidance, not an alarming error — shown whenever no sport is chosen yet, since Save
    // already stays disabled until one is; this just makes the reason legible.
    sportRequiredHint: {
      fontSize: 12,
      color: palette.inkSecondary,
      marginTop: spacing.xs,
    },
    // The finish-time fields get their own clearly-labeled section — a hairline break above sets
    // it apart from the sport/distance cluster rather than blending in as just another field group.
    finishTimeSection: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.hairline,
      paddingTop: spacing.lg,
      gap: spacing.xs,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: palette.inkSecondary,
    },
    hmsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    hmsField: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
    },
    hmsInput: {
      minHeight: minTouchSize,
      width: '100%',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.hairline,
      textAlign: 'center',
      fontSize: 16,
      color: palette.ink,
    },
    hmsLabel: {
      fontSize: 12,
      color: palette.inkSecondary,
    },
    primaryButton: {
      minHeight: minTouchSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: palette.signalBlue,
      marginTop: spacing.sm,
    },
    // A clearly, unambiguously disabled look — a muted hairline-toned fill, not a washed-out
    // tint of the active color.
    primaryButtonDisabled: {
      backgroundColor: palette.hairline,
    },
    primaryButtonLabel: {
      color: palette.onSignalBlue,
      fontWeight: '700',
      fontSize: 16,
    },
    primaryButtonLabelDisabled: {
      color: palette.inkSecondary,
    },
  });
}
