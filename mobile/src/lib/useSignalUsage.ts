import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { fetchSignalUsage, type SignalUsagePayload } from '@/lib/signal';

/**
 * The athlete's Signal allowance as the server reports it, shared by the Signal tab and the conversation. The value is only ever a
 * server-confirmed count (from the read-only usage lookup or from a reply's own count), never computed or guessed here: it is null
 * until one succeeds, and again whenever a refresh fails, so unknown usage is never treated as zero or as Premium.
 *
 * Refreshes when the screen first focuses and each time it regains focus (including the app returning to the foreground while it is
 * showing). Every refresh and every reply takes a new sequence number and a response applies only if it is still the newest, so a
 * slow lookup can never overwrite a fresher count. `refresh` resolves to that lookup's own result (null on failure) so a caller that
 * must act on a fresh server answer, such as returning from the paywall, can await it.
 */
export function useSignalUsage({ enabled }: { enabled: boolean }) {
  const [usage, setUsage] = useState<SignalUsagePayload | null>(null);
  const sequenceRef = useRef(0);

  /** `keepOnFailure`: right after a reply whose own count was just applied, a failed follow-up lookup leaves that count in place. */
  const refresh = useCallback(
    async (keepOnFailure = false): Promise<SignalUsagePayload | null> => {
      if (!enabled) return null;
      sequenceRef.current += 1;
      const sequence = sequenceRef.current;
      const result = await fetchSignalUsage();
      if (sequence === sequenceRef.current) {
        if (result) setUsage(result);
        else if (!keepOnFailure) setUsage(null);
      }
      return result;
    },
    [enabled],
  );

  /** Applies the count a successful reply returned; it supersedes any lookup still in flight. A Premium reply does not carry the
   *  reset instant, so the previous one is kept while still Premium and the follow-up refresh fills it in. */
  const applyReply = useCallback((reply: { remaining: number; cap: number; isPremium: boolean }) => {
    sequenceRef.current += 1;
    setUsage((previous) => ({ ...reply, resetsAt: reply.isPremium && previous?.isPremium ? previous.resetsAt : null }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => subscription.remove();
    }, [refresh]),
  );

  return { usage, refresh, applyReply };
}
