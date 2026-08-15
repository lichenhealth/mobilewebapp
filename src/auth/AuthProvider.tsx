import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, storedSession } from '../lib/supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** We hold a session the browser saved, but the client can't currently use
   *  it (a refresh failed — asleep laptop, flapping wifi, a server hiccup).
   *  NOT the same as signed out: the member's identity is intact and we're
   *  retrying. Chrome must not show them the door on this. */
  reconnecting: boolean;
  onboarded: boolean | null;   // null = not yet known
  isAdmin: boolean;
  markOnboarded: () => void;
};

const AuthContext = createContext<AuthState>({
  session: null, user: null, loading: true, reconnecting: false,
  onboarded: null, isAdmin: false, markOnboarded: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // ── SESSIONS THAT SURVIVE A BAD MOMENT ─────────────────────────────────────
  // Diagnosed 2026-08-14 after the founder was repeatedly "signed out" while
  // signed in. The mechanism, reproduced end to end:
  //   • A rejected refresh (server says the token is dead) clears storage —
  //     that IS a real sign-out, and showing the door is right.
  //   • A FAILED refresh (network unreachable) leaves the token intact in
  //     storage, but the client's in-memory session goes null and NEVER comes
  //     back on its own — auto-refresh only ticks for a session it still
  //     holds. The app then rendered the signed-out chrome to someone whose
  //     session was perfectly valid, so they signed in again.
  // The fix is re-hydration: while the browser still holds a session, we are
  // RECONNECTING, not signed out — retry on every natural cue until it takes.
  const [reconnecting, setReconnecting] = useState(false);
  const rehydrating = useRef(false);

  const rehydrate = useCallback(async (): Promise<boolean> => {
    if (rehydrating.current) return false;
    const stored = storedSession();
    if (!stored) { setReconnecting(false); return false; }
    rehydrating.current = true;
    try {
      // setSession (not refreshSession): the client has no session in memory
      // to refresh — it has to adopt the stored one first.
      const { data, error } = await supabase.auth.setSession(stored);
      if (!error && data.session) { setSession(data.session); setReconnecting(false); return true; }
      // A server rejection clears storage; anything left means keep trying.
      setReconnecting(!!storedSession());
      return false;
    } catch {
      setReconnecting(!!storedSession());
      return false;
    } finally { rehydrating.current = false; }
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!live) return;
      if (data.session) { setSession(data.session); setLoading(false); return; }
      // No usable session — but is that "signed out" or "can't reach it"?
      if (storedSession()) { setReconnecting(true); await rehydrate(); }
      if (live) setLoading(false);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Losing the session while the token is still on disk is a gap, not a
      // goodbye. (A real sign-out clears storage, so this stays false then.)
      if (!s) setReconnecting(!!storedSession());
      else setReconnecting(false);
    });
    return () => { live = false; subscription.unsubscribe(); };
  }, [rehydrate]);

  // A WATCHDOG, not a retry queue. Gating this on "we noticed the gap" meant
  // recovery depended on an auth event firing — and a gap can be entered
  // without one. So it watches the only thing that actually matters: no
  // session in hand while the browser still holds one. Cheap when idle (a
  // localStorage read), silent when genuinely signed out.
  useEffect(() => {
    if (session) { setReconnecting(false); return; }
    const attempt = () => {
      if (!storedSession()) { setReconnecting(false); return; }
      setReconnecting(true);
      void rehydrate();
    };
    window.addEventListener('online', attempt);
    document.addEventListener('visibilitychange', attempt);
    const t = window.setInterval(attempt, 8_000);
    attempt();
    return () => {
      window.removeEventListener('online', attempt);
      document.removeEventListener('visibilitychange', attempt);
      window.clearInterval(t);
    };
  }, [session, rehydrate]);

  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) { setOnboarded(null); setIsAdmin(false); return; }
    let active = true;
    supabase.from('profiles').select('onboarded, is_admin').eq('id', userId).single()
      .then(
        ({ data, error }) => {
          if (!active) return;
          if (error) { setOnboarded(false); setIsAdmin(false); return; }
          const row = data as { onboarded: boolean; is_admin: boolean } | null;
          setOnboarded(Boolean(row?.onboarded));
          setIsAdmin(Boolean(row?.is_admin));
        },
        () => { if (active) { setOnboarded(false); setIsAdmin(false); } }
      );
    return () => { active = false; };
  }, [userId]);

  // PRESENCE HEARTBEAT — "here NOW", not "here today" (founder 2026-08-13:
  // present should mean the candle is lit and you're actually online now).
  //
  // It beats every 2 minutes and ONLY while the tab is visible, which is what
  // makes the signal true rather than merely faster: a backgrounded tab or a
  // phone in a pocket stops beating, so it stops claiming you're open to being
  // interrupted. It also beats the instant you come back, so returning to the
  // tab restores presence at once instead of up to two minutes later.
  //
  // The DB window (network_present_* / space_present_*) is 5 minutes — 2.5x this
  // beat, so one missed beat or a slow network doesn't blink anyone out. THE
  // TWO ARE A PAIR: shortening the window below ~2x this interval makes
  // presence strobe for someone sitting right there.
  //
  // Cost: ~30 writes/hour per member who is actually looking, and none while
  // backgrounded (it used to beat regardless). Noise at alpha scale; worth
  // revisiting at a few thousand members.
  //
  // Soft signal only — it feeds an aggregate count. Individual timestamps
  // aren't readable by anyone; there's no column SELECT grant.
  useEffect(() => {
    if (!userId) return;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      // Also stamp the browser's timezone so server-side scheduled reminders
      // (pg_cron → fire-reminders) can fire at the member's true local time.
      let tz: string | undefined;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
      void supabase.from('profiles')
        .update({ last_seen_at: new Date().toISOString(), ...(tz ? { timezone: tz } : {}) })
        .eq('id', userId)
        .then(() => {}, () => {});
    };
    beat();
    const t = window.setInterval(beat, 2 * 60 * 1000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [userId]);

  const markOnboarded = useCallback(() => setOnboarded(true), []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, reconnecting, onboarded, isAdmin, markOnboarded }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
