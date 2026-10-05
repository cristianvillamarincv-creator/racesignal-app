import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appendStarter, clearSignalDraft, loadSignalDraft, planStarter, saveSignalDraft, SIGNAL_DRAFT_KEY_PREFIX } from '@/lib/signalDraft';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('draft storage (per athlete, survives cold starts)', () => {
  it('saves and loads a draft, empty when there is none', async () => {
    expect(await loadSignalDraft('a1')).toBe('');
    await saveSignalDraft('a1', 'Next season I want to');
    expect(await loadSignalDraft('a1')).toBe('Next season I want to');
    expect(await AsyncStorage.getItem(SIGNAL_DRAFT_KEY_PREFIX + 'a1')).toBe('Next season I want to');
  });

  it('keeps each athlete’s draft separate', async () => {
    await saveSignalDraft('a1', 'one');
    await saveSignalDraft('a2', 'two');
    expect(await loadSignalDraft('a1')).toBe('one');
    expect(await loadSignalDraft('a2')).toBe('two');
    await clearSignalDraft('a1');
    expect(await loadSignalDraft('a1')).toBe('');
    expect(await loadSignalDraft('a2')).toBe('two');
  });

  it('an empty or whitespace-only draft clears the slot', async () => {
    await saveSignalDraft('a1', 'text');
    await saveSignalDraft('a1', '   \n ');
    expect(await AsyncStorage.getItem(SIGNAL_DRAFT_KEY_PREFIX + 'a1')).toBeNull();
  });
});

describe('what a starter does to a draft', () => {
  it('fills an empty composer with the starter', () => {
    expect(planStarter('', 'Next season, I want to focus on…')).toEqual({ action: 'use', text: 'Next season, I want to focus on…' });
    expect(planStarter('  \n', 'x')).toEqual({ action: 'use', text: 'x' });
  });

  it('never overwrites an existing draft: it is kept and the starter is only offered', () => {
    expect(planStarter('My own words', 'Starter')).toEqual({ action: 'offer', starter: 'Starter' });
  });

  it('accepting an offered starter adds it after the draft, removing nothing the athlete wrote', () => {
    expect(appendStarter('My own words', 'Starter')).toBe('My own words\n\nStarter');
    expect(appendStarter('My own words  \n\n', 'Starter')).toBe('My own words\n\nStarter');
    expect(appendStarter('', 'Starter')).toBe('Starter');
  });
});
