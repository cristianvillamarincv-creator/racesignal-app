import { Alert, Linking, Share } from 'react-native';

import { FEEDBACK_EMAIL, FEEDBACK_MAILTO, openFeedbackEmail } from '@/lib/feedback';

/** Settings → Share feedback: a mailto link to the support address with a "Feedback" subject and a blank body, and a clear fallback. */

afterEach(() => jest.restoreAllMocks());

describe('Share feedback email', () => {
  it('opens a mailto link to racesignal@gmail.com with the subject "Feedback", a blank body and no other data', async () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openFeedbackEmail();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0]![0];
    expect(url).toBe('mailto:racesignal@gmail.com?subject=Feedback');
    expect(url).toBe(FEEDBACK_MAILTO);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('mailto:');
    expect(parsed.pathname).toBe('racesignal@gmail.com');
    expect([...parsed.searchParams.keys()]).toEqual(['subject']); // no body, cc, bcc or anything attached
    expect(parsed.searchParams.get('subject')).toBe('Feedback');
    expect(url).not.toMatch(/body=/i);
  });

  it('does not show the fallback when the email app opens', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openFeedbackEmail();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('when the email app cannot open, shows a simple message with the address and a Copy action', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Unable to open URL'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
    await openFeedbackEmail();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0]! as [string, string, { text: string; onPress?: () => void; style?: string }[]];
    expect(title).toBe('Couldn’t open your email app');
    expect(message).toContain(FEEDBACK_EMAIL);
    expect(buttons.map((b) => b.text)).toEqual(['Copy email…', 'OK']);

    buttons[0]!.onPress!();
    expect(shareSpy).toHaveBeenCalledWith({ message: FEEDBACK_EMAIL }); // only the address is offered, nothing about the account
  });

  it('a failed share sheet never throws out of the fallback', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('share failed'));
    await openFeedbackEmail();
    const buttons = alertSpy.mock.calls[0]![2] as { onPress?: () => void }[];
    expect(() => buttons[0]!.onPress!()).not.toThrow();
  });
});
