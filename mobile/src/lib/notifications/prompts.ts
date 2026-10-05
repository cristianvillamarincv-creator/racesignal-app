/**
 * The six between-race prompts and the editable Signal draft each one opens. A retrospective prompt only makes sense with recent
 * completed race history, so it is eligible only when there is a completed race in the last 12 months.
 */
export interface BetweenRacePrompt {
  id: string;
  question: string;
  draft: string;
  retrospective: boolean;
}

export const BETWEEN_RACE_PROMPTS: readonly BetweenRacePrompt[] = [
  { id: 'next-season-focus', question: 'What are you thinking about for next race season?', draft: 'Next season, I want to focus on…', retrospective: false },
  { id: 'more-time-this-season', question: 'What did you wish you’d spent more time on this season?', draft: 'This season, I wanted to spend more time on…', retrospective: true },
  { id: 'try-next-distance', question: 'Is there a race distance you’d like to try next?', draft: 'I’m thinking about trying…', retrospective: false },
  { id: 'next-race-success', question: 'What would make your next race feel successful?', draft: 'At my next race, success would mean…', retrospective: false },
  { id: 'went-well', question: 'What went well this season that you want to carry forward?', draft: 'Something that worked well this season was…', retrospective: true },
  { id: 'change-prep', question: 'What would you change about how you prepared for your last race?', draft: 'Before my last race, I wish I had…', retrospective: true },
];

export function promptById(id: string | undefined | null): BetweenRacePrompt | null {
  return BETWEEN_RACE_PROMPTS.find((prompt) => prompt.id === id) ?? null;
}

/** Ids of the prompts that may be sent now. */
export function eligiblePromptIds(hasRecentCompletedRace: boolean): string[] {
  return BETWEEN_RACE_PROMPTS.filter((prompt) => hasRecentCompletedRace || !prompt.retrospective).map((prompt) => prompt.id);
}
