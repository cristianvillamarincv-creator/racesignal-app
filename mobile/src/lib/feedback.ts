import { Alert, Linking, Share } from 'react-native';

/** Where Settings → Share feedback goes. */
export const FEEDBACK_EMAIL = 'racesignal@gmail.com';

/**
 * A plain mailto link: the recipient and a "Feedback" subject, a blank body, and nothing else. No account information, logs or other
 * data is added, and nothing is sent automatically: the athlete's own email app opens a draft they write and send themselves.
 */
export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=Feedback`;

/**
 * Opens the email app with the feedback draft. If it cannot open (no mail account or app), says so and shows the address, with a
 * Copy action. The project has no clipboard module (adding one would need a native rebuild), so "Copy email…" opens the iOS share
 * sheet, whose Copy action puts the address on the clipboard.
 */
export async function openFeedbackEmail(): Promise<void> {
  try {
    await Linking.openURL(FEEDBACK_MAILTO);
  } catch {
    Alert.alert('Couldn’t open your email app', `You can email us at ${FEEDBACK_EMAIL}.`, [
      {
        text: 'Copy email…',
        onPress: () => {
          Share.share({ message: FEEDBACK_EMAIL }).catch(() => {});
        },
      },
      { text: 'OK', style: 'cancel' },
    ]);
  }
}
