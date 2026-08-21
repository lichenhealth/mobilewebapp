import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import MemberRow from '../components/MemberRow';
import ListingRow from '../components/ListingRow';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { sortClaudeFirst } from '../lib/chatApi';
import {
  loadMyWeb, loadMyRecommendations, setInWeb, setVouch, setRecommend, recommendKey,
} from '../lib/myceliumApi';
import { getIdentityTags, saveIdentityTags } from '../lib/meansApi';
import { loadForIdentity, postAreas } from '../lib/postsApi';
import type { FeedPost } from '../lib/postsApi';
import { postOpenPath } from '../lib/feedMapping';
import type { IconName } from '../components/Icon';
import './Identities.css';

/** The rooms an identity's page can grow — in the platform's own order,
 *  each with the mark that section wears everywhere else. A room appears
 *  ONLY when someone has aimed content at this identity (founder 2026-08-21:
 *  "something doesn't show up in identity unless someone adds content within
 *  it") — the door-appears-because-something-is-behind-it rule. */
const IDENTITY_AREAS: { key: string; label: string; icon: IconName; route?: string }[] = [
  { key: 'courses', label: 'Courses', icon: 'graduation-cap', route: '/courses' },
  { key: 'marketplace', label: 'Marketplace', icon: 'store', route: '/market' },
  { key: 'events', label: 'Events', icon: 'rsvp', route: '/events' },
  { key: 'work', label: 'Work', icon: 'briefcase', route: '/work' },
  { key: 'library', label: 'Library', icon: 'book', route: '/library' },
  { key: 'art', label: 'Art', icon: 'palette', route: '/art' },
  { key: 'food', label: 'Food', icon: 'fork-spoon', route: '/food' },
  { key: 'travel', label: 'Travel', icon: 'plane', route: '/travel' },
  { key: 'places', label: 'Places', icon: 'location' },   // no post-feed page yet — stays on-page
];

/* IDENTITIES ARE NOT COMMUNITIES (founder 2026-08-20): "Communities should
 * be authentic — all members actually engaging with each other... while
 * Identities can be groups of people who identify as something and would
 * like the opportunity to engage with others of that identity, even if the
 * group gets large and you don't know everyone." A community needs human
 * work — curation, conflict, cohesion — and falls on its face at scale
 * without it. An identity asks none of that: nobody stewards it, joining IS
 * declaring it (the same gesture as the Identity field on your profile),
 * and it holds any number of people honestly. The UI reads like a
 * community's on purpose — but the page always says which one you're in. */

interface IdentityCat { id: string; name: string }
interface MemberHit { id: string; full_name: string | null; headline: string | null; avatar_url: string | null; kind: string | null }
interface SpaceHit { id: string; name: string; kind: string; avatar_url: string | null; description: string | null }

async function loadIdentityCats(): Promise<IdentityCat[]> {
  const { data } = await supabase.from('categories')
    .select('id, name').eq('domain', 'identity').order('name');
  return (data as IdentityCat[] | null) ?? [];
}

/** /identities — the directory of identities: yours first, then all. */
export function IdentitiesDirectory() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const [cats, setCats] = useState<IdentityCat[]>([]);
  const [mine, setMine] = useState<string[]>([]);   // names, from identity_tags
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    // The list itself needs no session — a signed-out visitor can read what
    // identities exist; only "yours" needs to know who you are.
    void Promise.all([loadIdentityCats(), me ? getIdentityTags(me) : Promise.resolve([])])
      .then(([c, tags]) => {
        if (!live) return;
        setCats(c); setMine(tags); setLoading(false);
      });
    return () => { live = false; };
  }, [me]);

  const mineSet = useMemo(() => new Set(mine.map((t) => t.trim().toLowerCase())), [mine]);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? cats.filter((c) => c.name.toLowerCase().includes(q)) : cats;
  }, [cats, query]);
  const yours = hits.filter((c) => mineSet.has(c.name.trim().toLowerCase()));
  const rest = hits.filter((c) => !mineSet.has(c.name.trim().toLowerCase()));

  const row = (c: IdentityCat, carried: boolean) => (
    <button key={c.id} className="idn__row" onClick={() => navigate(`/identities/${c.id}`)}>
      <Icon name="fingerprint" size={15} />
      <span className="idn__row-name">{c.name}</span>
      {carried && <span className="idn__row-carried">✓ yours</span>}
      <Icon name="chevron-right" size={13} />
    </button>
  );

  return (
    <div className="dir idn">
      <header className="dir__head">
        <span className="eyebrow idn__eyebrow"><Icon name="fingerprint" size={13} /> Identities</span>
        <h1 className="dir__title"><span className="display-italic">Identities</span></h1>
        <p className="dir__sub">
          Ways members name themselves — Firefighter, Teacher, Founder. An
          identity isn&rsquo;t a community: nobody runs it, it never needs
          tending, and it can hold any number of people. Naming one as yours
          is how you join it. Don&rsquo;t see yours? Suggest it from the
          Identity field on your profile.
        </p>
      </header>

      <div className="dir__search">
        <Icon name="search" size={16} />
        <input className="dir__search-input" placeholder="Search identities"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button className="dir__search-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="dir__list">
        {loading && <div className="dir__empty"><p>Loading identities…</p></div>}
        {!loading && hits.length === 0 && (
          <div className="dir__empty">
            <Icon name="search" size={20} />
            <p>No identity matches &ldquo;{query}&rdquo;</p>
            <p className="dir__empty-sub">Suggest it to Lichen from the Identity field on your profile.</p>
          </div>
        )}
        {yours.length > 0 && (
          <>
            <h2 className="dir__section">Yours</h2>
            {yours.map((c) => row(c, true))}
          </>
        )}
        {rest.length > 0 && (
          <>
            {yours.length > 0 && <h2 className="dir__section">All identities</h2>}
            {rest.map((c) => row(c, false))}
          </>
        )}
      </div>
    </div>
  );
}

