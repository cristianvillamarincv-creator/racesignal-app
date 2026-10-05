import type { Race } from '@/fixtures/races';
import { CHECKLIST_TEMPLATE } from '@/lib/checklistTemplate';
import { parsePayload, resolveDestination, routeFor, PREP_EXPAND_ONLY } from '@/lib/notifications/payload';

const ME = 'athlete-1';
const race = (overrides: Partial<Race> = {}): Race =>
  ({ id: 'r1', name: 'Test Race', sport: 'triathlon', distanceLabel: '70.3', eventDate: '2027-01-01', location: '', status: 'registered', isManual: true, ...overrides }) as Race;

describe('parsePayload', () => {
  it('accepts the three payload shapes and rejects anything else', () => {
    expect(parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1', i: 'travel-hotel' })).toEqual({ v: 1, a: ME, t: 'prep', r: 'r1', i: 'travel-hotel' });
    expect(parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1' })).toEqual({ v: 1, a: ME, t: 'prep', r: 'r1' });
    expect(parsePayload({ v: 1, a: ME, t: 'prep-list' })).toEqual({ v: 1, a: ME, t: 'prep-list' });
    expect(parsePayload({ v: 1, a: ME, t: 'between', p: 'went-well' })).toEqual({ v: 1, a: ME, t: 'between', p: 'went-well' });
    expect(parsePayload({ v: 1, a: ME, t: 'test' })).toEqual({ v: 1, a: ME, t: 'test' });
    for (const bad of [null, undefined, 'x', {}, { v: 2, a: ME, t: 'prep-list' }, { v: 1, t: 'prep-list' }, { v: 1, a: '', t: 'prep-list' }, { v: 1, a: ME, t: 'prep' }, { v: 1, a: ME, t: 'between' }, { v: 1, a: ME, t: 'other' }]) {
      expect(parsePayload(bad)).toBeNull();
    }
  });
});

describe('resolveDestination: every tap is validated', () => {
  it('ignores a notification that belongs to another account, or when nobody is signed in', () => {
    const payload = parsePayload({ v: 1, a: 'someone-else', t: 'prep', r: 'r1' });
    expect(resolveDestination(payload, ME, [race()])).toEqual({ kind: 'none' });
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1' }), null, [race()])).toEqual({ kind: 'none' });
    expect(resolveDestination(null, ME, [])).toEqual({ kind: 'none' });
  });

  it('opens the race checklist and the item when the item is still unchecked and relevant', () => {
    const d = resolveDestination(parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1', i: 'travel-hotel' }), ME, [race()]);
    expect(d).toEqual({ kind: 'race', raceId: 'r1', itemId: 'travel-hotel' });
    expect(routeFor(d)).toEqual({ pathname: '/race/[id]', params: { id: 'r1', prep: 'travel-hotel' } });
  });

  it('opens the checklist without highlighting when the item has since been checked, is unknown, or is irrelevant to the sport', () => {
    const payload = (i: string) => parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1', i });
    expect(resolveDestination(payload('travel-hotel'), ME, [race({ checklistCompleted: ['travel-hotel'] })])).toEqual({ kind: 'race', raceId: 'r1', itemId: null });
    expect(resolveDestination(payload('nope'), ME, [race()])).toEqual({ kind: 'race', raceId: 'r1', itemId: null });
    expect(resolveDestination(payload('swim-wetsuit'), ME, [race({ sport: 'running' })])).toEqual({ kind: 'race', raceId: 'r1', itemId: null });
    expect(routeFor({ kind: 'race', raceId: 'r1', itemId: null })).toEqual({ pathname: '/race/[id]', params: { id: 'r1', prep: PREP_EXPAND_ONLY } });
  });

  it('falls back to the Races list for a deleted or completed race, and for a combined reminder', () => {
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'prep', r: 'gone', i: 'travel-hotel' }), ME, [race()])).toEqual({ kind: 'races' });
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'prep', r: 'r1' }), ME, [race({ status: 'completed' })])).toEqual({ kind: 'races' });
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'prep-list' }), ME, [])).toEqual({ kind: 'races' });
    expect(routeFor({ kind: 'races' })).toEqual({ pathname: '/' });
  });

  it('routes a between-race prompt to Signal with the starter id, and ignores an unknown prompt', () => {
    const d = resolveDestination(parsePayload({ v: 1, a: ME, t: 'between', p: 'went-well' }), ME, []);
    expect(d).toEqual({ kind: 'signal', promptId: 'went-well' });
    expect(routeFor(d)).toEqual({ pathname: '/signal', params: { starter: 'went-well' } });
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'between', p: 'unknown' }), ME, [])).toEqual({ kind: 'none' });
    expect(routeFor({ kind: 'none' })).toBeNull();
  });

  it('a development test payload resolves to a test destination with no route, and only for the signed-in account', () => {
    expect(resolveDestination(parsePayload({ v: 1, a: ME, t: 'test' }), ME, [])).toEqual({ kind: 'test' });
    expect(resolveDestination(parsePayload({ v: 1, a: 'other', t: 'test' }), ME, [])).toEqual({ kind: 'none' });
    expect(routeFor({ kind: 'test' })).toBeNull();
  });

  it('every template item id is known to the relevance map (so no item can be named without a question)', () => {
    const { ITEM_QUESTIONS } = jest.requireActual('@/lib/notifications/relevance');
    for (const item of CHECKLIST_TEMPLATE) expect(ITEM_QUESTIONS[item.id]).toBeTruthy();
  });
});
