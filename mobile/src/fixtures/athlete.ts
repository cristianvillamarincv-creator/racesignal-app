export interface Athlete {
  displayName: string;
  avatarInitials: string;
  primarySport: 'triathlon' | 'cycling' | 'running' | 'swimming';
  unitSystem: 'metric' | 'imperial';
  homeCity: string;
}

export const athlete: Athlete = {
  displayName: 'Cristian',
  avatarInitials: 'C',
  primarySport: 'triathlon',
  unitSystem: 'metric',
  homeCity: 'Toronto',
};
