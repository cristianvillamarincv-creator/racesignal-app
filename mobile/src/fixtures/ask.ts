export interface AskEntry {
  id: string;
  title: string;
  description: string;
}

export const askEntriesPopulated: AskEntry[] = [
  {
    id: 'compare-70-3-bike-splits',
    title: 'Compare my last three 70.3 bike splits',
    description: 'Uses your race history and splits.',
  },
  {
    id: 'replace-running-shoes',
    title: 'Should I replace my running shoes before Ottawa?',
    description: 'Uses your gear and upcoming race.',
  },
  {
    id: 'recommend-gels',
    title: "Recommend gels for my long ride based on what I've used before",
    description: 'Uses your nutrition history and preferences.',
  },
  {
    id: 'wheels-or-power-meter',
    title: 'Should I upgrade my wheels or buy a power meter?',
    description: 'Uses your bike, budget, and goals.',
  },
  {
    id: 'why-slower-at-muskoka',
    title: 'Why was my run slower at Muskoka?',
    description: 'Uses your splits, conditions, and training history.',
  },
  {
    id: 'prepare-for-race-week',
    title: 'Help me prepare for race week',
    description: 'Uses your upcoming race and checklist.',
  },
];

export const askEntriesEmpty: AskEntry[] = [];

export const askCredits = { used: 0, total: 3 };

export interface AskContextItem {
  id: string;
  label: string;
}

/** Static, inert — communicates what Ask will eventually draw on. No real functionality yet. */
export const askContextItems: AskContextItem[] = [
  { id: 'race-history', label: 'Race history' },
  { id: 'upcoming-races', label: 'Upcoming races' },
  { id: 'training-history', label: 'Training history' },
  { id: 'bike', label: 'Bike' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'wetsuit', label: 'Wetsuit' },
  { id: 'power-meter', label: 'Power meter' },
  { id: 'trainer', label: 'Trainer' },
  { id: 'nutrition', label: 'Nutrition' },
  { id: 'preferences', label: 'Preferences' },
];
