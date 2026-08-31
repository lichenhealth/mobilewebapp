import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { listMyBeings } from '../lib/stewardshipApi';

// "Acting as" — Facebook-style identity switching. You can act as yourself or
// as any space (organization / community / group / place) you administer.
// While acting as an entity, creation surfaces default + attribute to it
// (events → the entity's calendar; posts pick this up when they land).
// Client-side state; persisted per-user in localStorage. No schema involved.

export type SpaceKind = 'organization' | 'community' | 'group' | 'place';
export interface ActingSpace { id: string; name: string; kind: SpaceKind; avatarUrl?: string | null }
/** A being you steward — a horse, a cactus, a river (founder 2026-08-05).
 *  It has a profile but no login, so you speak and act for it. */
export interface ActingBeing { id: string; name: string; kind: string; avatarUrl?: string | null }
export type Actor =
  | { type: 'self' }
  | ({ type: 'space' } & ActingSpace)
  | ({ type: 'being' } & ActingBeing);

export interface SelfIdentity { name: string; avatarUrl: string | null }

interface ActingCtx {
  actor: Actor;
  setActor: (a: Actor) => void;
  options: ActingSpace[];          // spaces I can act as (admin/super_admin)
  beings: ActingBeing[];           // beings I steward
  self: SelfIdentity;              // my own display identity (for the chip)
  refreshSelf: () => void;         // call after changing name/avatar
  /** False until the persisted hat has been restored (or ruled out). The
   *  boot briefly assumed "self" while the saved choice loaded, so the chip
   *  and /profile's acting-as redirect flashed the wrong identity (founder
   *  2026-08-22) — surfaces that BRANCH on the actor should wait for this. */
  ready: boolean;
}

const Ctx = createContext<ActingCtx>({
  actor: { type: 'self' }, setActor: () => {}, options: [], beings: [],
  self: { name: '', avatarUrl: null }, refreshSelf: () => {}, ready: true,
});
export const useActing = () => useContext(Ctx);

const storageKey = (uid: string) => `lichen.actingAs.${uid}`;

export function ActingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [options, setOptions] = useState<ActingSpace[]>([]);
  const [beings, setBeings] = useState<ActingBeing[]>([]);
  const [actor, setActorState] = useState<Actor>({ type: 'self' });
  const [ready, setReady] = useState(false);
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
    if (!user) { setOptions([]); setBeings([]); setActorState({ type: 'self' }); setReady(true); return; }
    // A saved hat means the boot's default "self" may be wrong — hold ready
    // until the restore below has run. No saved hat = self is already true.
    try { setReady(!localStorage.getItem(storageKey(user.id))); }
    catch { setReady(true); }
    let live = true;
    (async () => {
      // A TRANSIENT FAILURE MUST NEVER COST ANYONE THEIR HAT (founder
      // 2026-08-25: acting as Countryman, opening its chat, the chip
      // "slipped back to my profile"). This effect re-runs on auth
      // refreshes; the old code treated a failed space_members read as "you
      // admin nothing" and silently dropped a saved hat to self. Now an
      // errored read RETRIES with backoff, and the restore-or-drop decision
      // is only ever made on a read that actually succeeded.
      let rows: { spaces: { id: string; name: string; kind: SpaceKind; avatar_url: string | null } | null }[] | null = null;
      for (let attempt = 0; live && rows === null; attempt++) {
        const { data, error } = await supabase
          .from('space_members')
          .select('role, spaces(id, name, kind, avatar_url)')
          .eq('profile_id', user.id)
          .in('role', ['admin', 'super_admin']);
        if (!live) return;
        if (!error) { rows = (data as unknown as typeof rows) ?? []; break; }
        if (attempt >= 5) return; // hold ready=false — a blank chip is honest, a wrong hat is not
        await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** attempt)));
      }
      if (!live || rows === null) return;
      // The entity's real face rides along so the acting chip can wear it —
      // a monogram alone made "whose hat am I wearing" too easy to misread
      // (founder 2026-08-22).
      const opts = rows
        .map((r) => r.spaces).filter((s): s is NonNullable<typeof s> => !!s)
        .map((s): ActingSpace => ({ id: s.id, name: s.name, kind: s.kind, avatarUrl: s.avatar_url }));
      setOptions(opts);
      // Beings I steward join the switcher (empty pre-migration). A failed
      // beings read must not kill the whole restore either.
      let bs: ActingBeing[] = [];
      try {
        const mine = await listMyBeings(user.id);
        bs = mine.map((b) => ({
          id: b.id, name: b.full_name ?? 'A being', kind: b.kind, avatarUrl: b.avatar_url ?? null,
        }));
      } catch { /* beings unavailable — the switcher just omits them this boot */ }
      if (!live) return;
      setBeings(bs);
      // Restore a persisted choice — only if it's still ours to act as.
      try {
        const saved = localStorage.getItem(storageKey(user.id));
        if (saved) {
          const space = opts.find((o) => o.id === saved);
          const being = bs.find((b) => b.id === saved);
          if (space) setActorState({ type: 'space', ...space });
          else if (being) setActorState({ type: 'being', ...being });
          else {
            // Genuinely no longer ours (read SUCCEEDED and it's absent) —
            // drop honestly and stop re-litigating it every boot.
            setActorState({ type: 'self' });
            localStorage.removeItem(storageKey(user.id));
          }
        }
      } catch { /* storage unavailable — stay self */ }
      setReady(true);
    })();
    return () => { live = false; };
  }, [user]);

  const setActor = (a: Actor) => {
    setActorState(a);
    if (!user) return;
    try {
      if (a.type === 'space' || a.type === 'being') localStorage.setItem(storageKey(user.id), a.id);
      else localStorage.removeItem(storageKey(user.id));
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => ({ actor, setActor, options, beings, self, refreshSelf, ready }), [actor, options, beings, self, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
