import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import type { SignalCard as SignalCardData } from '@/fixtures/signals';
import { colors, spacing, typography } from '@/lib/theme';

interface SignalCardProps {
  card: SignalCardData;
}

type ResponseChoice = 'interested' | 'going' | 'cannot_join';

const RESPONSE_LABEL: Record<ResponseChoice, string> = {
  interested: 'Interested',
  going: 'Going',
  cannot_join: "Can't join",
};

export function SignalCard({ card }: SignalCardProps) {
  return (
    <Card style={styles.card}>
      <SignalCardBody card={card} />
    </Card>
  );
}

function SignalCardBody({ card }: { card: SignalCardData }) {
  switch (card.kind) {
    case 'response':
      return (
        <View>
          <Badge label="RESPONSE · NOW" tone="accent" />
          <Text style={styles.title}>
            {card.responderName} is interested in your {card.sportLabel.toLowerCase()} session
          </Text>
          <Text style={styles.meta}>
            {card.title} · {card.timeLabel} · {card.intensityLabel}
          </Text>
          <View style={styles.actionsRow}>
            <PrimaryAction label={`Message ${card.responderName}`} onPress={() => {}} />
            <SecondaryAction label="View Signal" onPress={() => {}} />
          </View>
        </View>
      );
    case 'raceDay':
      return (
        <View>
          <Badge label="RACE DAY" tone="warning" />
          <Text style={styles.title}>
            {card.friendName} is racing today — {card.raceName}
          </Text>
          <Text style={styles.meta}>{card.timeLabel}</Text>
          {card.hasTracker ? (
            <View style={styles.actionsRow}>
              <PrimaryAction label="Follow official tracker" onPress={() => {}} />
            </View>
          ) : null}
        </View>
      );
    case 'session':
      return <SessionCardBody card={card} />;
    case 'result':
      return (
        <View>
          <Badge label="RECENT RESULT" tone="neutral" />
          <Text style={styles.title}>
            {card.friendName} finished {card.raceName} — {card.finishTimeLabel}
          </Text>
          <Text style={styles.meta}>{card.timeLabel}</Text>
          <View style={styles.actionsRow}>
            <PrimaryAction label="Congratulate" onPress={() => {}} />
          </View>
        </View>
      );
  }
}

function SessionCardBody({ card }: { card: Extract<SignalCardData, { kind: 'session' }> }) {
  const [response, setResponse] = useState<ResponseChoice | null>(null);

  return (
    <View>
      <Badge label={card.groupLabel.toUpperCase()} tone="neutral" />
      <Text style={styles.title}>{card.title}</Text>
      <Text style={styles.meta}>
        {card.creatorName} · {card.sportLabel} · {card.timeLabel}
      </Text>
      <View style={styles.actionsRow}>
        {(['interested', 'going', 'cannot_join'] as ResponseChoice[]).map((choice) => {
          const selected = response === choice;
          return (
            <Pressable
              key={choice}
              onPress={() => setResponse(choice)}
              accessibilityRole="button"
              accessibilityLabel={RESPONSE_LABEL[choice]}
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
                {RESPONSE_LABEL[choice]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PrimaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
      <Text style={styles.primaryActionLabel}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
      <Text style={styles.secondaryActionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
  },
  title: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  meta: {
    ...typography.caption,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  primaryActionLabel: {
    color: colors.background,
    fontWeight: '700',
  },
  secondaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
  },
  secondaryActionLabel: {
    ...typography.body,
    fontWeight: '600',
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceSelected: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  choiceLabel: {
    ...typography.caption,
    fontWeight: '700',
  },
  choiceLabelSelected: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.8,
  },
});
