import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { listSpacesByKind, createSpaceWithLocation, holdsDuty, type SpaceDirectoryRow, type SpaceKind, type SpaceRole } from '../lib/spacesApi';
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

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(n)
      || (r.description ?? '').toLowerCase().includes(n)
      || (r.parent?.name ?? '').toLowerCase().includes(n));
  }, [rows, q]);

  return (
    <div className="sdir">
      <header className="sdir__head">
        <p className="eyebrow">{copy.title}</p>
        <h1 className="sdir__title display-italic">{copy.lead}</h1>
      </header>

      <div className="sdir__search">
        <Icon name="search" size={14} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${copy.title.toLowerCase()}…`}
        />
        {q && (
          <button className="sdir__clear" onClick={() => setQ('')} aria-label="Clear">
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {kind === 'group' && me && (
        <div className="sdir__create">
          {!creating ? (
            <button className="sdir__create-btn" onClick={() => setCreating(true)}>
              <Icon name="plus" size={13} /> New group
            </button>
          ) : (
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
      {ready && rows.length > 0 && visible.length === 0 && (
        <p className="sdir__muted">Nothing matches &ldquo;{q.trim()}&rdquo;.</p>
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
