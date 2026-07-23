export type SignalCard =
  | {
      id: string;
      kind: 'response';
      responderName: string;
      sportLabel: string;
      title: string;
      timeLabel: string;
      intensityLabel: string;
    }
  | {
      id: string;
      kind: 'raceDay';
      friendName: string;
      raceName: string;
      timeLabel: string;
      hasTracker: boolean;
    }
  | {
      id: string;
      kind: 'session';
      creatorName: string;
      sportLabel: string;
      title: string;
      timeLabel: string;
      groupLabel: 'Today' | 'Tomorrow' | 'This weekend' | 'Later';
    }
  | {
      id: string;
      kind: 'result';
      friendName: string;
      raceName: string;
      finishTimeLabel: string;
      timeLabel: string;
    };

// Ordering follows the PRD: responses to my Signals, live race-day moments, today, tomorrow /
// weekend, later, then recent confirmed results (last 48h). Fixed order here since this is
// static demo data, not a live feed that needs re-sorting.
export const signalsPopulated: SignalCard[] = [
  {
    id: 'response-james',
    kind: 'response',
    responderName: 'James',
    sportLabel: 'Cycling',
    title: '90 km Zone 2 ride',
    timeLabel: 'Today, 7:00 AM',
    intensityLabel: 'Zone 2',
  },
  {
    id: 'raceday-alanna',
    kind: 'raceDay',
    friendName: 'Alanna',
    raceName: 'Ottawa Race Weekend',
    timeLabel: 'Starting at 8:00 AM',
    hasTracker: true,
  },
  {
    id: 'session-sam-swim',
    kind: 'session',
    creatorName: 'Sam',
    sportLabel: 'Swim',
    title: 'Easy recovery swim',
    timeLabel: 'Today, 6:00 PM',
    groupLabel: 'Today',
  },
  {
    id: 'session-mike-ride',
    kind: 'session',
    creatorName: 'Mike',
    sportLabel: 'Cycling',
    title: '100 km Saturday ride',
    timeLabel: 'Saturday, 8:00 AM',
    groupLabel: 'This weekend',
  },
  {
    id: 'session-james-intervals',
    kind: 'session',
    creatorName: 'James',
    sportLabel: 'Running',
    title: 'Track intervals — 8x400m',
    timeLabel: 'Next Tuesday, 6:30 PM',
    groupLabel: 'Later',
  },
  {
    id: 'result-alanna',
    kind: 'result',
    friendName: 'Alanna',
    raceName: 'Ottawa Race Weekend',
    finishTimeLabel: '1:52:03',
    timeLabel: '2 hours ago',
  },
];

export const signalsEmpty: SignalCard[] = [];
