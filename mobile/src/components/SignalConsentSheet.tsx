import { useMemo } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type BrandPalette, useBrandPalette } from '@/lib/brandTheme';
import { ANTHROPIC_PRIVACY_POLICY_URL, PRIVACY_POLICY_URL } from '@/lib/legalLinks';
import { spacing } from '@/lib/theme';

/**
 * The first-use Signal consent sheet (B.12) — shown once per account per disclosure version,
 * immediately before the FIRST request that would transmit anything to Anthropic (a typed
 * question, a tapped suggestion, or a screenshot attachment alike — see signal.tsx's sendMessage,
 * the one choke point every Signal-sending path goes through). Same Modal + slide-up sheet shell as
 * AddRaceSheet.tsx (this app's one existing custom bottom sheet), not a broader redesign — just a
 * body paragraph and two stacked buttons instead of selectable rows.
 *
 * Copy is fixed, not a prop — this sheet's whole job is to say exactly this, accurately, every
 * time. Verified against what's actually sent (`src/lib/signal.ts`'s `sendSignalMessage`, body
 * `{ context, history, message, requestId, image }`): "relevant race results" is `context`,
 * "your question" is `message`, "relevant conversation history" is `history`, "any screenshots you
 * attach" is `image`. Nothing else — no email, name, or device identifier — is ever in that body.
 */
export function SignalConsentSheet({
  visible,
  onAgree,
  onDecline,
}: {
  visible: boolean;
  onAgree: () => void;
  onDecline: () => void;
}) {
  const palette = useBrandPalette();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDecline} statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Unlike AddRaceSheet, tapping the backdrop is treated the same as "Not now" — this is a
            consent decision, not a menu, so dismissing it any way must never be read as agreeing. */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onDecline} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Text style={styles.heading}>Before you use Signal</Text>
          <Text style={styles.body}>
            Signal uses Anthropic’s Claude to analyze your performance. To answer your questions, RaceSignal shares
            relevant race results, your question, relevant conversation history, and any screenshots you attach with
            Anthropic.
          </Text>

          <View style={styles.linkRow}>
            <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} accessibilityRole="link" accessibilityLabel="RaceSignal Privacy Policy">
              <Text style={styles.link}>RaceSignal Privacy Policy</Text>
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL(ANTHROPIC_PRIVACY_POLICY_URL)}
              accessibilityRole="link"
              accessibilityLabel="Anthropic Privacy Policy">
              <Text style={styles.link}>Anthropic Privacy Policy</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={onAgree}
            accessibilityRole="button"
            accessibilityLabel="Agree and continue"
            style={[styles.primaryButton, { backgroundColor: palette.signalBlue }]}>
            <Text style={[styles.primaryButtonLabel, { color: palette.onSignalBlue }]}>Agree and continue</Text>
          </Pressable>
          <Pressable
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            style={[styles.secondaryButton, { borderColor: palette.hairline }]}>
            <Text style={[styles.secondaryButtonLabel, { color: palette.ink }]}>Not now</Text>
          </Pressable>
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
  linkRow: ViewStyle;
  link: TextStyle;
  primaryButton: ViewStyle;
  primaryButtonLabel: TextStyle;
  secondaryButton: ViewStyle;
  secondaryButtonLabel: TextStyle;
}

function createStyles(palette: BrandPalette): Styles {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    sheet: {
      backgroundColor: palette.canvasElevated,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      gap: spacing.sm,
    },
    heading: {
      fontSize: 19,
      fontWeight: '700',
      color: palette.ink,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: palette.inkSecondary,
    },
    linkRow: {
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    link: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.signalBlue,
      textDecorationLine: 'underline',
    },
    primaryButton: {
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 999,
      marginTop: spacing.sm,
    },
    primaryButtonLabel: {
      fontWeight: '700',
      fontSize: 15,
    },
    secondaryButton: {
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
    },
    secondaryButtonLabel: {
      fontSize: 15,
      fontWeight: '700',
    },
  });
}
