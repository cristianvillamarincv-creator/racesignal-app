export interface ChecklistTemplateItem {
  id: string;
  section: string;
  label: string;
}

/**
 * One shared Race Prep template, reused for every upcoming race — a per-race custom checklist is
 * a later (Premium) milestone, not this one. Restored from the earlier read-only fixture (see
 * git history), now backing a real persisted checklist: only `race.checklistCompleted` (a list of
 * these ids) is stored per race — the labels/sections below never change per athlete or per race.
 *
 * Documented future direction (not scoped, not started): profile-level default checklist
 * templates, potentially separate Running/Triathlon defaults, athlete-editable items (add/
 * remove/reorder), and new upcoming races inheriting the relevant template at creation time. The
 * current single fixed template + persisted-ids-per-race model is intentionally good enough for
 * V1 and isn't designed to make that migration hard — a future per-athlete template would still
 * just be a different source for this same id list.
 */
export const CHECKLIST_SECTIONS = [
  'Registration',
  'Travel & Hotel',
  'Course Review',
  'Packing: Swim',
  'Packing: Bike',
  'Packing: Run',
  'Nutrition',
] as const;

export const CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  { id: 'registration-confirmed', section: 'Registration', label: 'Registration confirmed' },
  { id: 'registration-documents', section: 'Registration', label: 'Race documents printed' },
  { id: 'registration-athlete-guide', section: 'Registration', label: 'Read the athlete guide' },

  { id: 'travel-hotel', section: 'Travel & Hotel', label: 'Hotel booked' },
  { id: 'travel-transport', section: 'Travel & Hotel', label: 'Transportation to venue arranged' },
  { id: 'travel-bike-case', section: 'Travel & Hotel', label: 'Bike travel case reserved' },

  { id: 'course-elevation', section: 'Course Review', label: 'Reviewed bike course elevation' },
  { id: 'course-aid-stations', section: 'Course Review', label: 'Reviewed run course aid stations' },
  { id: 'course-transition-layout', section: 'Course Review', label: 'Studied transition layout' },

  { id: 'swim-wetsuit', section: 'Packing: Swim', label: 'Wetsuit' },
  { id: 'swim-goggles', section: 'Packing: Swim', label: 'Goggles' },
  { id: 'swim-backup-goggles', section: 'Packing: Swim', label: 'Backup goggles' },
  { id: 'swim-anti-chafe', section: 'Packing: Swim', label: 'Anti-chafing balm' },

  { id: 'bike-bike', section: 'Packing: Bike', label: 'Bike' },
  { id: 'bike-helmet', section: 'Packing: Bike', label: 'Helmet' },
  { id: 'bike-shoes', section: 'Packing: Bike', label: 'Cycling shoes' },
  { id: 'bike-bottles', section: 'Packing: Bike', label: 'Bottles' },
  { id: 'bike-repair-kit', section: 'Packing: Bike', label: 'Repair kit' },
  { id: 'bike-electronics', section: 'Packing: Bike', label: 'Electronics and batteries' },
  { id: 'bike-service', section: 'Packing: Bike', label: 'Bike service completed' },

  { id: 'run-shoes', section: 'Packing: Run', label: 'Running shoes' },
  { id: 'run-socks', section: 'Packing: Run', label: 'Socks' },
  { id: 'run-hat', section: 'Packing: Run', label: 'Hat' },
  { id: 'run-sunglasses', section: 'Packing: Run', label: 'Sunglasses' },
  { id: 'run-belt', section: 'Packing: Run', label: 'Race belt' },

  { id: 'nutrition-breakfast', section: 'Nutrition', label: 'Race-morning breakfast planned' },
  { id: 'nutrition-bike-fuel', section: 'Nutrition', label: 'Bike fuel' },
  { id: 'nutrition-run-fuel', section: 'Nutrition', label: 'Run fuel' },
  { id: 'nutrition-electrolytes', section: 'Nutrition', label: 'Electrolytes' },
  { id: 'nutrition-backup', section: 'Nutrition', label: 'Backup nutrition' },
];
