import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { RacePrepChecklist } from '@/components/race/RacePrepChecklist';
import type { Race } from '@/fixtures/races';

/** A race-prep notification opens the checklist expanded and highlights the item it named, without changing the checklist itself. */

const mockSetChecklist = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/racesContext', () => ({ useAthleteRaces: () => ({ setChecklistCompleted: mockSetChecklist }) }));

const race = (overrides: Partial<Race> = {}): Race =>
  ({ id: 'r1', name: 'Test Tri', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2027-01-01', location: '', status: 'registered', isManual: true, ...overrides }) as Race;

beforeEach(() => {
  mockSetChecklist.mockClear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('RacePrepChecklist from a notification', () => {
  it('is collapsed by default, and expands when opened from a notification even with no item', async () => {
    const closed = await render(<RacePrepChecklist race={race()} />);
    expect(closed.queryByLabelText('Hotel booked')).toBeNull();
    const opened = await render(<RacePrepChecklist race={race()} initialExpanded />);
    expect(opened.getByLabelText('Hotel booked')).toBeTruthy();
    expect(opened.queryByTestId('highlighted-checklist-item')).toBeNull();
  });

  it('expands and highlights exactly the named unchecked item, and reports its row so the screen can scroll to it', async () => {
    const onRow = jest.fn();
    const ui = await render(<RacePrepChecklist race={race()} highlightItemId="travel-transport" onHighlightedRow={onRow} />);
    expect(ui.getByLabelText('Transportation to venue arranged')).toBeTruthy();
    const highlighted = ui.getAllByTestId('highlighted-checklist-item');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.props.accessibilityLabel).toBe('Transportation to venue arranged');
    expect(onRow).toHaveBeenCalledTimes(1);
  });

  it('the highlight fades by itself, and goes as soon as that item is toggled; toggling still saves like before', async () => {
    const ui = await render(<RacePrepChecklist race={race()} highlightItemId="travel-transport" />);
    expect(ui.queryByTestId('highlighted-checklist-item')).toBeTruthy();
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Transportation to venue arranged'));
    });
    expect(ui.queryByTestId('highlighted-checklist-item')).toBeNull();
    expect(mockSetChecklist).toHaveBeenCalledWith('r1', ['travel-transport']);

    const faded = await render(<RacePrepChecklist race={race()} highlightItemId="travel-hotel" />);
    expect(faded.queryByTestId('highlighted-checklist-item')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(6500);
    });
    expect(faded.queryByTestId('highlighted-checklist-item')).toBeNull();
  });
});
