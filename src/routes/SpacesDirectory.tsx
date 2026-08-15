import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { listSpacesByKind, createSpaceWithLocation, holdsDuty, type SpaceDirectoryRow, type SpaceKind, type SpaceRole } from '../lib/spacesApi';
import AssistantDoor from '../components/AssistantDoor';
import { ScrollHintRow } from '../components/ScrollHintRow';
import { loadMyWeb } from '../lib/myceliumApi';
import { loadTrustWeb, loadTrustEdgesFor, trustPathTo, type TrustWeb } from '../lib/trustPath';
import './SpacesDirectory.css';

/** The real Communities / Groups / Organizations / Places sections: every
 *  space of the kind, searchable, with membership state at a glance. Click
 *  through to the space profile to request to join. */

const KIND_COPY: Record<SpaceKind, { title: string; lead: string; empty: string }> = {
  community: {
    title: 'Communities',
    lead: 'Circles of practice and belonging.',
    empty: 'No communities yet — create the first from your Profile page.',
  },
  group: {
    title: 'Groups',
    lead: 'Smaller circles — standalone, or nested in a community.',
    empty: 'No groups yet — start the first one right here.',
  },
  organization: {
    title: 'Organizations',
    lead: 'The organizations doing the work.',
    empty: 'No organizations yet — create the first from your Profile page.',
  },
  place: {
    title: 'Places',
    lead: 'Physical spots on the shared map.',
    empty: 'No places yet — add one from Maps with the + button.',
  },
};

