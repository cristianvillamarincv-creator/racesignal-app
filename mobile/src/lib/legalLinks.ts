/**
 * Public URLs for RaceSignal's legal/support pages (Step 7.2), hosted as public Notion pages —
 * not a website/CMS this app builds or serves. Settings falls back to an inert "Coming soon" row
 * for whichever of these is ever empty (see settings/index.tsx), so this file is the only edit
 * needed if a page's URL ever changes.
 */
export const PRIVACY_POLICY_URL = 'https://brazen-plane-f2b.notion.site/RaceSignal-Privacy-Policy-3e776e47d35d801a9f7bca6614646596?pvs=143';
export const TERMS_OF_USE_URL = 'https://brazen-plane-f2b.notion.site/RaceSignal-Terms-of-Use-3e776e47d35d8090b387c7911126625c?pvs=143';
export const SUPPORT_URL = 'https://brazen-plane-f2b.notion.site/RaceSignal-Support-3e776e47d35d801495fcd9003b8779d9';
/** Anthropic's own privacy policy — linked from the Signal first-use consent sheet (B.12), since
 *  that's the third party RaceSignal shares race data/questions/screenshots with to generate a
 *  Signal reply. Not a RaceSignal-controlled page — never edit this to point anywhere but
 *  Anthropic's real, current policy. */
export const ANTHROPIC_PRIVACY_POLICY_URL = 'https://www.anthropic.com/legal/privacy';
