import { supabase } from './supabase';

/** Which teaching prompts this member has already met (founder 2026-08-07:
 *  "getting that iPhone has nothing to do with me changing my mind about the
 *  settings of an app on it, so it shouldn't ask me again").
 *
 *  Kept against the MEMBER, not the browser. Loaded once per sitting and held
 *  in module scope so a bubble can decide synchronously while rendering.
 *
 *  If the table isn't there yet the whole thing falls back to localStorage —
 *  the old behaviour, which is wrong across devices but never blocks anyone. */

const today = () => new Date().toISOString().slice(0, 10);
const localKey = (topic: string) => 'consent-seen-' + topic;

interface PromptSeen { at: string; times: number }

let cache: Map<string, PromptSeen> | null = null;
let loading: Promise<void> | null = null;
let dbOk = true;

export function loadPrompts(me: string): Promise<void> {
  if (cache) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await supabase
      .from('member_prompts').select('topic, seen_at, times_seen').eq('profile_id', me);
    if (error) { dbOk = false; cache = new Map(); return; }   // pre-migration
    cache = new Map((data ?? []).map((r) => {
      const row = r as { topic: string; seen_at: string; times_seen?: number };
      return [row.topic, { at: row.seen_at, times: row.times_seen ?? 1 }];
    }));
  })();
  return loading;
}

/** Has this member ever been shown it? */
export function promptSeen(topic: string): boolean {
  if (!dbOk) return !!localStorage.getItem(localKey(topic));
  return !!cache?.has(topic);
}

/** Shown already TODAY? (a teaching prompt asks once a day, not once ever.) */
export function promptSeenToday(topic: string): boolean {
  if (!dbOk) return localStorage.getItem(localKey(topic)) === today();
  const at = cache?.get(topic)?.at;
  return !!at && at.slice(0, 10) === today();
}

/** How many times this member has met it — so a prompt can teach for the
 *  first few visits and then fall silent, rather than asking forever (which
 *  is the prompt-you-learn-to-dismiss-without-reading problem). */
export function promptTimesSeen(topic: string): number {
  if (!dbOk) return Number(localStorage.getItem(localKey(topic) + '-n') ?? 0);
  return cache?.get(topic)?.times ?? 0;
}

export async function markPrompt(me: string, topic: string): Promise<void> {
  const now = new Date().toISOString();
  const times = (cache?.get(topic)?.times ?? 0) + 1;
  cache?.set(topic, { at: now, times });
  if (!dbOk) {
    localStorage.setItem(localKey(topic), today());
    localStorage.setItem(localKey(topic) + '-n', String(times));
    return;
  }
  const { error } = await supabase.from('member_prompts')
    .upsert({ profile_id: me, topic, seen_at: now, times_seen: times },
      { onConflict: 'profile_id,topic' });
  if (error) {
    dbOk = false;
    localStorage.setItem(localKey(topic), today());
    localStorage.setItem(localKey(topic) + '-n', String(times));
  }
}

/** Signing out shouldn't leave the next member reading someone else's history. */
export function clearPromptCache(): void { cache = null; loading = null; }
