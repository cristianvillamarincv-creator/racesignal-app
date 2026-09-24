import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorState } from '@/components/ErrorState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { useAuth } from '@/lib/auth';
import { appendSignalTurn, createSignalConversation, fetchSignalConversationWithMessages } from '@/lib/db/signal';
import { buildSignalContext, buildConversationTitle, getSuggestedPrompts } from '@/lib/signalContext';
import { sendSignalMessage, type SignalChatTurn, type SignalImageAttachment, type SignalUnavailableReason } from '@/lib/signal';
import { useAthleteRaces } from '@/lib/racesContext';
import { colors, minTouchSize, spacing, typography } from '@/lib/theme';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  hadImage?: boolean;
}

interface StagedImage {
  base64: string;
  previewUri: string;
  mediaType: SignalImageAttachment['mediaType'];
}

// Mirrors the server-side MAX_IMAGE_BASE64_LENGTH in supabase/functions/signal/index.ts — checked
// client-side too so a too-large screenshot is caught before spending a round trip on it.
const MAX_IMAGE_BASE64_LENGTH = 6_000_000;

/**
 * The picker's own `mimeType` is the real format of the picked asset — never assume JPEG. Physical
 * testing found a picked screenshot can genuinely be PNG (Anthropic rejected a PNG sent labeled
 * "image/jpeg"), so this must reflect what the asset actually is, with a safe extension-based
 * fallback only when the picker doesn't report a (supported) mimeType at all.
 */
