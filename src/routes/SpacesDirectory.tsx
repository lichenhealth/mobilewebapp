import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { listSpacesByKind, type SpaceDirectoryRow, type SpaceKind } from '../lib/spacesApi';
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
    lead: 'Smaller circles — many live inside a community.',
    empty: 'No groups yet — community admins can create them on the community’s profile.',
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
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const [list, memRes, reqRes] = await Promise.all([
        listSpacesByKind(kind),
        me ? supabase.from('space_members').select('space_id').eq('profile_id', me)
          : Promise.resolve({ data: [] }),
        me ? supabase.from('space_membership_requests').select('space_id').eq('profile_id', me)
          : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;
      setRows(list);
      setMine(new Set(((memRes.data as { space_id: string }[] | null) ?? []).map((r) => r.space_id)));
      setPending(new Set(((reqRes.data as { space_id: string }[] | null) ?? []).map((r) => r.space_id)));
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
            {!mine.has(s.id) && pending.has(s.id) && <span className="sdir__chip">Pending</span>}
            <Icon name="chevron-right" size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