export default function SpacesDirectory({ kind }: { kind: SpaceKind }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const copy = KIND_COPY[kind];
  const kindWord = kind === 'organization' ? 'organization' : kind;
  // Creation lives here only for groups; the other kinds are created from
  // Profile (organization/community) or Maps (place), so no empty door.
  const canCreate = kind === 'group' && !!user;
  const assistantSection = kind === 'community' ? 'communities'
    : kind === 'group' ? 'groups'
    : kind === 'organization' ? 'organizations' : 'places';

  const [rows, setRows] = useState<SpaceDirectoryRow[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  // Direction matters (founder 2026-07-24, 'what does Pending specify?'):
  // asked = my join request awaits their admins; invited = a real invite
  // awaits ME. Bare member suggestions show NOTHING (PR #58 doctrine).
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState('');
  // Standalone group creation (founder, 2026-07-17): groups don't NEED a
  // community — nesting stays available later via the Part-of picker.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  /** YOUR X / ALL X (founder 2026-08-15): the section had no "all of them"
   *  view, so the assistant had no subject — it read as an assistant for
   *  every group at once while you were looking at one. Two toggles give
   *  each scope a home, and the brain follows the toggle: All flags what's
   *  been added and what might fit you; Yours summarizes activity across
   *  the ones you're in and how the ones you steward are doing. */
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [searchOpen, setSearchOpen] = useState(false);
  // The relationship lenses, in Marketplace's grammar: text + check when on.
  const [lenses, setLenses] = useState<Set<'web' | 'rec-mine' | 'rec-second'>>(new Set());
  const toggleLens = (v: 'web' | 'rec-mine' | 'rec-second') => setLenses((cur) => {
    const next = new Set(cur);
    if (next.has(v)) next.delete(v); else next.add(v);
    return next;
  });
  const [web, setWeb] = useState<Set<string>>(new Set());
  const [recDegree, setRecDegree] = useState<Map<string, 'mine' | 'second'>>(new Map());
  // The search says WHICH pile it's about (founder 2026-08-15) — the toggle
  // already scopes the results, so the field should admit it rather than
  // leaving you to guess whether you're searching yours or all of them.
  const searchWhat = `${scope === 'mine' ? 'your' : 'all'} ${copy.title.toLowerCase()}`;

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const [list, memRes, reqRes] = await Promise.all([
        listSpacesByKind(kind),
        me ? supabase.from('space_members').select('space_id').eq('profile_id', me)
          : Promise.resolve({ data: [] }),
        me ? supabase.from('space_membership_requests').select('space_id, initiated_by').eq('profile_id', me)
          : Promise.resolve({ data: [] }),
      ]);
      const reqs = ((reqRes.data as { space_id: string; initiated_by: string }[] | null) ?? []);
      const others = reqs.filter((r) => r.initiated_by !== me);
      // A row someone ELSE opened is an invite only if they hold the members
      // duty there; otherwise it's a suggestion — invisible to me.
      let invitedIds: string[] = [];
      if (others.length) {
        const { data: inits } = await supabase
          .from('space_members').select('space_id, profile_id, role, duties')
          .in('space_id', others.map((r) => r.space_id))
          .in('profile_id', others.map((r) => r.initiated_by));
        const byPair = new Map(
          ((inits as { space_id: string; profile_id: string; role: SpaceRole; duties: string[] | null }[] | null) ?? [])
            .map((i) => [`${i.space_id}:${i.profile_id}`, i]));
        invitedIds = others
          .filter((r) => {
            const i = byPair.get(`${r.space_id}:${r.initiated_by}`);
            return !!i && holdsDuty(i.role, i.duties ?? null, 'members');
          })
          .map((r) => r.space_id);
      }
      if (!live) return;
      setRows(list);
      setMine(new Set(((memRes.data as { space_id: string }[] | null) ?? []).map((r) => r.space_id)));
      setAsked(new Set(reqs.filter((r) => r.initiated_by === me).map((r) => r.space_id)));
      setInvited(new Set(invitedIds));
      setReady(true);
    })();
    return () => { live = false; };
  }, [kind, me]);

  // WHOSE RECOMMENDATION, AND HOW FAR AWAY. Always "what my web endorses",
  // never a global count: 1st = someone I trust recommended it, 2nd =
  // someone trusted by someone I trust did. Other people's trust edges are
  // read only through `trust_edges_for_targets`, scoped to the recommenders
  // already in view — never a whole-graph read.
  useEffect(() => {
    if (!me || rows.length === 0) { setWeb(new Set()); setRecDegree(new Map()); return; }
    let live = true;
    void (async () => {
      const [{ web: myWeb }, tw] = await Promise.all([loadMyWeb(), loadTrustWeb(me)]);
      if (!live) return;
      setWeb(myWeb);
      const { data } = await supabase.from('recommendations')
        .select('recommender_id, target_id')
        .eq('target_type', 'space')
        .in('target_id', rows.map((r) => r.id));
      const recs = ((data as { recommender_id: string; target_id: string }[] | null) ?? [])
        .filter((r) => r.recommender_id !== me);
      if (!recs.length) { if (live) setRecDegree(new Map()); return; }
      const who = [...new Set(recs.map((r) => r.recommender_id))];
      const extra = await loadTrustEdgesFor(who.map((id) => ({ type: 'profile' as const, id })));
      if (!live) return;
      const full: TrustWeb = { ...tw, edges: [...tw.edges, ...extra] };
      const degOf = new Map<string, 'mine' | 'second'>();
      for (const id of who) {
        const hit = trustPathTo(full, 'profile', id);
        if (hit) degOf.set(id, hit.degree);
      }
      const best = new Map<string, 'mine' | 'second'>();
      for (const r of recs) {
        const d = degOf.get(r.recommender_id);
        if (!d) continue;
        if (d === 'mine' || !best.has(r.target_id)) best.set(r.target_id, d);
      }
      setRecDegree(best);
    })();
    return () => { live = false; };
  }, [me, rows]);

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    let out = rows;
    // Yours = the ones you're actually in; All = every one of the kind.
    if (scope === 'mine') out = out.filter((r) => mine.has(r.id));
    if (lenses.size > 0) {
      out = out.filter((r) => (
        (lenses.has('web') && web.has('space:' + r.id))
        || (lenses.has('rec-mine') && recDegree.get(r.id) === 'mine')
        || (lenses.has('rec-second') && recDegree.get(r.id) === 'second')
      ));
    }
    if (!n) return out;
    return out.filter((r) =>
      r.name.toLowerCase().includes(n)
      || (r.description ?? '').toLowerCase().includes(n)
      || (r.parent?.name ?? '').toLowerCase().includes(n));
  }, [rows, q, scope, mine, lenses, web, recDegree]);

  return (
    <div className="sdir">
      <header className="sdir__head">
        <p className="eyebrow">{copy.title}</p>
        <h1 className="sdir__title display-italic">{copy.lead}</h1>
      </header>

      {/* DOORS LEFT, LENSES RIGHT — the platform's one toolbar grammar
          (founder 2026-08-15). The big search field is gone; search is a
          circle that opens a field, like everywhere else. */}
      <ScrollHintRow className="sdir__bar h-scroll" role="toolbar" ariaLabel={copy.title} fade>
        <button className={'sdir__door' + (searchOpen ? ' is-on' : '')}
          onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setQ(''); }}
          aria-label={`Search ${searchWhat}`} aria-expanded={searchOpen}>
          <Icon name="search" size={14} />
        </button>
        {canCreate && (
          <button className="sdir__door" onClick={() => setCreating(true)}
            aria-label={`New ${kindWord}`} title={`New ${kindWord}`}>
            <Icon name="plus" size={14} />
          </button>
        )}
        {me && (
          <AssistantDoor section={assistantSection} size={36} scope={`mine=${scope === 'mine' ? '1' : '0'}`}
            label={scope === 'mine'
              ? `What's happening across your ${copy.title.toLowerCase()}`
              : `What's new across all ${copy.title.toLowerCase()}, and what might fit you`} />
        )}
        {me && <span className="sdir__bar-divider" aria-hidden />}
        {me && ([
          ['web', 'My-celium', 'In your web'],
          ['rec-mine', 'Recommended (1st)', 'Recommended by someone you trust'],
          ['rec-second', 'Recommended (2nd)', 'Recommended by someone trusted by someone you trust'],
        ] as const).map(([v, l, title]) => {
          const on = lenses.has(v);
          return (
            <button key={v} className={'sdir__lens' + (on ? ' is-on' : '')}
              onClick={() => toggleLens(v)} title={title}>{l}{on ? ' ✓' : ''}</button>
          );
        })}
      </ScrollHintRow>

      {searchOpen && (
        <div className="sdir__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${searchWhat}…`}
          />
          {q && (
            <button className="sdir__clear" onClick={() => setQ('')} aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Icons above, toggles below — the platform rule (founder 2026-08-14). */}
      {me && (
        <div className="sdir__scope" role="tablist">
          <button className={'sdir__scopetab' + (scope === 'mine' ? ' is-on' : '')}
            role="tab" aria-selected={scope === 'mine'} onClick={() => setScope('mine')}>
            Your {copy.title}
          </button>
          <button className={'sdir__scopetab' + (scope === 'all' ? ' is-on' : '')}
            role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')}>
            All {copy.title}
          </button>
        </div>
      )}

      {canCreate && creating && (
        <div className="sdir__create">
          {(
            <div className="sdir__create-form">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name your group"
                onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              />
              <button
                className="sdir__create-go"
                disabled={!newName.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const gid = await createSpaceWithLocation(me, newName.trim(), 'group', '', null, null);
                    navigate(`/spaces/${gid}`);
                  } catch (e) { console.error(e); setBusy(false); }
                }}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
              <button className="sdir__clear" onClick={() => { setCreating(false); setNewName(''); }} aria-label="Cancel">
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
          <p className="sdir__create-hint">
            Standalone is fine — a group can join a community later from its own page.
          </p>
        </div>
      )}

      {!ready && <p className="sdir__muted">Loading…</p>}
      {ready && rows.length === 0 && <p className="sdir__muted">{copy.empty}</p>}
      {/* Empty means different things here: nothing matched, no lens hit, or
          you're simply not in any yet — say which, and point at All. */}
      {ready && rows.length > 0 && visible.length === 0 && (
        <p className="sdir__muted">
          {q.trim()
            ? <>Nothing matches &ldquo;{q.trim()}&rdquo;.</>
            : lenses.size > 0
              ? <>None of these {copy.title.toLowerCase()} match those filters.</>
              : scope === 'mine'
                ? <>
                    You&rsquo;re not in any {copy.title.toLowerCase()} yet.{' '}
                    <button className="sdir__link" onClick={() => setScope('all')}>
                      See all {copy.title.toLowerCase()}
                    </button>
                  </>
                : <>{copy.empty}</>}
        </p>
      )}

      <div className="sdir__list">
        {visible.map((s) => (
          <button key={s.id} className="sdir__row" onClick={() => navigate(`/spaces/${s.id}`)}>
            <Avatar id={s.id} name={s.name} url={s.avatar_url} size={44} />
            <span className="sdir__body">
              <span className="sdir__name">{s.name}</span>
              <span className="sdir__sub">
                {s.parent && <>in {s.parent.name} · </>}
                {s.member_count} {s.member_count === 1 ? 'member' : 'members'}
                {s.location && <> · {s.location}</>}
              </span>
              {s.description && <span className="sdir__desc">{s.description}</span>}
            </span>
            {mine.has(s.id) && <span className="sdir__chip sdir__chip--in">Member ✓</span>}
            {!mine.has(s.id) && asked.has(s.id) && <span className="sdir__chip">Asked to join</span>}
            {!mine.has(s.id) && invited.has(s.id) && <span className="sdir__chip sdir__chip--in">Invited — respond</span>}
            <Icon name="chevron-right" size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