function resolveMediaType(asset: ImagePicker.ImagePickerAsset): SignalImageAttachment['mediaType'] {
  if (asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/png' || asset.mimeType === 'image/webp') {
    return asset.mimeType;
  }
  const uri = asset.uri.toLowerCase();
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

const THINKING_STATUSES = ['Reading your race history…', 'Analyzing splits…', 'Thinking…'];

const REASON_MESSAGES: Record<SignalUnavailableReason, string> = {
  unauthorized: 'Please sign in again to use Signal.',
  rate_limited: "You've reached today's Signal limit — please try again tomorrow.",
  bad_request: "Signal couldn't understand that — please try again.",
  forbidden: "Signal couldn't access that race.",
  model_error: "Signal couldn't respond just now — please try again.",
  network_error: 'Network issue reaching Signal — please try again.',
};

/**
 * Signal's chat screen (Step 5, V1) — the one real implementation reused from every entry point:
 * seeded from completed Result Detail, seeded from an upcoming Race Detail, unseeded from the
 * Signal tab's "Ask Signal" CTA, or reopened from the Signal tab's "Recent Signals" list (see
 * (tabs)/ask.tsx). A conversation is persisted lazily — only once its first exchange succeeds
 * (see sendMessage) — so an opened-but-abandoned chat never shows up in "Recent Signals".
 */
export default function SignalScreen() {
  const { raceId, conversationId: conversationIdParam } = useLocalSearchParams<{ raceId?: string; conversationId?: string }>();
  const races = useAthleteRaces();
  const { session } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [stagedImage, setStagedImage] = useState<StagedImage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState(THINKING_STATUSES[0]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // A synchronous, ref-based single-flight guard — `isSending` state alone isn't enough, since a
  // rapid double-invocation (e.g. two near-simultaneous events) can both read the pre-update value
  // before either re-render commits. Checked and set at the very top of sendMessage, before any
  // await, so no event/path (button, suggestion chip, or anything else) can start a second request
  // while one is already in flight.
  const isSendingRef = useRef(false);

  // Set once a conversation exists in storage — either restored from `conversationIdParam` (a
  // reopened conversation) or created lazily on the first successful exchange of a new one.
  const [conversationId, setConversationId] = useState<string | undefined>(conversationIdParam);
  // The seed race actually driving context assembly: the route param for a fresh conversation, or
  // the conversation's own stored `seed_race_id` once a reopened one finishes loading — never both.
  const [effectiveSeedRaceId, setEffectiveSeedRaceId] = useState<string | undefined>(raceId);
  const [isLoadingConversation, setIsLoadingConversation] = useState(!!conversationIdParam);

  const seedRace = effectiveSeedRaceId ? races.data.find((race) => race.id === effectiveSeedRaceId) : undefined;
  const suggestions = getSuggestedPrompts(races.data, effectiveSeedRaceId);

  useEffect(() => {
    if (!conversationIdParam) return;
    let cancelled = false;
    (async () => {
      const result = await fetchSignalConversationWithMessages(conversationIdParam);
      if (cancelled) return;
      if (result) {
        setEffectiveSeedRaceId(result.conversation.seed_race_id ?? undefined);
        setMessages(result.messages.map((message) => ({ id: message.id, role: message.role, text: message.text })));
      }
      setIsLoadingConversation(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationIdParam]);

  useEffect(() => {
    if (!isSending) return;
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % THINKING_STATUSES.length;
      setThinkingStatus(THINKING_STATUSES[index]!);
    }, 2200);
    return () => clearInterval(interval);
  }, [isSending]);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow RaceSignal to access your photos to attach a screenshot.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.6,
      exif: false,
      allowsEditing: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.base64) return;

    if (asset.base64.length > MAX_IMAGE_BASE64_LENGTH) {
      Alert.alert('Image too large', 'Please choose a smaller screenshot (or crop it) and try again.');
      return;
    }

    setStagedImage({ base64: asset.base64, previewUri: asset.uri, mediaType: resolveMediaType(asset) });
    if (inputText.trim().length === 0) {
      setInputText('Analyze this screenshot');
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isSendingRef.current) return; // hard guard — see isSendingRef's comment above.
    isSendingRef.current = true;
    setIsSending(true);

    const image = stagedImage;
    setErrorText(null);
    setMessages((current) => [...current, { id: `${Date.now()}-user`, role: 'user', text: trimmed, hadImage: !!image }]);
    setInputText('');
    setStagedImage(null);
    setThinkingStatus(THINKING_STATUSES[0]!);

    try {
      const context = buildSignalContext(races.data, effectiveSeedRaceId);
      const history: SignalChatTurn[] = messages.map((message) => ({ role: message.role, text: message.text }));

      const result = await sendSignalMessage(
        context,
        history,
        trimmed,
        image ? { base64: image.base64, mediaType: image.mediaType } : undefined,
      );

      if (!result.available) {
        // `result.detail` (a safe, truncated backend diagnostic — see lib/signal.ts) is
        // deliberately not shown here: it was useful while chasing real device failures, but an
        // athlete-facing error should stay short and friendly, never expose implementation
        // details. It's still logged via console.warn in sendSignalMessage for developer use.
        setErrorText(REASON_MESSAGES[result.reason]);
        return;
      }
      setMessages((current) => [...current, { id: `${Date.now()}-assistant`, role: 'assistant', text: result.data.reply }]);

      // Persist this turn — lazily creates the conversation on the first successful exchange, so
      // an abandoned chat with no real reply never shows up in "Recent Signals". A failure here is
      // soft: the conversation itself already succeeded, only the save didn't, so it's logged, not
      // surfaced as a chat error.
      const athleteId = session?.user.id;
      if (athleteId) {
        try {
          let activeConversationId = conversationId;
          if (!activeConversationId) {
            const title = buildConversationTitle(seedRace, trimmed);
            const created = await createSignalConversation(athleteId, title, effectiveSeedRaceId);
            activeConversationId = created.id;
            setConversationId(created.id);
          }
          await appendSignalTurn(activeConversationId, trimmed, result.data.reply);
        } catch (err) {
          console.warn('[Signal] failed to persist conversation turn:', err);
        }
      }
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }

  const headerTitle = seedRace ? seedRace.name : 'Ask Signal';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: headerTitle }} />
      <View style={styles.screen}>
        {races.isLoading || isLoadingConversation ? (
          <LoadingSkeleton rows={4} />
        ) : races.isError ? (
          <ErrorState />
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {seedRace ? (
              <Text style={styles.seedNote}>
                Signal has your {seedRace.name} result and your full race history.
              </Text>
            ) : (
              <Text style={styles.seedNote}>Signal has your full race history.</Text>
            )}

            {messages.length > 0 ? (
              <View style={styles.messages}>
                {messages.map((message) => (
                  <View
                    key={message.id}
                    style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
                    {message.hadImage ? <Text style={styles.imageTag}>📷 Screenshot attached</Text> : null}
                    <Text style={message.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                      {message.text}
                    </Text>
                  </View>
                ))}
                {isSending ? (
                  <View style={[styles.bubble, styles.bubbleAssistant]}>
                    <Text style={styles.bubbleTextAssistant}>{thinkingStatus}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {messages.length === 0 && !isSending ? (
              <View style={styles.suggestionRow}>
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    onPress={() => sendMessage(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={suggestion}
                    style={styles.suggestionChip}>
                    <Text style={styles.suggestionLabel}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
          </ScrollView>
        )}

        {stagedImage ? (
          <View style={styles.stagedImageRow}>
            <Image source={{ uri: stagedImage.previewUri }} style={styles.stagedImageThumb} />
            <Text style={styles.stagedImageLabel}>Screenshot ready to send</Text>
            <Pressable
              onPress={() => setStagedImage(null)}
              accessibilityRole="button"
              accessibilityLabel="Remove screenshot"
              hitSlop={8}
              style={styles.stagedImageRemove}>
              <Text style={styles.stagedImageRemoveLabel}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.inputBar}>
          <Pressable
            onPress={pickImage}
            accessibilityRole="button"
            accessibilityLabel="Attach a screenshot"
            style={styles.attachButton}>
            <Text style={styles.attachIcon}>📷</Text>
          </Pressable>
          <TextInput
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask Signal about your races…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Message"
            multiline
            // The green ↑ button is the ONLY send action (V1 device-test requirement) — keyboard
            // Return must only ever insert a newline. blurOnSubmit={false} keeps the keyboard from
            // dismissing on Return (the multiline default, made explicit here rather than relied
            // on), returnKeyType="default" keeps the key labeled/behaving like a plain return
            // rather than a "Send"/"Go" key, and onSubmitEditing is an explicit no-op so no future
            // change can accidentally wire Return to sendMessage.
            blurOnSubmit={false}
            returnKeyType="default"
            onSubmitEditing={() => {}}
          />
          <Pressable
            onPress={() => sendMessage(inputText)}
            disabled={inputText.trim().length === 0 || isSending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.sendButton, (inputText.trim().length === 0 || isSending) && styles.sendButtonDisabled]}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  },
  seedNote: {
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
    gap: 4,
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
  imageTag: {
    ...typography.caption,
    color: colors.textMuted,
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
  errorText: {
    ...typography.caption,
    color: colors.danger,
  },
  stagedImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  stagedImageThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  stagedImageLabel: {
    ...typography.caption,
    flex: 1,
  },
  stagedImageRemove: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stagedImageRemoveLabel: {
    ...typography.body,
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
