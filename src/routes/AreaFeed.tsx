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
import { listPublicCollections, listSpaceCollections, createCollection, type CollectionRow, type CollectionKind } from '../lib/collectionsApi';
import { myDutiesIn, holdsDuty } from '../lib/spacesApi';
import ListingTile from '../components/ListingTile';
import ListingRow from '../components/ListingRow';
import ViewToggle from '../components/ViewToggle';
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

export default function AreaFeed({ area, icon, crumb, title, italic, sub, addLabel, emptyHint, mediaLenses, collections, structuredKind, browse, browseStyle = 'tiles' }: {
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
  /** Structured offerings shelf + create chooser: 'course' (Courses) or 'path' (Library). */
  structuredKind?: CollectionKind;
  /** Browse-first section: cover-tile grid default, card feed one toggle away. */
  browse?: boolean;
  /** Browse renderer: 'tiles' (cover grid — marketplace idiom) or 'rows'
   *  (job-board rows — Work). Default tiles. */
  browseStyle?: 'tiles' | 'rows';
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
  // The + shares a post; Organize (both structured sections — founder
  // 2026-07-25: Courses gets the door too) reveals the inline create panel.
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  // Space-scoped sections: do I steward this space's library/courses?
  const [spaceDuty, setSpaceDuty] = useState(false);
  // Browse grid default (per-device choice persists), feed one toggle away.
  const [view, setView] = useState<'browse' | 'feed'>(
    () => (browse && localStorage.getItem(`view-${area}`) !== 'feed' ? 'browse' : 'feed'));
  const pickView = (v: 'browse' | 'feed') => { setView(v); localStorage.setItem(`view-${area}`, v); };

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
      if (structuredKind) {
        // The shelf follows the scope: a space's own collections (private ones
        // included for its members via RLS), a member's published ones, or the
        // whole platform's.
        if (space) setStructuredCols(await listSpaceCollections(space, structuredKind));
        else if (member) setStructuredCols(await listPublicCollections(12, structuredKind, member));
        else setStructuredCols(await listPublicCollections(12, structuredKind));
      }
      if (space && structuredKind && me) {
        const mine = await myDutiesIn(space);
        if (live) setSpaceDuty(holdsDuty(mine?.role, mine?.duties, structuredKind === 'course' ? 'courses' : 'library'));
      } else {
        setSpaceDuty(false);
      }
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

  // In a space's section, a duty-holder creates FOR the space; anywhere else
  // the collection is personal.
  const createForSpace = !!space && spaceDuty;
  // Who may create here: personal contexts = any signed-in member; a space's
  // section = only its duty-holders (members suggest instead).
  const canCreate = !!structuredKind && !!me && (!space || spaceDuty);

  // Create a structured course/collection, then open it (curator drops into edit mode).
  async function createStructured() {
    const nm = createName.trim();
    if (!structuredKind || !me || !nm || creating) return;
    setCreating(true);
    try { navigate(`/collections/${await createCollection(nm, structuredKind, createForSpace ? space! : undefined)}`); }
    catch (e) { console.error(e); setCreating(false); }
  }

  const composeHref = `/compose?area=${area}${space ? `&space=${space}` : ''}`;

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

      {/* Icon-only Search and + — the home-feed vocabulary (founder 2026-07-24);
          the + carries creation too via the chooser below. */}
      <ScrollHintRow className="mkt__actions h-scroll" role="toolbar" ariaLabel="Tools and lenses" gutter>
        <button
          className={'mkt__action' + (showSearch ? ' is-active' : '')}
          aria-label="Search"
          title="Search"
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
        </button>
        <button
          className="mkt__action"
          aria-label={addLabel}
          title={addLabel}
          onClick={() => navigate(composeHref)}
        >
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
        </button>
        {/* The third door: Organize, visible and labeled — creation deserves
            its own front door, not a hiding spot in the + (Library 2026-07-24;
            Courses joined 2026-07-25, retiring the +'s two-way chooser). */}
        {structuredKind && canCreate && (
          <button
            className={'mkt__action' + (createOpen ? ' is-active' : '')}
            onClick={() => setCreateOpen((o) => !o)}
          >
            <span className="mkt__action-circle"><Icon name={icon} size={14} /></span>
            <span className="mkt__action-label">Organize</span>
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

      {/* Inline create for a course/collection — explains the shape, no browser prompt. */}
      {createOpen && structuredKind && (
        <div className="afeed__create">
          <p className="afeed__create-hint">
            {structuredKind === 'course'
              ? 'A course is an ordered set of lessons you teach — members enroll, follow along, and track their progress. You’ll add lessons and details on the next screen.'
              : 'Organize pieces of the Library into an ordered collection — things to read, watch, or listen to in sequence, like a reading list. You’ll add the pieces and details on the next screen.'}
            {createForSpace && <> It will belong to <strong>{memberName || 'this space'}</strong> — its stewards organize it together.</>}
          </p>
          <div className="afeed__create-row">
            <input
              autoFocus
              className="afeed__create-input"
              placeholder={structuredKind === 'course' ? 'Name your course…' : 'Name your collection…'}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createStructured(); }}
            />
            <button
              className="btn btn-primary afeed__create-btn"
              disabled={!createName.trim() || creating}
              onClick={() => void createStructured()}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Structured offerings — courses (Courses) / paths (Library). */}
      {structuredKind && structuredCols.length > 0 && (
        <>
          <p className="afeed__shelf-label">
            {scoped && memberName
              ? `${memberName}’s ${structuredKind === 'course' ? 'courses' : 'organized collections'}`
              : structuredKind === 'course' ? 'Courses to follow' : 'Organized collections'}
          </p>
          {(() => {
            const cards = structuredCols.map((c) => (
              <button key={c.id} className="afeed__course" onClick={() => navigate(`/collections/${c.id}`)}>
                <span className="afeed__course-name">{c.name}</span>
                <span className="afeed__course-by">
                  <span
                    role="link" tabIndex={0}
                    className="afeed__course-author"
                    onClick={(e) => { e.stopPropagation(); navigate(`/members/${c.owner_id}`); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/members/${c.owner_id}`); } }}
                  >
                    {c.owner?.full_name ?? 'a member'}
                  </span>
                  {' · '}{c.item_count}{' '}
                  {structuredKind === 'course'
                    ? (c.item_count === 1 ? 'lesson' : 'lessons')
                    : (c.item_count === 1 ? 'piece' : 'pieces')}
                </span>
                <OfferingChips meta={c.details} lessonCount={c.item_count} itemWord={structuredKind === 'course' ? 'lesson' : 'piece'} />
              </button>
            ));
            // Browse mode, Courses: the Skillshare idiom — offerings WRAP as a
            // grid, they ARE the page. Library keeps the shelf (Spotify rows).
            return view === 'browse' && structuredKind === 'course'
              ? <div className="afeed__courses-grid">{cards}</div>
              : <ScrollHintRow className="afeed__courses h-scroll" gutter>{cards}</ScrollHintRow>;
          })()}
        </>
      )}

      {/* Published playlists & anthologies — curation as contribution. */}
      {collections && publicCols.length > 0 && (
        <ScrollHintRow className="afeed__cols h-scroll" gutter>
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
        {browse && <ViewToggle view={view} onChange={pickView} />}
      </p>

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

      {/* Browse: cover-tile grid (things on a shelf) or job-board rows (Work)
          — pieces read as what they are, not a timeline. */}
      {ready && view === 'browse' && filtered.length > 0 && (
        <section className={browseStyle === 'rows' ? 'row-list' : 'tile-grid'}>
          {filtered.map((p) => {
            const eyebrow = postToCard(p, me || undefined).eyebrow;
            const shared = {
              post: p,
              offer: eyebrow === 'Mycelium' ? undefined : eyebrow,
              endorsed: !!overlays[p.id]
                && ((overlays[p.id].trusted?.length ?? 0) + (overlays[p.id].recommended?.length ?? 0) > 0),
              onOpen: () => navigate(postOpenPath(p)),
              onHide: me
                ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); }
                : undefined,
            };
            return browseStyle === 'rows'
              ? <ListingRow key={p.id} {...shared} />
              : <ListingTile key={p.id} {...shared} />;
          })}
        </section>
      )}

      {view === 'feed' && <section className="mkt__list">
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
      </section>}

      <footer className="mkt__end">
        <span className="eyebrow">{`End of ${crumb.toLowerCase()}`}</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
