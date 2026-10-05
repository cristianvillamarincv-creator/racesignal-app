import type { SportCategory } from '@/fixtures/races';
import { CHECKLIST_TEMPLATE, type ChecklistTemplateItem } from '@/lib/checklistTemplate';

/**
 * Which Race Prep items a notification may mention for a race. The checklist itself is one shared 30-item template and is never changed
 * here: this only decides which UNCHECKED items are worth naming in a reminder. A running race never gets a swim or bike item, a
 * cycling race never gets a swim or run item, and so on. A sport we cannot classify ('other') is "uncertain": no specific item is
 * ever named for it.
 */

type Discipline = 'swim' | 'bike' | 'run' | 'transition' | 'all';

const ITEM_DISCIPLINE: Record<string, Discipline> = {
  'registration-confirmed': 'all',
  'registration-documents': 'all',
  'registration-athlete-guide': 'all',
  'travel-hotel': 'all',
  'travel-transport': 'all',
  'travel-bike-case': 'bike',
  'course-elevation': 'bike',
  'course-aid-stations': 'run',
  'course-transition-layout': 'transition',
  'swim-wetsuit': 'swim',
  'swim-goggles': 'swim',
  'swim-backup-goggles': 'swim',
  'swim-anti-chafe': 'swim',
  'bike-bike': 'bike',
  'bike-helmet': 'bike',
  'bike-shoes': 'bike',
  'bike-bottles': 'bike',
  'bike-repair-kit': 'bike',
  'bike-electronics': 'bike',
  'bike-service': 'bike',
  'run-shoes': 'run',
  'run-socks': 'run',
  'run-hat': 'run',
  'run-sunglasses': 'run',
  'run-belt': 'run',
  'nutrition-breakfast': 'all',
  'nutrition-bike-fuel': 'bike',
  'nutrition-run-fuel': 'run',
  'nutrition-electrolytes': 'all',
  'nutrition-backup': 'all',
};

const SPORT_DISCIPLINES: Record<Exclude<SportCategory, 'other'>, ReadonlySet<Discipline>> = {
  triathlon: new Set(['swim', 'bike', 'run', 'transition', 'all']),
  duathlon: new Set(['bike', 'run', 'transition', 'all']),
  running: new Set(['run', 'all']),
  cycling: new Set(['bike', 'all']),
  swimming: new Set(['swim', 'all']),
};

/** A natural question for each item, used only when that exact item is unchecked. */
export const ITEM_QUESTIONS: Record<string, string> = {
  'registration-confirmed': 'Is your registration confirmed?',
  'registration-documents': 'Have you printed your race documents?',
  'registration-athlete-guide': 'Have you read the athlete guide?',
  'travel-hotel': 'Is your hotel booked?',
  'travel-transport': 'Is your transportation sorted?',
  'travel-bike-case': 'Is your bike travel case reserved?',
  'course-elevation': 'Have you looked at the bike course elevation?',
  'course-aid-stations': 'Have you looked at the run course aid stations?',
  'course-transition-layout': 'Have you studied the transition layout?',
  'swim-wetsuit': 'Is your wetsuit ready?',
  'swim-goggles': 'Are your goggles packed?',
  'swim-backup-goggles': 'Do you have backup goggles?',
  'swim-anti-chafe': 'Is your anti-chafing balm packed?',
  'bike-bike': 'Is your bike ready to go?',
  'bike-helmet': 'Is your helmet packed?',
  'bike-shoes': 'Are your cycling shoes packed?',
  'bike-bottles': 'Are your bottles packed?',
  'bike-repair-kit': 'Is your repair kit packed?',
  'bike-electronics': 'Are your electronics and batteries charged?',
  'bike-service': 'Has your bike been serviced?',
  'run-shoes': 'Are your running shoes ready?',
  'run-socks': 'Are your socks packed?',
  'run-hat': 'Is your hat packed?',
  'run-sunglasses': 'Are your sunglasses packed?',
  'run-belt': 'Is your race belt packed?',
  'nutrition-breakfast': 'Have you planned your race-morning breakfast?',
  'nutrition-bike-fuel': 'Is your bike fuel sorted?',
  'nutrition-run-fuel': 'Is your run fuel sorted?',
  'nutrition-electrolytes': 'Are your electrolytes packed?',
  'nutrition-backup': 'Do you have backup nutrition?',
};

export interface RaceRelevance {
  /** True when the sport is not one we can classify: only generic wording may be used and no item is named. */
  uncertain: boolean;
  /** The template items a notification may name for this race (all of them when uncertain, only for completion checks). */
  items: ChecklistTemplateItem[];
}

export function relevantItemsFor(sport: SportCategory): RaceRelevance {
  if (sport === 'other' || !(sport in SPORT_DISCIPLINES)) return { uncertain: true, items: CHECKLIST_TEMPLATE };
  const allowed = SPORT_DISCIPLINES[sport as Exclude<SportCategory, 'other'>];
  return { uncertain: false, items: CHECKLIST_TEMPLATE.filter((item) => allowed.has(ITEM_DISCIPLINE[item.id] ?? 'all')) };
}

/** Relevant items the athlete has not checked, in template order. */
export function uncheckedRelevantItems(sport: SportCategory, checkedIds: readonly string[] | undefined): ChecklistTemplateItem[] {
  const checked = new Set(checkedIds ?? []);
  return relevantItemsFor(sport).items.filter((item) => !checked.has(item.id));
}

const isGear = (item: ChecklistTemplateItem) => item.section.startsWith('Packing');

export function uncheckedGear(items: ChecklistTemplateItem[]): ChecklistTemplateItem[] {
  return items.filter(isGear);
}

/**
 * The section order a weekly reminder works through, by how far away the race is: logistics first when the race is distant, gear and
 * nutrition as it approaches. Within a section the template order applies.
 */
export function sectionPriority(daysUntilRace: number): string[] {
  if (daysUntilRace > 28) {
    return ['Registration', 'Travel & Hotel', 'Course Review', 'Nutrition', 'Packing: Swim', 'Packing: Bike', 'Packing: Run'];
  }
  if (daysUntilRace > 14) {
    return ['Travel & Hotel', 'Course Review', 'Registration', 'Nutrition', 'Packing: Swim', 'Packing: Bike', 'Packing: Run'];
  }
  return ['Packing: Swim', 'Packing: Bike', 'Packing: Run', 'Nutrition', 'Course Review', 'Travel & Hotel', 'Registration'];
}

/** The unchecked relevant item a weekly reminder should name, or null if there is none. */
export function pickWeeklyItem(items: ChecklistTemplateItem[], daysUntilRace: number): ChecklistTemplateItem | null {
  for (const section of sectionPriority(daysUntilRace)) {
    const match = items.find((item) => item.section === section);
    if (match) return match;
  }
  return items[0] ?? null;
}
