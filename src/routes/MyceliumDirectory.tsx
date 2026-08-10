import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { WeaveMark } from '../components/WeaveMark';
import MemberRow from '../components/MemberRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { loadMyWeb, loadMyRecommendations, setInWeb, setVouch, setRecommend } from '../lib/myceliumApi';
import { sortClaudeFirst } from '../lib/chatApi';
import { hasClaudeFeedActivity } from '../lib/assistantFeedApi';
import {
  awakeList, myPresence, setPresenceVisible,
  type MyPresence,
} from '../lib/presenceApi';
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
  recommended: boolean;
}

// Doors row, left-aligned — same icon-circle convention as Home's own row
// (founder 2026-08-10: the old top-right floating + read as off-brand).
// Both doors open the same weave-search panel below; Search and Plus are
// kept as separate icons purely to match the platform's Search+Post
// doorway pair, not because they do different things here.
// TODO(founder, 2026-08-10): Plus should only show for members with
// capacity to invite — permission model still to be defined.
const WEB_ICONS: IconRowItem[] = [
  { icon: 'search', label: 'Search' },
  { icon: 'plus',   label: 'Weave someone in' },
];

const GROUPS: { kind: string; title: string }[] = [
  { kind: 'person',       title: 'People' },
  { kind: 'organization', title: 'Organizations' },
  { kind: 'community',    title: 'Communities' },
  { kind: 'group',        title: 'Groups' },
  { kind: 'place',        title: 'Places' },
];

interface Hit {
  type: 'profile' | 'space';
  id: string;
  name: string;
  sub?: string;
  kind: string;
  avatarUrl?: string | null;
}