/** /identities/:id — one identity's gathering: everyone who carries it, the
 *  member-run communities formed around it, offerings gifted to it. */
export default function IdentityPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const { actor } = useActing();
  const asSpace = actor.type === 'space' ? actor.id : undefined;

  const [cat, setCat] = useState<IdentityCat | null>(null);
  const [members, setMembers] = useState<MemberHit[]>([]);
  const [spaces, setSpaces] = useState<SpaceHit[]>([]);
  const [forPosts, setForPosts] = useState<FeedPost[]>([]);
  const [myTags, setMyTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Directory's relationship wiring — weave / trust / recommend in place.
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myVouched, setMyVouched] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!me) return;
    setMyWebSet(new Set()); setMyVouched(new Set()); setMyRecs(new Set());
    void loadMyWeb(asSpace).then(({ web, vouched }) => { setMyWebSet(web); setMyVouched(vouched); });
    void loadMyRecommendations().then(setMyRecs);
  }, [me, asSpace]);
  const withKey = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key); else next.delete(key);
    return next;
  };

  const load = async (catRow: IdentityCat) => {
    const [profs, sps, gifts, tags] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, headline, avatar_url, kind')
        .contains('identity_tags', [catRow.name])
        .eq('findable', true)
        .order('full_name'),
      supabase.from('spaces')
        .select('id, name, kind, avatar_url, description')
        .contains('identity_tags', [catRow.name])
        .eq('findable', true)
        .order('name'),
      loadForIdentity(catRow.name),
      me ? getIdentityTags(me) : Promise.resolve([]),
    ]);
    setMembers((profs.data as MemberHit[] | null) ?? []);
    setSpaces((sps.data as SpaceHit[] | null) ?? []);
    setForPosts(gifts);
    setMyTags(tags);
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.from('categories')
        .select('id, name').eq('id', id).eq('domain', 'identity').maybeSingle();
      const c = (data as IdentityCat | null) ?? null;
      if (!live) return;
      setCat(c);
      if (c) await load(c);
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  const carried = !!cat && myTags.some((t) => t.trim().toLowerCase() === cat.name.trim().toLowerCase());

  // Targeted content, grouped into the platform's rooms — each post lands in
  // its first matching area (plain offerings read as Marketplace).
  const byArea = useMemo(() => {
    const map = new Map<string, FeedPost[]>();
    for (const p of forPosts) {
      const areas = postAreas(p) as string[];
      const key = IDENTITY_AREAS.find((a) => areas.includes(a.key))?.key ?? 'marketplace';
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [forPosts]);
  const liveAreas = IDENTITY_AREAS.filter((a) => (byArea.get(a.key)?.length ?? 0) > 0);

  /** Joining IS declaring (the elegance of the no-admin shape): one gesture,
   *  same storage as the profile's Identity field. */
  const toggleCarry = async () => {
    if (!cat || !me || busy) return;
    setBusy(true);
    const next = carried
      ? myTags.filter((t) => t.trim().toLowerCase() !== cat.name.trim().toLowerCase())
      : [...myTags, cat.name];
    await saveIdentityTags(next);
    setMyTags(next);
    await load(cat);   // your row appears/leaves the gathering right away
    setBusy(false);
  };

  if (loading) return <div className="dir idn"><div className="dir__empty"><p>Loading…</p></div></div>;
  if (!cat) {
    return (
      <div className="dir idn">
        <div className="dir__empty">
          <Icon name="search" size={20} />
          <p>That identity isn&rsquo;t in the vocabulary.</p>
          <button className="btn" onClick={() => navigate('/identities')}>All identities</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dir idn">
      <header className="dir__head">
        <button className="idn__back" onClick={() => navigate('/identities')}>
          <Icon name="arrow-left" size={14} /> Identities
        </button>
        <span className="eyebrow idn__eyebrow"><Icon name="fingerprint" size={13} /> Identity</span>
        <h1 className="dir__title"><span className="display-italic">{cat.name}</span></h1>
        <p className="dir__sub">
          Everyone on Lichen who identifies as {cat.name.toLowerCase()}. An
          identity, not a community — nobody stewards it, and it holds any
          number of people. Communities formed around it are run by members
          and listed below.
        </p>
        <div className="idn__carry">
          {carried ? (
            <>
              <span className="idn__carry-state">✓ You identify as {cat.name}</span>
              <button className="idn__carry-out" onClick={() => void toggleCarry()} disabled={busy}>
                Step out
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void toggleCarry()} disabled={busy || !me}>
              {busy ? '…' : `I identify as ${cat.name}`}
            </button>
          )}
        </div>
        {/* The doors row — only rooms with something behind them, and each
            opens the REAL section scoped to this identity (founder
            2026-08-21: "marketplace with the filter of first responder
            already added") — ScopeBack there offers Back-to-the-gathering
            and an explicit clear-the-filter step. */}
        {liveAreas.length > 0 && (
          <div className="idn__doors">
            {liveAreas.map((a) => (
              <button key={a.key} type="button" className="idn__door" title={`${a.label} for ${cat.name}s`}
                onClick={() => a.route
                  ? navigate(`${a.route}?identity=${cat.id}`)
                  : document.getElementById(`idnsec-${a.key}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
                <Icon name={a.icon} size={18} />
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="dir__list">
        {members.length === 0 && (
          <div className="dir__empty">
            <Icon name="user-multiple" size={20} />
            <p>Nobody has named this identity yet.</p>
            <p className="dir__empty-sub">Carrying it puts you here, findable to others who share it.</p>
          </div>
        )}
        {sortClaudeFirst(members as { id: string; full_name?: string | null }[]).map((raw) => {
          const m = raw as MemberHit;
          const isPerson = !m.kind || m.kind === 'person';
          return (
            <MemberRow
              key={m.id}
              id={m.id}
              name={m.full_name ?? 'Member'}
              sub={m.headline ?? undefined}
              avatarUrl={m.avatar_url}
              kind={isPerson ? 'person' : 'space'}
              trusted={isPerson && !asSpace ? myVouched.has('profile:' + m.id) : undefined}
              onTrust={isPerson && !asSpace && m.id !== me ? (on) => {
                setMyVouched((s) => withKey(s, 'profile:' + m.id, on));
                if (on) setMyWebSet((s) => withKey(s, 'profile:' + m.id, true));
                void setVouch('profile', m.id, on).catch(console.error);
              } : undefined}
              weaveOn={myWebSet.has('profile:' + m.id)}
              onWeave={(on) => {
                setMyWebSet((s) => withKey(s, 'profile:' + m.id, on));
                if (!on) setMyVouched((s) => withKey(s, 'profile:' + m.id, false));
                void setInWeb('profile', m.id, on, asSpace).catch(console.error);
              }}
              onOpen={() => navigate(`/members/${m.id}`)}
              hideActions={m.id === me}
              roleLabel={m.id === me ? 'you' : undefined}
            />
          );
        })}

        {spaces.length > 0 && (
          <>
            <h2 className="dir__section">Formed around this identity</h2>
            <p className="idn__section-note">
              Member-run — real communities with someone tending them, unlike
              the gathering above.
            </p>
            {spaces.map((sp) => (
              <MemberRow
                key={sp.id}
                id={sp.id}
                name={sp.name}
                sub={sp.description?.slice(0, 90) || undefined}
                avatarUrl={sp.avatar_url}
                kind="space"
                recommended={myRecs.has(recommendKey('space', sp.id, undefined, asSpace))}
                onRecommend={(on) => {
                  setMyRecs((s) => withKey(s, recommendKey('space', sp.id, undefined, asSpace), on));
                  void setRecommend('space', sp.id, on, undefined, asSpace).catch(console.error);
                }}
                weaveOn={myWebSet.has('space:' + sp.id)}
                onWeave={(on) => {
                  setMyWebSet((s) => withKey(s, 'space:' + sp.id, on));
                  void setInWeb('space', sp.id, on, asSpace).catch(console.error);
                }}
                onOpen={() => navigate(`/spaces/${sp.id}`)}
              />
            ))}
          </>
        )}

        {/* THE ROOMS, presence-gated (founder 2026-08-21): a course aimed at
            veterans puts Courses on the Veteran page; a targeted listing
            puts Marketplace there. No content, no room. */}
        {liveAreas.map((a) => (
          <div key={a.key} id={`idnsec-${a.key}`}>
            <h2 className="dir__section idn__area-head">
              <Icon name={a.icon} size={15} /> {a.label} for {cat.name}s
            </h2>
            {byArea.get(a.key)!.map((p) => (
              <ListingRow key={p.id} post={p} onOpen={() => navigate(postOpenPath(p))} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
