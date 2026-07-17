import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { WeaveMark } from '../components/WeaveMark';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { loadMyWeb, setInWeb, setVouch } from '../lib/myceliumApi';
import './MyceliumDirectory.css';

/** Your whole web in one place — every person and space you've woven in,
 *  grouped by kind. This is where you TEND the web: the mark removes an
 *  entity (which also withdraws any trust), the shield toggles the private
 *  trust signal on its own. Rows stay put after unweaving so a stray tap
 *  is one tap to undo; they clear on the next visit. */

interface Entry {
  key: string;               // `${type}:${id}`
  type: 'profile' | 'space';
  id: string;
  name: string;
  sub?: string;              // headline (people) — kind is the group header
  kind: string;              // 'person' | space kind
  avatarUrl?: string | null;
  vouched: boolean;
  canVouch: boolean;         // places take Recommend, not Trust
}

const GROUPS: { kind: string; title: string }[] = [
  { kind: 'person',       title: 'People' },
  { kind: 'organization', title: 'Organizations' },
  { kind: 'community',    title: 'Communities' },
  { kind: 'group',        title: 'Groups' },
  { kind: 'place',        title: 'Places' },
];

export default function MyceliumDirectory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) { setReady(true); return; }
    let live = true;
    (async () => {
      const { web, vouched } = await loadMyWeb();
      const profileIds = [...web].filter((k) => k.startsWith('profile:')).map((k) => k.slice(8));
      const spaceIds = [...web].filter((k) => k.startsWith('space:')).map((k) => k.slice(6));
      const [profs, spaces] = await Promise.all([
        profileIds.length
          ? supabase.from('profiles').select('id, full_name, headline, avatar_url').in('id', profileIds)
          : Promise.resolve({ data: [] }),
        spaceIds.length
          ? supabase.from('spaces').select('id, name, kind, avatar_url').in('id', spaceIds)
          : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;
      const rows: Entry[] = [
        ...((profs.data ?? []) as { id: string; full_name: string | null; headline: string | null; avatar_url: string | null }[])
          .map((p) => ({
            key: 'profile:' + p.id,
            type: 'profile' as const,
            id: p.id,
            name: p.full_name || 'Member',
            sub: p.headline || undefined,
            kind: 'person',
            avatarUrl: p.avatar_url,
            vouched: vouched.has('profile:' + p.id),
            canVouch: true,
          })),
        ...((spaces.data ?? []) as { id: string; name: string; kind: string; avatar_url: string | null }[])
          .map((s) => ({
            key: 'space:' + s.id,
            type: 'space' as const,
            id: s.id,
            name: s.name,
            kind: s.kind,
            avatarUrl: s.avatar_url,
            vouched: vouched.has('space:' + s.id),
            canVouch: s.kind !== 'place',
          })),
      ].sort((a, b) => a.name.localeCompare(b.name));
      setEntries(rows);
      setReady(true);
    })();
    return () => { live = false; };
  }, [user]);

  const toggleVouch = (e: Entry, on: boolean) => {
    setEntries((cur) => cur.map((x) => (x.key === e.key ? { ...x, vouched: on } : x)));
    void setVouch(e.type, e.id, on).catch(console.error);
  };

  // Unweaving deletes the whole edge — trust goes with it, so the shield
  // must fall dark too (and re-weaving starts untrusted).
  const toggleWeave = (e: Entry, on: boolean) => {
    if (!on) setEntries((cur) => cur.map((x) => (x.key === e.key ? { ...x, vouched: false } : x)));
    void setInWeb(e.type, e.id, on).catch(console.error);
  };

  const open = (e: Entry) =>
    navigate(e.type === 'profile' ? `/members/${e.id}` : `/spaces/${e.id}`);

  return (
    <div className="mycdir">
      <header className="mycdir__head">
        <p className="mycdir__crumb">
          <Icon name="sparkle" size={11} />
          <span>Mycelium · Directory</span>
        </p>
        <h1 className="mycdir__title">Your web</h1>
        <p className="mycdir__sub">
          Everyone and everything you&rsquo;ve woven in. The mark removes;
          the shield is your private trust.
        </p>
        {ready && entries.length > 0 && (
          <p className="mycdir__count">
            <span>{entries.length}</span> {entries.length === 1 ? 'thread' : 'threads'}
          </p>
        )}
      </header>

      {!ready && <p className="mycdir__muted">Loading your web…</p>}

      {ready && entries.length === 0 && (
        <div className="mycdir__empty">
          <span className="display-italic">Nothing woven yet.</span>
          <p>
            Tap the mycelium mark beside a name — on posts, in search, on
            profiles — and they&rsquo;ll appear here.
          </p>
        </div>
      )}

      {GROUPS.map((g) => {
        const rows = entries.filter((e) => e.kind === g.kind);
        if (rows.length === 0) return null;
        return (
          <section key={g.kind} className="mycdir__sec">
            <h2 className="mycdir__h2">{g.title}</h2>
            {rows.map((e) => (
              <div
                key={e.key}
                className="mycdir__row"
                role="link"
                tabIndex={0}
                onClick={(ev) => {
                  if ((ev.target as HTMLElement).closest('button')) return;
                  open(e);
                }}
                onKeyDown={(ev) => { if (ev.key === 'Enter') open(e); }}
              >
                <Avatar id={e.id} name={e.name} url={e.avatarUrl} size={40} />
                <span className="mycdir__row-body">
                  <span className="mycdir__row-name">{e.name}</span>
                  {e.sub && <span className="mycdir__row-sub">{e.sub}</span>}
                </span>
                {e.canVouch && (
                  <button
                    className={'mycdir__shield' + (e.vouched ? ' is-on' : '')}
                    onClick={() => toggleVouch(e, !e.vouched)}
                    aria-pressed={e.vouched}
                    aria-label={e.vouched ? `Stop trusting ${e.name}` : `Trust ${e.name}`}
                    title={e.vouched ? 'Someone you trust' : 'Trust (private)'}
                  >
                    <Icon name="shield-user" size={16} />
                  </button>
                )}
                <WeaveMark
                  on
                  onToggle={(on) => toggleWeave(e, on)}
                  entityName={e.name}
                  size={20}
                />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
