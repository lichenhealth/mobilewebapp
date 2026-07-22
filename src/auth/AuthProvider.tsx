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

  // Presence heartbeat: stamp last_seen_at on arrival and every 10 minutes
  // while the app is open. Soft signal only — it feeds the Home greeting's
  // aggregate "N in your network are awake" count (individual timestamps
  // aren't readable by anyone; no column SELECT grant).
  useEffect(() => {
    if (!userId) return;
    const beat = () => {
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
    const t = window.setInterval(beat, 10 * 60 * 1000);
    return () => window.clearInterval(t);
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
