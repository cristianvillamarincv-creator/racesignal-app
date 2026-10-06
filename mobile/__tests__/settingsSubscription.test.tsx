import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import SubscriptionScreen from '@/app/settings/subscription';

/**
 * Settings → Subscription (its own detail screen). Free: the plan, "3 free Signal asks total. They don't renew.", and "Explore RaceSignal Premium" with what
 * Premium includes (it never says "3 included" as if that meant 3 remain). Premium: the ACTIVE plan and its monthly asks. Restore
 * Purchases stays in both. Returning from the paywall re-reads entitlement. No live balance is shown here.
 */

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockIsPremium = false;
const mockRefreshPremium = jest.fn();
const mockRestore = jest.fn();
jest.mock('@/lib/premium', () => ({ usePremium: () => ({ isPremium: mockIsPremium, refresh: mockRefreshPremium, restorePurchases: () => mockRestore() }) }));
const mockPaywall = jest.fn();
jest.mock('@/lib/purchases', () => ({ presentPremiumPaywall: () => mockPaywall() }));

beforeEach(() => {
  mockIsPremium = false;
  mockPaywall.mockReset().mockResolvedValue('cancelled');
  mockRefreshPremium.mockReset().mockResolvedValue(undefined);
  mockRestore.mockReset().mockResolvedValue(true);
});

describe('Settings subscription section', () => {
  it('free: states the 3 asks are a non-renewing total, offers Explore RaceSignal Premium with its 40 monthly asks, and keeps Restore', async () => {
    const ui = await render(<SubscriptionScreen />);
    await act(async () => {});
    expect(ui.getByText('RaceSignal Free')).toBeTruthy();
    expect(ui.getByText('3 free Signal asks total. They don’t renew.')).toBeTruthy();
    expect(ui.getByText('Explore RaceSignal Premium')).toBeTruthy();
    expect(ui.getByText('40 Signal asks each month.')).toBeTruthy();
    expect(ui.getByLabelText('Restore Purchases')).toBeTruthy();
    expect(ui.queryByText(/included/i)).toBeNull();
    expect(ui.queryByText(/Upgrade to RaceSignal Premium/)).toBeNull();
    await act(async () => ui.unmount());
  });

  it('Premium: the ACTIVE plan with its monthly asks, no upgrade row, and Restore still available', async () => {
    mockIsPremium = true;
    const ui = await render(<SubscriptionScreen />);
    await act(async () => {});
    expect(ui.getByText('RaceSignal Premium')).toBeTruthy();
    expect(ui.getByText('ACTIVE')).toBeTruthy();
    expect(ui.getByText('40 Signal asks each month.')).toBeTruthy();
    expect(ui.queryByText('Explore RaceSignal Premium')).toBeNull();
    expect(ui.queryByText('RaceSignal Free')).toBeNull();
    expect(ui.getByLabelText('Restore Purchases')).toBeTruthy();
    await act(async () => ui.unmount());
  });

  it('Explore RaceSignal Premium opens the existing paywall and re-reads entitlement when it returns', async () => {
    const ui = await render(<SubscriptionScreen />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Explore RaceSignal Premium, 40 Signal asks each month.'));
    });
    expect(mockPaywall).toHaveBeenCalledTimes(1);
    expect(mockRefreshPremium).toHaveBeenCalledTimes(1);
    await act(async () => ui.unmount());
  });

  it('Restore Purchases reports a restored subscription, or that there was nothing to restore', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ui = await render(<SubscriptionScreen />);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Restore Purchases'));
    });
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenLastCalledWith('Purchases restored', 'Your RaceSignal Premium subscription is active on this device.');
    mockRestore.mockResolvedValue(false);
    await act(async () => {
      fireEvent.press(ui.getByLabelText('Restore Purchases'));
    });
    expect(alertSpy).toHaveBeenLastCalledWith('Nothing to restore', 'No active RaceSignal Premium purchase was found for this account.');
    alertSpy.mockRestore();
    await act(async () => ui.unmount());
  });
});
