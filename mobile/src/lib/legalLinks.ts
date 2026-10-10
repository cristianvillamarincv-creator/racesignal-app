/**
 * Public URLs for RaceSignal's legal and support pages, hosted on the RaceSignal website (racesignal.app; the static
 * site in site/, published through Cloudflare Pages). Settings falls back to an inert "Coming soon" row for whichever of
 * these is ever empty (see settings/index.tsx), so this file is the only edit needed if a page's URL ever changes.
 * Before 1.1 these pointed at public Notion pages.
 */
export const PRIVACY_POLICY_URL = 'https://racesignal.app/privacy/';
export const TERMS_OF_USE_URL = 'https://racesignal.app/terms/';
export const SUPPORT_URL = 'https://racesignal.app/support/';
/** Anthropic's own privacy policy — linked from the Signal first-use consent sheet (B.12), since
 *  that's the third party RaceSignal shares race data/questions/screenshots with to generate a
 *  Signal reply. Not a RaceSignal-controlled page — never edit this to point anywhere but
 *  Anthropic's real, current policy. */
export const ANTHROPIC_PRIVACY_POLICY_URL = 'https://www.anthropic.com/legal/privacy';
