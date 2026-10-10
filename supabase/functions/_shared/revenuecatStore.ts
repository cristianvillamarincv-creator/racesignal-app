import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import type { DeletionPatch, DeletionRow, DeletionStore } from './revenuecatCleanup.ts';

const TABLE = 'revenuecat_deletion_requests';

/** The `revenuecat_deletion_requests` table (migration 0012) behind the DeletionStore interface. Needs a service-role client. */
export function createDeletionStore(client: SupabaseClient): DeletionStore {
  return {
    async upsertQueued(userId) {
      // A repeat request for the same id restarts the record rather than failing on the primary key.
      const { error } = await client
        .from(TABLE)
        .upsert({ app_user_id: userId, status: 'queued', attempts: 0, last_attempt_at: null, verified_at: null, last_error: null }, { onConflict: 'app_user_id' });
      if (error) throw new Error('upsert failed');
    },
    async update(userId, patch: DeletionPatch) {
      const { error } = await client.from(TABLE).update(patch).eq('app_user_id', userId);
      if (error) throw new Error('update failed');
    },
    async remove(userId) {
      const { error } = await client.from(TABLE).delete().eq('app_user_id', userId);
      if (error) throw new Error('delete failed');
    },
    async listOpen(limit) {
      const { data, error } = await client
        .from(TABLE)
        .select('app_user_id,status,attempts,first_requested_at,last_attempt_at,verified_at,last_error')
        .neq('status', 'verified')
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw new Error('list failed');
      return (data ?? []) as DeletionRow[];
    },
    async listVerifiedSince(isoTime, limit) {
      const { data, error } = await client
        .from(TABLE)
        .select('app_user_id,status,attempts,first_requested_at,last_attempt_at,verified_at,last_error')
        .eq('status', 'verified')
        .gte('verified_at', isoTime)
        .limit(limit);
      if (error) throw new Error('list failed');
      return (data ?? []) as DeletionRow[];
    },
    async countNeedingAttention(olderThanIso, maxAttempts) {
      const { count, error } = await client
        .from(TABLE)
        .select('app_user_id', { count: 'exact', head: true })
        .neq('status', 'verified')
        .or(`attempts.gte.${maxAttempts},first_requested_at.lt.${olderThanIso}`);
      if (error) throw new Error('count failed');
      return count ?? 0;
    },
    async purgeVerifiedBefore(isoTime) {
      const { data, error } = await client.from(TABLE).delete().eq('status', 'verified').lt('verified_at', isoTime).select('app_user_id');
      if (error) throw new Error('purge failed');
      return data?.length ?? 0;
    },
  };
}
