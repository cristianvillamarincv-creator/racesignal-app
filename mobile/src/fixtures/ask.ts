export interface AskSuggestion {
  id: string;
  text: string;
}

/** Compact suggestion chips below the chat input — not giant prompt cards. */
export const askSuggestionsPopulated: AskSuggestion[] = [
  { id: 'compare-70-3-bike-splits', text: 'Compare my 70.3 bike splits' },
  { id: 'replace-shoes', text: 'Should I replace my shoes before Ottawa?' },
  { id: 'plan-race-week', text: 'Help me plan race week' },
  { id: 'bike-upgrade', text: 'What upgrade would help my bike setup most?' },
];

export const askSuggestionsEmpty: AskSuggestion[] = [];

export const askCredits = { used: 0, total: 3 };

/** Static preferences shown in the athlete-context preview — mock only. */
export const athletePreferences = ['Prefers gels over chews on the bike', 'No dietary restrictions logged'];
