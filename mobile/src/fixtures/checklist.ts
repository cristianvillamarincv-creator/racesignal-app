export interface ChecklistItem {
  id: string;
  section: string;
  label: string;
  isComplete: boolean;
}

export const checklistSections = [
  'Planning',
  'Travel',
  'Pack — Swim',
  'Pack — Bike',
  'Pack — Run',
  'Nutrition',
] as const;

export const checklistItemsPopulated: ChecklistItem[] = [
  { id: 'planning-registration', section: 'Planning', label: 'Registration confirmed', isComplete: true },
  { id: 'planning-documents', section: 'Planning', label: 'Race documents printed', isComplete: true },
  { id: 'planning-course', section: 'Planning', label: 'Reviewed course maps', isComplete: false },

  { id: 'travel-hotel', section: 'Travel', label: 'Hotel booked', isComplete: true },
  { id: 'travel-transport', section: 'Travel', label: 'Transportation to venue arranged', isComplete: false },

  { id: 'swim-wetsuit', section: 'Pack — Swim', label: 'Wetsuit', isComplete: true },
  { id: 'swim-goggles', section: 'Pack — Swim', label: 'Goggles', isComplete: true },
  { id: 'swim-backup-goggles', section: 'Pack — Swim', label: 'Backup goggles', isComplete: false },
  { id: 'swim-anti-chafe', section: 'Pack — Swim', label: 'Anti-chafing balm', isComplete: false },

  { id: 'bike-bike', section: 'Pack — Bike', label: 'Bike', isComplete: true },
  { id: 'bike-helmet', section: 'Pack — Bike', label: 'Helmet', isComplete: true },
  { id: 'bike-shoes', section: 'Pack — Bike', label: 'Cycling shoes', isComplete: true },
  { id: 'bike-bottles', section: 'Pack — Bike', label: 'Bottles', isComplete: false },
  { id: 'bike-repair-kit', section: 'Pack — Bike', label: 'Repair kit', isComplete: false },
  { id: 'bike-electronics', section: 'Pack — Bike', label: 'Electronics and batteries', isComplete: false },
  { id: 'bike-service', section: 'Pack — Bike', label: 'Bike service completed', isComplete: false },

  { id: 'run-shoes', section: 'Pack — Run', label: 'Running shoes', isComplete: true },
  { id: 'run-socks', section: 'Pack — Run', label: 'Socks', isComplete: false },
  { id: 'run-hat', section: 'Pack — Run', label: 'Hat', isComplete: false },
  { id: 'run-sunglasses', section: 'Pack — Run', label: 'Sunglasses', isComplete: false },
  { id: 'run-belt', section: 'Pack — Run', label: 'Race belt', isComplete: false },

  { id: 'nutrition-breakfast', section: 'Nutrition', label: 'Race-morning breakfast planned', isComplete: false },
  { id: 'nutrition-bike-fuel', section: 'Nutrition', label: 'Bike fuel', isComplete: false },
  { id: 'nutrition-run-fuel', section: 'Nutrition', label: 'Run fuel', isComplete: false },
  { id: 'nutrition-electrolytes', section: 'Nutrition', label: 'Electrolytes', isComplete: false },
  { id: 'nutrition-backup', section: 'Nutrition', label: 'Backup nutrition', isComplete: false },
];

export const checklistItemsEmpty: ChecklistItem[] = [];
