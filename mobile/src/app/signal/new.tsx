import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/Card';
import { nextRacePopulated } from '@/fixtures/race';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

const SPORT_CHIPS = ['Swim', 'Bike', 'Run', 'Brick', 'Strength', 'Recovery'] as const;
const CIRCLE_NAME = 'Toronto Tri Circle';

export default function SendSignalScreen() {
  const router = useRouter();
  const [sport, setSport] = useState<(typeof SPORT_CHIPS)[number]>('Bike');
  const [when, setWhen] = useState('Saturday, 8:00 AM');
  const [distance, setDistance] = useState('90 km');
  const [intensity, setIntensity] = useState('Zone 2');
  const [pace, setPace] = useState('28-30 km/h');
  const [meetingPoint, setMeetingPoint] = useState('Ontario Place');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View style={styles.screen}>
        <View style={styles.successContainer}>
          <Text style={styles.successTitle}>Signal sent</Text>
          <Text style={styles.successSubtitle}>
            {CIRCLE_NAME} will see your {sport.toLowerCase()} session. (Demo only — nothing was
            actually sent.)
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={styles.doneButton}>
            <Text style={styles.doneButtonLabel}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.body}>Tell {CIRCLE_NAME} now, before the training opportunity passes.</Text>

        <View style={styles.chipRow}>
          {SPORT_CHIPS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setSport(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: sport === option }}
              accessibilityLabel={option}
              style={[styles.chip, sport === option && styles.chipActive]}>
              <Text style={[styles.chipLabel, sport === option && styles.chipLabelActive]}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field label="When" value={when} onChangeText={setWhen} />
        <Field label="Distance or duration" value={distance} onChangeText={setDistance} />
        <Field label="Intensity" value={intensity} onChangeText={setIntensity} />
        <Field label="Pace or speed" value={pace} onChangeText={setPace} />
        <Field label="Meeting point" value={meetingPoint} onChangeText={setMeetingPoint} />

        <View>
          <Text style={typography.label}>TARGET RACE</Text>
          <Text style={styles.readOnlyValue}>{nextRacePopulated.name}</Text>
        </View>

        <Card style={styles.previewCard}>
          <Text style={typography.label}>AUDIENCE PREVIEW</Text>
          <Text style={styles.previewText}>
            {CIRCLE_NAME} will see: &ldquo;{sport} · {when} · {distance}&rdquo;
          </Text>
        </Card>

        <Pressable
          onPress={() => setSent(true)}
          accessibilityRole="button"
          accessibilityLabel="Send Signal"
          style={styles.sendButton}>
          <Text style={styles.sendButtonLabel}>Send</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View>
      <Text style={typography.label}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
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
    gap: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  chipLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  chipLabelActive: {
    color: colors.accent,
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
  readOnlyValue: {
    ...typography.body,
    marginTop: 4,
  },
  previewCard: {
    gap: spacing.xs,
  },
  previewText: {
    ...typography.body,
  },
  sendButton: {
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginTop: spacing.md,
  },
  sendButtonLabel: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 16,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  successTitle: {
    ...typography.title,
  },
  successSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  doneButton: {
    minHeight: minTouchSize,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.md,
  },
  doneButtonLabel: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '700',
  },
});
