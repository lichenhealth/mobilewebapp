import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Icon, IconName } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import { ScrollHintRow } from '../components/ScrollHintRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { listPublicCollections, createCollection, type CollectionRow, type CollectionKind } from '../lib/collectionsApi';
import OfferingChips from '../components/OfferingChips';
import { setHidden } from '../lib/hiddenApi';
import { loadFeed, loadAuthorFeed, deletePost, postAreas, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { postOpenPath, postToCard, postMedium, weaveProps, type PostMedium } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './Marketplace.css';   // shares the mkt__ section vocabulary

/** A real service-area section (Courses, Library, …): every post shared to
 *  the area, standard feed cards under the trust lens, its own Add + Search
 *  doors. The pattern the Marketplace proved, reusable per area. */
const MEDIA_LENSES: { medium: PostMedium; label: string; icon: IconName }[] = [
  { medium: 'read',   label: 'Read',   icon: 'book' },
  { medium: 'look',   label: 'Look',   icon: 'image' },
  { medium: 'listen', label: 'Listen', icon: 'mic' },
  { medium: 'watch',  label: 'Watch',  icon: 'video' },
];

export default function AreaFeed({ area, icon, crumb, title, italic, sub, addLabel, emptyHint, mediaLenses, collections, structuredKind, createLabel }: {
  area: ServiceArea;
  icon: IconName;
  crumb: string;
  title: string;        // leading (roman) part of the headline
  italic: string;       // display-italic tail
  sub: string;
  addLabel: string;     // the + chip label, e.g. "Offer a course"
  emptyHint: string;
  /** Read/Look/Listen/Watch circles (Library, Courses) — derived per post. */
  mediaLenses?: boolean;
  /** Published collections strip (Library): playlists & anthologies. */
  collections?: boolean;
  /** Structured offerings shelf + create door: 'course' (Courses) or 'path' (Library). */
  structuredKind?: CollectionKind;
  /** The + label for creating a structured offering, e.g. "New course". */
  createLabel?: string;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Scoped sections: /courses?member=<id> = "Melanie's Courses" (founder
  // 2026-07-22); /courses?space=<id> = "WAG's Courses" (founder 2026-07-24 —
  // space area icons open the REAL section, not an inline sub-feed).
  const member = params.get('member');
  const space = params.get('space');
  const scoped = member || space;
  const [memberName, setMemberName] = useState('');
  const { promptSaved, openPicker } = useCollect();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [showSearch, setShowSearch] = useState(false);
  // All lenses start ON (founder): everything shows; deselect to narrow.
  const [media, setMedia] = useState<PostMedium[]>(MEDIA_LENSES.map((m) => m.medium));
  const [publicCols, setPublicCols] = useState<CollectionRow[]>([]);
  const [structuredCols, setStructuredCols] = useState<CollectionRow[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const raw = member ? await loadAuthorFeed({ profileId: member })
        : space ? await loadAuthorFeed({ spaceId: space })
        : await loadFeed(200);
      const feed = raw.filter((p) => postAreas(p).includes(area));
      if (member) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', member).maybeSingle();
        if (live) setMemberName((data as { full_name: string | null } | null)?.full_name ?? '');
      } else if (space) {
        const { data } = await supabase.from('spaces').select('name').eq('id', space).maybeSingle();
        if (live) setMemberName((data as { name: string | null } | null)?.name ?? '');
      }
      if (collections && !scoped) setPublicCols(await listPublicCollections(12, 'collection'));
      if (structuredKind && !scoped) setStructuredCols(await listPublicCollections(12, structuredKind));
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed); setReady(true);
    })();
    return () => { live = false; };
  }, [area, member, space]);

  const filtered = useMemo(() => {
    let list = posts;
    if (mediaLenses) list = list.filter((p) => media.includes(postMedium(p)));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) =>
        (p.title ?? '').toLowerCase().includes(q)
        || p.body.toLowerCase().includes(q)
        || (p.author?.full_name ?? '').toLowerCase().includes(q)
        || (p.author_space?.name ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [posts, media, query]);

  const toggleMedium = (m: PostMedium) =>
    setMedia((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }

  // Create a structured course/path, then open it (owner drops into edit mode).
  async function createStructured() {
    if (!structuredKind || !me) return;
    const nm = window.prompt(`Name your ${structuredKind}`)?.trim();
    if (!nm) return;
    try { navigate(`/collections/${await createCollection(nm, structuredKind)}`); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="mkt">
      <header className="mkt__head">
        {scoped && (
          <button className="cmp__back mkt__memberback" onClick={() => navigate(member ? `/members/${member}` : `/spaces/${space}`)}>
            <Icon name="arrow-left" size={14} /> {memberName || 'Back'}
          </button>
        )}
        <p className="mkt__crumb">
          <Icon name={icon} size={11} />
          <span>{crumb}</span>
        </p>
        <h1 className="mkt__title">
          {scoped
            ? <>{memberName}&rsquo;s <span className="display-italic">{crumb}</span></>
            : <>{title} <span className="display-italic">{italic}</span></>}
        </h1>
        {!scoped && <p className="mkt__sub">{sub}</p>}
      </header>

      <ScrollHintRow className="mkt__actions h-scroll" role="toolbar" ariaLabel="Tools and lenses" gutter>
        <button
          className={'mkt__action' + (showSearch ? ' is-active' : '')}
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
          <span className="mkt__action-label">Search</span>
        </button>
        <button className="mkt__action" onClick={() => navigate(`/compose?area=${area}`)}>
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
          <span className="mkt__action-label">{addLabel}</span>
        </button>
        {structuredKind && me && (
          <button className="mkt__action" onClick={() => void createStructured()}>
            <span className="mkt__action-circle"><Icon name={icon} size={14} /></span>
            <span className="mkt__action-label">{createLabel ?? `New ${structuredKind}`}</span>
          </button>
        )}
        {mediaLenses && (
          <>
            <div className="mkt__action-spacer" />
            {MEDIA_LENSES.map((m) => (
              <button
                key={m.medium}
                className={'mkt__action' + (media.includes(m.medium) ? ' is-active' : '')}
                onClick={() => toggleMedium(m.medium)}
              >
                <span className="mkt__action-circle"><Icon name={m.icon} size={14} /></span>
                <span className="mkt__action-label">{m.label}</span>
              </button>
            ))}
          </>
        )}
      </ScrollHintRow>

      {showSearch && (
        <div className="mkt__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="mkt__search-input"
            placeholder={`Search ${crumb.toLowerCase()} — or use smart search for trust & distance`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="mkt__search-smartlink" onClick={() => navigate(`/search?area=${area}`)}>
            <Icon name="sliders" size={12} /> Smart
          </button>
          {query && (
            <button className="mkt__search-clear" onClick={() => setQuery('')} aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Structured offerings — courses (Courses) / paths (Library). */}
      {structuredKind && structuredCols.length > 0 && (
        <>
          <p className="afeed__shelf-label">{structuredKind === 'course' ? 'Courses' : 'Paths'} to follow</p>
          <ScrollHintRow className="afeed__courses h-scroll">
            {structuredCols.map((c) => (
              <button key={c.id} className="afeed__course" onClick={() => navigate(`/collections/${c.id}`)}>
                <span className="afeed__course-name">{c.name}</span>
                <span className="afeed__course-by">
                  {c.owner?.full_name ?? 'a member'} · {c.item_count} {c.item_count === 1 ? 'lesson' : 'lessons'}
                </span>
                <OfferingChips meta={c.details} lessonCount={c.item_count} />
              </button>
            ))}
          </ScrollHintRow>
        </>
      )}

      {/* Published playlists & anthologies — curation as contribution. */}
      {collections && publicCols.length > 0 && (
        <ScrollHintRow className="afeed__cols h-scroll">
          {publicCols.map((c) => (
            <button key={c.id} className="afeed__col" onClick={() => navigate(`/collections/${c.id}`)}>
              <span className="afeed__col-name">{c.name}</span>
              <span className="afeed__col-by">
                {c.owner?.full_name ?? 'a member'} · {c.item_count} {c.item_count === 1 ? 'piece' : 'pieces'}
              </span>
            </button>
          ))}
        </ScrollHintRow>
      )}

      <p className="mkt__count">
        <span className="mkt__count-n">{filtered.length}</span>{' '}
        {filtered.length === 1 ? 'post' : 'posts'}
      </p>

      <section className="mkt__list">
        {!ready && <p className="mkt__empty-sub">Loading…</p>}
        {ready && filtered.length === 0 && (
          <div className="mkt__empty">
            <Icon name={icon} size={20} />
            <p><span className="display-italic">Nothing here yet.</span></p>
            <p className="mkt__empty-sub">
              {posts.length === 0 ? emptyHint
                : mediaLenses && media.length === 0 ? 'All lenses are off — tap one to see that kind of piece.'
                : 'Try a different search or turn a lens back on.'}
            </p>
          </div>
        )}
        {filtered.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me || undefined)}
            {...weaveProps(p, myWebSet, me || undefined)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            saved={mySaves.has('post:' + p.id)}
            onSave={(on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); }}
            extraMenuItems={me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined}
            viewerIsAuthor={p.author_id === me}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

      <footer className="mkt__end">
        <span className="eyebrow">{`End of ${crumb.toLowerCase()}`}</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
