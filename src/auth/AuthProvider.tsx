import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  onboarded: boolean | null;   // null = not yet known
  isAdmin: boolean;
  markOnboarded: () => void;
};

const AuthContext = createContext<AuthState>({
  session: null, user: null, loading: true, onboarded: null, isAdmin: false, markOnboarded: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

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
  // The DB window (network_awake_* / space_awake_*) is 5 minutes — 2.5x this
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
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, onboarded, isAdmin, markOnboarded }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