export default function MyceliumDirectory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [ready, setReady] = useState(false);

  // The + panel: search the whole platform, weave from the results.
  const [addOpen, setAddOpen] = useState(false);
  // Presence: awake + opted-in members float to the top of People; own toggle
  // lives here now (the greeting on Home leads straight to this room).
  const [urlParams] = useSearchParams();
  const fromHome = urlParams.get('from') === 'home';
  const [awakeSet, setAwakeSet] = useState<Set<string>>(new Set());   // "around" (dot)
  const [litSet, setLitSet] = useState<Set<string>>(new Set());       // "present" (candle)
  const [myPres, setMyPres] = useState<MyPresence | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  // Claude's row is grayed out until the viewer has actually talked to them.
  const [claudeInUse, setClaudeInUse] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!user) return;
    void hasClaudeFeedActivity(user.id).then(setClaudeInUse);
  }, [user]);

  useEffect(() => {
    if (!addOpen || q.trim().length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const needle = '%' + q.trim() + '%';
      const [profs, sps] = await Promise.all([
        // Weaving someone in starts by finding them — a browse surface.
        supabase.from('profiles').select('id, full_name, headline, avatar_url')
          .ilike('full_name', needle).eq('findable', true).limit(8),
        supabase.from('spaces').select('id, name, kind, avatar_url').ilike('name', needle).limit(8),
      ]);
      if (!live) return;
      setHits([
        ...((profs.data ?? []) as { id: string; full_name: string | null; headline: string | null; avatar_url: string | null }[])
          .filter((p) => p.id !== user?.id)
          .map((p) => ({
            type: 'profile' as const, id: p.id,
            name: p.full_name || 'Member', sub: p.headline || undefined,
            kind: 'person', avatarUrl: p.avatar_url,
          })),
        ...((sps.data ?? []) as { id: string; name: string; kind: string; avatar_url: string | null }[])
          .map((s) => ({
            type: 'space' as const, id: s.id, name: s.name,
            sub: s.kind.charAt(0).toUpperCase() + s.kind.slice(1),
            kind: s.kind, avatarUrl: s.avatar_url,
          })),
      ]);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, addOpen, user]);

  // Weaving from the panel mirrors straight into the directory below.
  const weaveFromSearch = (h: Hit, on: boolean) => {
    void setInWeb(h.type, h.id, on).catch(console.error);
    const key = `${h.type}:${h.id}`;
    setEntries((cur) => {
      if (!on) return cur.filter((x) => x.key !== key);
      if (cur.some((x) => x.key === key)) return cur;
      return [...cur, { ...h, key, vouched: false, recommended: false }]
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  useEffect(() => {
    if (!user) { setReady(true); return; }
    let live = true;
    (async () => {
      const [{ web, vouched }, recs, folk, mine] = await Promise.all([
        loadMyWeb(), loadMyRecommendations(), awakeList(), myPresence(user.id),
      ]);
      if (live) {
        setAwakeSet(new Set(folk.map((f) => f.id)));
        setLitSet(new Set(folk.filter((f) => f.lit).map((f) => f.id)));
        setMyPres(mine);
      }
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
            recommended: recs.has('profile:' + p.id),
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
            recommended: recs.has('space:' + s.id),
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

  // Trust and recommend are independent signals (founder, 2026-07-17): you
  // may trust someone yet not recommend what they offer, or the reverse.
  const toggleRec = (e: Entry, on: boolean) => {
    setEntries((cur) => cur.map((x) => (x.key === e.key ? { ...x, recommended: on } : x)));
    void setRecommend(e.type, e.id, on).catch(console.error);
  };

  // Unweaving deletes the whole edge — trust goes with it, so the shield
  // must fall dark too (and re-weaving starts untrusted). Recommendations
  // live in their own table and survive.
  const toggleWeave = (e: Entry, on: boolean) => {
    if (!on) setEntries((cur) => cur.map((x) => (x.key === e.key ? { ...x, vouched: false } : x)));
    void setInWeb(e.type, e.id, on).catch(console.error);
  };

  const open = (e: Entry) =>
    navigate(e.type === 'profile' ? `/members/${e.id}` : `/spaces/${e.id}`);

  return (
    <div className="mycdir">
      {fromHome && (
        <button className="cmp__back mycdir__back" onClick={() => navigate('/home')}>
          <Icon name="arrow-left" size={14} /> Home
        </button>
      )}
      <IconRow items={WEB_ICONS} onSelect={() => { setAddOpen((o) => !o); setQ(''); }} />
      <header className="mycdir__head">
        <p className="mycdir__crumb">
          <Icon name="sparkle" size={11} />
          <span>My-celium · Directory</span>
        </p>
        <h1 className="mycdir__title">Your web</h1>
        <p className="mycdir__sub">
          Everyone and everything you&rsquo;ve woven in. Shield = private
          trust, thumb = recommend, mark = remove.
        </p>
        {myPres !== null && (
          <div className="mycdir__presence">
            {/* AROUND — the peach dot. Default on; opt out here. */}
            <label className="mycdir__presence-row">
              <input
                type="checkbox" checked={myPres.visible}
                onChange={(e) => {
                  const on = e.target.checked;
                  setMyPres((cur) => cur && ({ ...cur, visible: on }));
                  if (user) void setPresenceVisible(user.id, on).catch(console.error);
                }}
              />
              <span className="mycdir__awake-dot" aria-hidden="true" />
              Show that I&rsquo;m around when I&rsquo;m online
            </label>

            {/* PRESENT — the candle lives in the top bar now: light it there,
                anywhere, and it stays lit until you snuff it (no fade). */}
            <span className="mycdir__presence-note">
              🕯️ Light the candle in the top bar to show you&rsquo;re around and open to connecting.
            </span>
            <span className="mycdir__presence-creed">Being present is a gift.</span>
          </div>
        )}
        {ready && entries.length > 0 && (
          <p className="mycdir__count">
            <span>{entries.length}</span> {entries.length === 1 ? 'thread' : 'threads'}
          </p>
        )}
      </header>

      {addOpen && (
        <div className="mycdir__addpanel">
          <div className="mycdir__addsearch">
            <Icon name="search" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people, organizations, places…"
              autoFocus
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="Clear">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          {hits.map((h) => (
            <div
              key={`${h.type}:${h.id}`}
              className="mycdir__row"
              role="link"
              tabIndex={0}
              onClick={(ev) => {
                if ((ev.target as HTMLElement).closest('button')) return;
                navigate(h.type === 'profile' ? `/members/${h.id}` : `/spaces/${h.id}`);
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') navigate(h.type === 'profile' ? `/members/${h.id}` : `/spaces/${h.id}`);
              }}
            >
              <Avatar id={h.id} name={h.name} url={h.avatarUrl} size={40} />
              <span className="mycdir__row-body">
                <span className="mycdir__row-name">{h.name}</span>
                {h.sub && <span className="mycdir__row-sub">{h.sub}</span>}
              </span>
              <WeaveMark
                on={entries.some((x) => x.key === `${h.type}:${h.id}`)}
                onToggle={(on) => weaveFromSearch(h, on)}
                entityName={h.name}
                size={20}
              />
            </div>
          ))}
          {q.trim().length >= 2 && hits.length === 0 && (
            <p className="mycdir__muted">No one by that name yet.</p>
          )}
        </div>
      )}

      {!ready && <p className="mycdir__muted">Loading your web…</p>}

      {ready && entries.length === 0 && (
        <div className="mycdir__empty">
          <span className="display-italic">Nothing woven yet.</span>
          <p>
            Tap the my-celium mark beside a name — on posts, in search, on
            profiles — and they&rsquo;ll appear here.
          </p>
        </div>
      )}

      {GROUPS.map((g) => {
        // Present (candle) first, then around (dot), then the rest.
        const presenceRank = (e: Entry) =>
          e.type !== 'profile' ? 0 : litSet.has(e.id) ? 2 : awakeSet.has(e.id) ? 1 : 0;
        // Present (candle), then around (dot), then everyone else — Claude
        // always leads regardless (sortClaudeFirst is a no-op elsewhere,
        // Claude only ever appears in the People group).
        const rows = sortClaudeFirst(entries.filter((e) => e.kind === g.kind)
          .sort((a, b) => presenceRank(b) - presenceRank(a) || a.name.localeCompare(b.name)));
        if (rows.length === 0) return null;
        return (
          <section key={g.kind} className="mycdir__sec">
            <h2 className="mycdir__h2">{g.title}</h2>
            {rows.map((e) => (
              <MemberRow
                key={e.key}
                id={e.id}
                name={e.name}
                sub={e.sub}
                avatarUrl={e.avatarUrl}
                presence={e.type === 'profile' && litSet.has(e.id) ? 'lit'
                  : e.type === 'profile' && awakeSet.has(e.id) ? 'around' : null}
                // ONE GESTURE PER KIND (founder 2026-08-07: "you can trust a
                // person, but recommend an org, group or community... a
                // shield for people, a thumbs up for organizations,
                // communities, groups and places"). Trust is a relationship
                // between people and stays private; an organisation is
                // something you vouch FOR publicly — recommend.
                kind={e.type === 'profile' ? 'person' : 'space'}
                trusted={e.vouched}
                onTrust={(on) => toggleVouch(e, on)}
                recommended={e.recommended}
                onRecommend={(on) => toggleRec(e, on)}
                weaveOn
                onWeave={(on) => toggleWeave(e, on)}
                onOpen={() => open(e)}
                claudeInUse={claudeInUse}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
