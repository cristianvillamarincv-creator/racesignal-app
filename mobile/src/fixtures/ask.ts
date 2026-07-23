export interface AskEntry {
  id: string;
  title: string;
  description: string;
}

export const askEntriesPopulated: AskEntry[] = [
  {
    id: 'explain-workout',
    title: 'Explain a workout',
    description: "Paste today's session and see what it's really training for.",
  },
  {
    id: 'compare-gear',
    title: 'Compare gear',
    description: 'Weigh a gear decision using your bike and budget.',
  },
  {
    id: 'prepare-race',
    title: 'Prepare for my race',
    description: 'Turn readiness gaps into checklist items.',
  },
  {
    id: 'performance-question',
    title: 'Review a performance question',
    description: 'Make sense of a ride, run, or race result.',
  },
  {
    id: 'create-signal',
    title: 'Create a training Signal',
    description: 'Describe a session and get a Signal draft.',
  },
];

export const askEntriesEmpty: AskEntry[] = [];

export const askCredits = { used: 0, total: 3 };
