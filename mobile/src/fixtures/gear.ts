/**
 * Small mock gear list shown in the AI tab's athlete-context preview. Data only — no lifecycle
 * tracking, no real Gear Locker, per the product direction for this milestone.
 */
export interface GearItem {
  id: string;
  category: 'shoes' | 'bike' | 'wetsuit' | 'power_meter';
  name: string;
  detail: string;
}

export const gearItemsPopulated: GearItem[] = [
  { id: 'gear-shoes', category: 'shoes', name: 'Nike Vaporfly 3', detail: '412 km logged' },
  { id: 'gear-bike', category: 'bike', name: 'Cervélo P-Series', detail: 'Triathlon bike' },
  { id: 'gear-wetsuit', category: 'wetsuit', name: 'Orca Alpha', detail: 'Full sleeve' },
  { id: 'gear-power-meter', category: 'power_meter', name: 'Garmin Rally', detail: 'Power meter pedals' },
];
