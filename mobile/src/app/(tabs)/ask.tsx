import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { athlete } from '@/fixtures/athlete';
import { askCredits, askSuggestionsEmpty, askSuggestionsPopulated, athletePreferences } from '@/fixtures/ask';
import { gearItemsPopulated } from '@/fixtures/gear';
import { racesPopulated } from '@/fixtures/races';
import { getCompletedRaces, getNextRace } from '@/lib/races';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';
import { useFixtureData } from '@/lib/useSimulatedLoad';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const MOCK_REPLY =
  "Once I'm connected to real AI, I'll answer this using your race history, training, and gear — this is a preview of the experience.";

export default function AskScreen() {
  const suggestions = useFixtureData(askSuggestionsPopulated, askSuggestionsEmpty);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [attachHint, setAttachHint] = useState(false);

  const nextRace = getNextRace(racesPopulated);
  const raceCount = getCompletedRaces(racesPopulated).length;

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    setMessages((current) => [...current, { id: `${Date.now()}-user`, role: 'user', text: trimmed }]);
    setInputText('');
    setIsAssistantTyping(true);
    setTimeout(() => {
      setIsAssistantTyping(false);
      setMessages((current) => [...current, { id: `${Date.now()}-assistant`, role: 'assistant', text: MOCK_REPLY }]);
    }, 600);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
          {messages.length === 0 ? (
            <View style={styles.greeting}>
              <Text style={typography.display} numberOfLines={2}>
                Hey {athlete.displayName}, what are we working on?
              </Text>
              <Text style={styles.subcopy}>I can use your race history, training and gear to help.</Text>
              <Text style={styles.credits}>
                {askCredits.total - askCredits.used}/{askCredits.total} credits this month
              </Text>
            </View>
          ) : (
            <View style={styles.messages}>
              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
                  <Text style={message.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                    {message.text}
                  </Text>
                </View>
              ))}
              {isAssistantTyping ? (
                <View style={[styles.bubble, styles.bubbleAssistant]}>
                  <Text style={styles.bubbleTextAssistant}>…</Text>
                </View>
              ) : null}
            </View>
          )}

          {messages.length === 0 ? (
            suggestions.isLoading ? (
              <LoadingSkeleton rows={2} />
            ) : suggestions.isError ? (
              <ErrorState />
            ) : (
              <View style={styles.suggestionRow}>
                {suggestions.data.map((suggestion) => (
                  <Pressable
                    key={suggestion.id}
                    onPress={() => sendMessage(suggestion.text)}
                    accessibilityRole="button"
                    accessibilityLabel={suggestion.text}
                    style={styles.suggestionChip}>
                    <Text style={styles.suggestionLabel}>{suggestion.text}</Text>
                  </Pressable>
                ))}
              </View>
            )
          ) : null}

          <Pressable
            onPress={() => setContextExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel="Your athlete context: race history, training, gear"
            accessibilityState={{ expanded: contextExpanded }}
            style={styles.contextToggle}>
            <Text style={styles.contextToggleLabel}>Your athlete context</Text>
            <Text style={styles.contextToggleMeta}>
              Race history · Training · Gear {contextExpanded ? '▾' : '▸'}
            </Text>
          </Pressable>

          {contextExpanded ? (
            <Card style={styles.contextCard}>
              <ContextRow label="Upcoming race" value={nextRace ? nextRace.name : 'None queued up'} />
              <ContextRow label="Race history" value={`${raceCount} races recovered`} />
              {gearItemsPopulated.map((item) => (
                <ContextRow key={item.id} label={item.name} value={item.detail} />
              ))}
              {athletePreferences.map((preference) => (
                <Text key={preference} style={styles.preferenceText}>
                  {preference}
                </Text>
              ))}
            </Card>
          ) : null}

          {attachHint ? (
            <Text style={styles.attachHint}>Photo attachments are coming in a later milestone.</Text>
          ) : null}
        </ScrollView>

        <View style={styles.inputBar}>
          <Pressable
            onPress={() => setAttachHint(true)}
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
            style={styles.attachButton}>
            <Text style={styles.attachIcon}>📷</Text>
          </Pressable>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask anything about your races, training or gear…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Message"
            multiline
          />
          <Pressable
            onPress={() => sendMessage(inputText)}
            disabled={inputText.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.sendButton, inputText.trim().length === 0 && styles.sendButtonDisabled]}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.contextRow}>
      <Text style={styles.contextLabel}>{label}</Text>
      <Text style={styles.contextValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  greeting: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  subcopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  credits: {
    ...typography.caption,
    color: colors.textMuted,
  },
  messages: {
    gap: spacing.sm,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentMuted,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceElevated,
  },
  bubbleTextUser: {
    ...typography.body,
    color: colors.accent,
  },
  bubbleTextAssistant: {
    ...typography.body,
  },
  suggestionRow: {
    gap: spacing.xs,
  },
  suggestionChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionLabel: {
    ...typography.caption,
    fontWeight: '600',
  },
  contextToggle: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  contextToggleLabel: {
    ...typography.body,
    fontWeight: '700',
  },
  contextToggleMeta: {
    ...typography.caption,
  },
  contextCard: {
    gap: spacing.sm,
  },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  contextLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  contextValue: {
    ...typography.caption,
    fontWeight: '600',
  },
  preferenceText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  attachHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  attachButton: {
    minWidth: minTouchSize,
    minHeight: minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachIcon: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    minHeight: minTouchSize,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  sendButton: {
    width: minTouchSize,
    height: minTouchSize,
    borderRadius: minTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.background,
  },
});
