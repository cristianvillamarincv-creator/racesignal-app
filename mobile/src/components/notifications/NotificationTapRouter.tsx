import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useInitialPaywallSettled } from '@/components/InitialPaywallGate';
import { useAuth } from '@/lib/auth';
import { clearLastResponse, useLastTap } from '@/lib/notifications/api';
import { parsePayload, resolveDestination, routeFor } from '@/lib/notifications/payload';
import { useOverlayBlocked } from '@/lib/overlayBlockers';
import { useAthleteRaces } from '@/lib/racesContext';

// Taps already acted on in this process, so a response delivered both at launch and as a live event is handled once.
const handledTaps = new Set<string>();
/** For tests. */
export function resetHandledTaps(): void {
  handledTaps.clear();
}

/**
 * Routes a tap on one of this feature's notifications, once. Cold start (the tap that launched the app) and warm taps arrive the same way
 * (the last notification response) and are cleared after handling. A tap is held until it is safe to act (signed in, races loaded, and no
 * paywall or consent sheet in the way) and is DROPPED if the app is in onboarding, nobody is signed in, or it belongs to another account.
 * Where it goes depends on the data as it is now: a deleted or completed race opens the Races list, a checked-off item opens the checklist
 * without a highlight, and a between-race prompt opens Signal with an editable starter (never sent, never an ask).
 */
export function NotificationTapRouter({ phase }: { phase: 'onboarding' | 'app' }) {
  const tap = useLastTap();
  const { session } = useAuth();
  const races = useAthleteRaces();
  const router = useRouter();
  const blocked = useOverlayBlocked();
  const paywallSettled = useInitialPaywallSettled();
  const athleteId = session?.user.id ?? null;

  useEffect(() => {
    if (!tap) return; // undefined (not answered yet) or null (no tap)
    if (handledTaps.has(tap.key)) {
      clearLastResponse();
      return;
    }
    if (phase !== 'app') {
      // Onboarding or signed out: there is nothing to open, and the tap must not fire later in a different state.
      handledTaps.add(tap.key);
      clearLastResponse();
      return;
    }
    if (!athleteId || races.isLoading || blocked || !paywallSettled) return; // wait until it is safe
    handledTaps.add(tap.key);
    clearLastResponse();
    const destination = resolveDestination(parsePayload(tap.data), athleteId, races.data);
    const route = routeFor(destination);
    if (!route) return;
    if (route.pathname === '/') router.navigate('/');
    else router.push(route as never);
  }, [tap, phase, athleteId, races.isLoading, races.data, blocked, paywallSettled, router]);

  return null;
}
