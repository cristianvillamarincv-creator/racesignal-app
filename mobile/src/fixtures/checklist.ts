export interface ChecklistItem {
  id: string;
  section: string;
  label: string;
  isComplete: boolean;
}

/**
 * Same generic checklist template is reused for whichever upcoming race is being prepped —
 * per-race custom checklists are a later (Premium) milestone, not this one.
 */
export const checklistSections = [
  'Registration',
  'Travel & Hotel',
  'Course Review',
  'Packing — Swim',
  'Packing — Bike',
  'Packing — Run',
  'Nutrition',
] as const;

export const checklistItemsPopulated: ChecklistItem[] = [
  { id: 'registration-confirmed', section: 'Registration', label: 'Registration confirmed', isComplete: true },
  { id: 'registration-documents', section: 'Registration', label: 'Race documents printed', isComplete: true },
  { id: 'registration-athlete-guide', section: 'Registration', label: 'Read the athlete guide', isComplete: false },

  { id: 'travel-hotel', section: 'Travel & Hotel', label: 'Hotel booked', isComplete: true },
  { id: 'travel-transport', section: 'Travel & Hotel', label: 'Transportation to venue arranged', isComplete: false },
  { id: 'travel-bike-case', section: 'Travel & Hotel', label: 'Bike travel case reserved', isComplete: false },

  { id: 'course-elevation', section: 'Course Review', label: 'Reviewed bike course elevation', isComplete: false },
  { id: 'course-aid-stations', section: 'Course Review', label: 'Reviewed run course aid stations', isComplete: false },
  { id: 'course-transition-layout', section: 'Course Review', label: 'Studied transition layout', isComplete: false },

  { id: 'swim-wetsuit', section: 'Packing — Swim', label: 'Wetsuit', isComplete: true },
  { id: 'swim-goggles', section: 'Packing — Swim', label: 'Goggles', isComplete: true },
  { id: 'swim-backup-goggles', section: 'Packing — Swim', label: 'Backup goggles', isComplete: false },
  { id: 'swim-anti-chafe', section: 'Packing — Swim', label: 'Anti-chafing balm', isComplete: false },

  { id: 'bike-bike', section: 'Packing — Bike', label: 'Bike', isComplete: true },
  { id: 'bike-helmet', section: 'Packing — Bike', label: 'Helmet', isComplete: true },
  { id: 'bike-shoes', section: 'Packing — Bike', label: 'Cycling shoes', isComplete: true },
  { id: 'bike-bottles', section: 'Packing — Bike', label: 'Bottles', isComplete: false },
  { id: 'bike-repair-kit', section: 'Packing — Bike', label: 'Repair kit', isComplete: false },
  { id: 'bike-electronics', section: 'Packing — Bike', label: 'Electronics and batteries', isComplete: false },
  { id: 'bike-service', section: 'Packing — Bike', label: 'Bike service completed', isComplete: false },

  { id: 'run-shoes', section: 'Packing — Run', label: 'Running shoes', isComplete: true },
  { id: 'run-socks', section: 'Packing — Run', label: 'Socks', isComplete: false },
  { id: 'run-hat', section: 'Packing — Run', label: 'Hat', isComplete: false },
  { id: 'run-sunglasses', section: 'Packing — Run', label: 'Sunglasses', isComplete: false },
  { id: 'run-belt', section: 'Packing — Run', label: 'Race belt', isComplete: false },

  { id: 'nutrition-breakfast', section: 'Nutrition', label: 'Race-morning breakfast planned', isComplete: false },
  { id: 'nutrition-bike-fuel', section: 'Nutrition', label: 'Bike fuel', isComplete: false },
  { id: 'nutrition-run-fuel', section: 'Nutrition', label: 'Run fuel', isComplete: false },
  { id: 'nutrition-electrolytes', section: 'Nutrition', label: 'Electrolytes', isComplete: false },
  { id: 'nutrition-backup', section: 'Nutrition', label: 'Backup nutrition', isComplete: false },
];

export const checklistItemsEmpty: ChecklistItem[] = [];
