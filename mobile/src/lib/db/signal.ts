import { supabase } from '@/lib/supabaseClient';

export interface SignalConversationRow {
  id: string;
  athlete_id: string;
  title: string;
  seed_race_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

const CONVERSATION_COLUMNS = 'id, athlete_id, title, seed_race_id, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, conversation_id, role, text, created_at';

/** Created lazily — only after a conversation's first successful exchange (see signal.tsx) — so
 *  an opened-but-abandoned chat never shows up in "Recent Signals". */
export async function createSignalConversation(athleteId: string, title: string, seedRaceId?: string): Promise<SignalConversationRow> {
  const { data, error } = await supabase
    .from('signal_conversations')
    .insert({ athlete_id: athleteId, title, seed_race_id: seedRaceId ?? null })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as SignalConversationRow;
}

/** Persists one full turn (the athlete's message + Signal's reply) in one insert, then bumps the
 *  conversation's `updated_at` so "Recent Signals" sorts by actual activity, not creation time.
 *  Screenshot bytes are never part of `userText`/`assistantText` — only the model's own "From your
 *  uploaded evidence" description (already plain text) is ever persisted here. */
export async function appendSignalTurn(conversationId: string, userText: string, assistantText: string): Promise<void> {
  const { error: insertError } = await supabase.from('signal_messages').insert([
    { conversation_id: conversationId, role: 'user', text: userText },
    { conversation_id: conversationId, role: 'assistant', text: assistantText },
  ]);
  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from('signal_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (updateError) throw updateError;
}

/** Soft-fails to an empty list — the Signal tab's "Recent Signals" section is a secondary
 *  convenience, not core functionality; a read failure here shouldn't break the tab. */
export async function fetchRecentSignalConversations(athleteId: string, limit = 5): Promise<SignalConversationRow[]> {
  const { data, error } = await supabase
    .from('signal_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('athlete_id', athleteId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[db/signal] fetchRecentSignalConversations failed:', error.message);
    return [];
  }
  return (data ?? []) as unknown as SignalConversationRow[];
}

export async function fetchSignalConversationWithMessages(
  conversationId: string,
): Promise<{ conversation: SignalConversationRow; messages: SignalMessageRow[] } | null> {
  const { data: conversation, error: conversationError } = await supabase
    .from('signal_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError || !conversation) return null;

  const { data: messages, error: messagesError } = await supabase
    .from('signal_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (messagesError) return null;

  return {
    conversation: conversation as unknown as SignalConversationRow,
    messages: (messages ?? []) as unknown as SignalMessageRow[],
  };
}
