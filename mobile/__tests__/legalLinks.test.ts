import { ANTHROPIC_PRIVACY_POLICY_URL, PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_USE_URL } from '@/lib/legalLinks';

/** Release 1.1: the in-app legal and support links point at the RaceSignal website (racesignal.app), not the old Notion pages. */
describe('legal links', () => {
  it('Privacy, Terms and Support are the live racesignal.app pages over HTTPS', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://racesignal.app/privacy/');
    expect(TERMS_OF_USE_URL).toBe('https://racesignal.app/terms/');
    expect(SUPPORT_URL).toBe('https://racesignal.app/support/');
  });

  it('none of the RaceSignal links still points at Notion, and none is empty (an empty URL would show a "Coming soon" row)', () => {
    for (const url of [PRIVACY_POLICY_URL, TERMS_OF_USE_URL, SUPPORT_URL]) {
      expect(url).toMatch(/^https:\/\/racesignal\.app\/[a-z]+\/$/);
      expect(url).not.toMatch(/notion/);
    }
  });

  it("the Signal consent sheet's third-party link is still Anthropic's own policy", () => {
    expect(ANTHROPIC_PRIVACY_POLICY_URL).toBe('https://www.anthropic.com/legal/privacy');
  });
});
