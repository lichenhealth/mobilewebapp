import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

// "Acting as" — Facebook-style identity switching. You can act as yourself or
// as any space (organization / community / group / place) you administer.
// While acting as an entity, creation surfaces default + attribute to it
// (events → the entity's calendar; posts pick this up when they land).
// Client-side state; persisted per-user in localStorage. No schema involved.

export type SpaceKind = 'organization' | 'community' | 'group' | 'place';
export interface ActingSpace { id: string; name: string; kind: SpaceKind }
export type Actor = { type: 'self' } | ({ type: 'space' } & ActingSpace);

export interface SelfIdentity { name: string; avatarUrl: string | null }

interface ActingCtx {
  actor: Actor;
  setActor: (a: Actor) => void;
  options: ActingSpace[];          // spaces I can act as (admin/super_admin)
  self: SelfIdentity;              // my own display identity (for the chip)
  refreshSelf: () => void;         // call after changing name/avatar
}

const Ctx = createContext<ActingCtx>({
  actor: { type: 'self' }, setActor: () => {}, options: [],
  self: { name: '', avatarUrl: null }, refreshSelf: () => {},
});
export const useActing = () => useContext(Ctx);

const storageKey = (uid: string) => `lichen.actingAs.${uid}`;

export function ActingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [options, setOptions] = useState<ActingSpace[]>([]);
  const [actor, setActorState] = useState<Actor>({ type: 'self' });
  const [self, setSelf] = useState<SelfIdentity>({ name: '', avatarUrl: null });
  const [selfBump, setSelfBump] = useState(0);
  const refreshSelf = () => setSelfBump((n) => n + 1);

  // My own display identity (name + avatar) for the always-on chip.
  useEffect(() => {
    if (!user) { setSelf({ name: '', avatarUrl: null }); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      if (!live) return;
      const p = data as { full_name: string | null; avatar_url: string | null } | null;
      setSelf({ name: p?.full_name || 'Me', avatarUrl: p?.avatar_url ?? null });
    })();
    return () => { live = false; };
  }, [user, selfBump]);

  useEffect(() => {
    if (!user) { setOptions([]); setActorState({ type: 'self' }); return; }
    let live = true;
    (async () => {
      const { data } = await supabase
        .from('space_members')
        .select('role, spaces(id, name, kind)')
        .eq('profile_id', user.id)
        .in('role', ['admin', 'super_admin']);
      if (!live) return;
      const opts = ((data as unknown as { spaces: ActingSpace | null }[] | null) ?? [])
        .map((r) => r.spaces).filter((s): s is ActingSpace => !!s);
      setOptions(opts);
      // Restore a persisted choice — only if it's still a space we administer.
      try {
        const saved = localStorage.getItem(storageKey(user.id));
        if (saved) {
          const hit = opts.find((o) => o.id === saved);
          setActorState(hit ? { type: 'space', ...hit } : { type: 'self' });
        }
      } catch { /* storage unavailable — stay self */ }
    })();
    return () => { live = false; };
  }, [user]);

  const setActor = (a: Actor) => {
    setActorState(a);
    if (!user) return;
    try {
      if (a.type === 'space') localStorage.setItem(storageKey(user.id), a.id);
      else localStorage.removeItem(storageKey(user.id));
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ actor, setActor, options, self, refreshSelf }), [actor, options, self]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
