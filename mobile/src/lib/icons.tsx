import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

/**
 * Vector icons (MaterialCommunityIcons, from the same @expo/vector-icons set already used for
 * tab bar icons) — not emoji. Emoji reads as generic "fitness app" iconography; a consistent
 * vector set fits the dark + mint premium-utility identity instead.
 */
export type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export type Discipline = 'swim' | 'bike' | 'run';

export const DISCIPLINE_ICON: Record<Discipline, IconName> = {
  swim: 'swim',
  bike: 'bike',
  run: 'run',
};

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  swim: 'Swim',
  bike: 'Bike',
  run: 'Run',
};

interface AppIconProps {
  name: IconName;
  size?: number;
  color: ColorValue;
}

export function AppIcon({ name, size = 16, color }: AppIconProps) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

export function DisciplineIcon({
  discipline,
  size = 18,
  color,
}: {
  discipline: Discipline;
  size?: number;
  color: ColorValue;
}) {
  return <AppIcon name={DISCIPLINE_ICON[discipline]} size={size} color={color} />;
}
