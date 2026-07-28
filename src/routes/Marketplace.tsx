import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import FeedCard from '../components/FeedCard';
import { ScrollHintRow } from '../components/ScrollHintRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import ListingTile from '../components/ListingTile';
import { loadTrustWeb, trustPathTo, namesFor, type TrustWeb } from '../lib/trustPath';
import ViewToggle from '../components/ViewToggle';
import { supabase } from '../lib/supabase';
import { loadFeed, loadAuthorFeed, deletePost, postAreas, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './Marketplace.css';

// Offer modes as stored by Compose: details.mode (marketplace listings) with
// event_mode as the fallback for event cross-posts.
type Mode = 'gift' | 'trade' | 'rent' | 'lend' | 'borrow' | 'sale' | 'sliding' | 'iso';
// Lend and Borrow are separate chips (founder, 2026-07-17): Lend = offers
// to lend out, Borrow = asks to borrow. ISO = in-search-of asks.
// "For Sale" covers fixed-price AND sliding-scale — sliding is a pricing
// style, not a category (founder, 2026-07-16); the card's eyebrow shows
// either the fixed price or the sliding range.
type Chip = 'gift' | 'trade' | 'rent' | 'lend' | 'borrow' | 'iso' | 'sale';
const CHIP_MODES: Record<Chip, Mode[]> = {
  gift: ['gift'], trade: ['trade'], rent: ['rent'],
  lend: ['lend'], borrow: ['borrow'], iso: ['iso'], sale: ['sale', 'sliding'],
};
const MODES: { chip: Chip; label: string; icon: IconName }[] = [
  { chip: 'gift',       label: 'Gift',        icon: 'heart-line' },
  { chip: 'trade',      label: 'Trade',       icon: 'trade' },
  { chip: 'rent',       label: 'Rent',        icon: 'rent' },
  { chip: 'lend',       label: 'Lend',        icon: 'lend' },
  { chip: 'borrow',     label: 'Borrow',      icon: 'reply' },
  { chip: 'sale',       label: 'For Sale',    icon: 'store' },
  { chip: 'iso',        label: 'ISO',         icon: 'search' },
];
const ALL_CHIPS: Chip[] = MODES.map((m) => m.chip);

const ALL_MODES: Mode[] = ['gift', 'trade', 'rent', 'lend', 'borrow', 'sale', 'sliding', 'iso'];
/** Every mode a listing carries — multi-mode offers match EVERY door they
 *  open, not just the primary (a gift-to-veterans-or-paid listing shows under
 *  both the Gift and For Sale lenses). */
function postModes(p: FeedPost): Mode[] {
  const arr = Array.isArray(p.details?.modes)
    ? (p.details.modes as unknown[]).filter((m): m is Mode => typeof m === 'string' && ALL_MODES.includes(m as Mode))
    : [];
  if (arr.length) return arr;
  const m = p.details?.mode;
  if (typeof m === 'string' && ALL_MODES.includes(m as Mode)) return [m as Mode];
  if (p.event_mode === 'free') return ['gift'];
  if (p.event_mode === 'trade') return ['trade'];
  if (p.event_mode === 'paid') return ['sale'];
  return [];
}

/** The real Marketplace: every post shared to the marketplace area, under the
 *  same trust lens as every other feed. Offers and asks alike — Gift, Trade,
 *  Rent, Lend, Borrow, Sale — filtered by mode, searchable, one tap from
 *  listing anything via Compose. */
export default function Marketplace() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Scoped market: /market?space=<id> = "Pine Valley Grange's Marketplace"
  // (founder 2026-07-25 — space/member area doors open the REAL marketplace,
  // not a search hand-off); /market?member=<id> likewise.
  const member = params.get('member');
  const space = params.get('space');
  const scoped = member || space;
  const [scopeName, setScopeName] = useState('');
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
  const [activeChips, setActiveChips] = useState<Chip[]>(ALL_CHIPS);   // lenses default all-on
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  // Browse (photo-first tile grid) is the default; the trust-lens card feed
  // stays one toggle away. The choice sticks per device.
  const [view, setView] = useState<'browse' | 'feed'>(
    () => (localStorage.getItem('mkt-view') === 'feed' ? 'feed' : 'browse'));
  const pickView = (v: 'browse' | 'feed') => { setView(v); localStorage.setItem('mkt-view', v); };
  // THE SAFETY LENS (founder 2026-07-28): narrow the whole market to sellers
  // your web vouches for. 'any' stays the default — the lens is a choice,
  // never a wall. Vocabulary is the trust ladder, viewer-relative always.
  type TrustLens = 'any' | 'second' | 'mine';
  const [trustLens, setTrustLens] = useState<TrustLens>(
    () => (localStorage.getItem('mkt-trust') as TrustLens) || 'any');
  const pickLens = (l: TrustLens) => { setTrustLens(l); localStorage.setItem('mkt-trust', l); };
  const [web, setWeb] = useState<TrustWeb | null>(null);
  const [viaNames, setViaNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadTrustWeb(me).then((w) => { if (live) setWeb(w); });
    return () => { live = false; };
  }, [me]);
  // Seller paths, viewer-relative: postId → my path to its author.
  const sellerPaths = useMemo(() => {
    if (!web) return new Map<string, { degree: 'mine' | 'second'; via: string | null }>();
    const m = new Map<string, { degree: 'mine' | 'second'; via: string | null }>();
    for (const p of posts) {
      const hit = p.author_space_id
        ? trustPathTo(web, 'space', p.author_space_id)
        : trustPathTo(web, 'profile', p.author_id);
      if (hit) m.set(p.id, hit);
    }
    return m;
  }, [web, posts]);
  useEffect(() => {
    const vias = [...sellerPaths.values()].map((h) => h.via).filter((v): v is string => !!v);
    if (!vias.length) return;
    let live = true;
    void namesFor(vias).then((n) => { if (live) setViaNames(n); });
    return () => { live = false; };
  }, [sellerPaths]);
  const sellerLine = (postId: string): string | undefined => {
    const hit = sellerPaths.get(postId);
    if (!hit) return undefined;
    if (hit.degree === 'mine') return 'Someone you trust';
    return hit.via && viaNames.get(hit.via)
      ? `Trusted by ${viaNames.get(hit.via)} — someone you trust`
      : 'Trusted by someone you trust';
  };

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const raw = member ? await loadAuthorFeed({ profileId: member })
        : space ? await loadAuthorFeed({ spaceId: space })
        : await loadFeed(200);
      const feed = raw.filter((p) => postAreas(p).includes('marketplace'));
      if (member) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', member).maybeSingle();
        if (live) setScopeName((data as { full_name: string | null } | null)?.full_name ?? '');
      } else if (space) {
        const { data } = await supabase.from('spaces').select('name').eq('id', space).maybeSingle();
        if (live) setScopeName((data as { name: string | null } | null)?.name ?? '');
      }
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed); setReady(true);
    })();
    return () => { live = false; };
  }, [member, space]);

  const filtered = useMemo(() => {
    const wanted = new Set(activeChips.flatMap((c) => CHIP_MODES[c]));
    // Unlabeled listings stay visible while any lens is on — only an
    // explicit mode can be filtered away.
    let list = posts.filter((p) => {
      const ms = postModes(p);
      return ms.length === 0 ? activeChips.length > 0 : ms.some((m) => wanted.has(m));
    });
    if (trustLens !== 'any') {
      list = list.filter((p) => {
        if (p.author_id === me) return true;
        const hit = sellerPaths.get(p.id);
        return !!hit && (trustLens === 'second' || hit.degree === 'mine');
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) =>
        (p.title ?? '').toLowerCase().includes(q)
        || p.body.toLowerCase().includes(q)
        || (p.author?.full_name ?? '').toLowerCase().includes(q)
        || (p.author_space?.name ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [posts, activeChips, query, trustLens, sellerPaths, me]);

  const toggleChip = (c: Chip) =>
    setActiveChips((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="mkt">
      <header className="mkt__head">
        {scoped && (
          <button className="cmp__back mkt__memberback" onClick={() => navigate(member ? `/members/${member}` : `/spaces/${space}`)}>
            <Icon name="arrow-left" size={14} /> {scopeName || 'Back'}
          </button>
        )}
        <p className="mkt__crumb">
          <Icon name="store" size={11} />
          <span>Marketplace</span>
        </p>
        <h1 className="mkt__title">
          {scoped
            ? <>{scopeName}&rsquo;s <span className="display-italic">Marketplace</span></>
            : <>What members are <span className="display-italic">offering &amp; seeking.</span></>}
        </h1>
        {!scoped && (
          <p className="mkt__sub">
            Goods, services, and things people are looking for.
            Trust the trader, not the platform.
          </p>
        )}
      </header>

      {/* Action chips: search & list something, then the offer-mode filters */}
      <ScrollHintRow className="mkt__actions h-scroll" role="toolbar" ariaLabel="Marketplace tools and filters" gutter>
        <button
          className={'mkt__action' + (showSearch ? ' is-active' : '')}
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
          <span className="mkt__action-label">Search</span>
        </button>
        <button className="mkt__action" onClick={() => navigate(`/compose?area=marketplace${space ? `&space=${space}` : ''}`)}>
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
          <span className="mkt__action-label">List</span>
        </button>
        <div className="mkt__action-spacer" />
        {/* The featured door: entrust your offering to the routing — ideally
            the algorithm does better than any of us could alone. */}
        <button
          className="mkt__action mkt__action--lichen"
          onClick={() => navigate(`/compose?area=marketplace&entrust=1${space ? `&space=${space}` : ''}`)}
          title="Offer something and let Lichen route it where it's needed most"
        >
          <span className="mkt__action-circle"><LichenMark size={22} label="" /></span>
          <span className="mkt__action-label">Lichen</span>
        </button>
        {MODES.map((m) => (
          <button
            key={m.chip}
            className={'mkt__action' + (activeChips.includes(m.chip) ? ' is-active' : '')}
            onClick={() => toggleChip(m.chip)}
          >
            <span className="mkt__action-circle"><Icon name={m.icon} size={14} /></span>
            <span className="mkt__action-label">{m.label}</span>
          </button>
        ))}
      </ScrollHintRow>

      {showSearch && (
        <div className="mkt__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="mkt__search-input"
            placeholder="Search listings — or use smart search for distance & trust"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="mkt__search-smartlink"
            onClick={() => navigate(`/search?area=marketplace${member ? `&member=${member}` : space ? `&space=${space}` : ''}`)}
          >
            <Icon name="sliders" size={12} /> Smart
          </button>
          {query && (
            <button className="mkt__search-clear" onClick={() => setQuery('')} aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {me && (
        <div className="mkt__trustlens" role="group" aria-label="Who you'll do business with">
          <Icon name="shield-user" size={14} />
          {([['any', 'Anyone'], ['second', 'Trusted by someone I trust'], ['mine', 'Someone I trust']] as const).map(([v, l]) => (
            <button key={v} className={'mkt__trustlens-chip' + (trustLens === v ? ' is-on' : '')}
              onClick={() => pickLens(v)}>{l}</button>
          ))}
        </div>
      )}

      <p className="mkt__count">
        <span className="mkt__count-n">{filtered.length}</span>{' '}
        {filtered.length === 1 ? 'listing' : 'listings'}
        <ViewToggle view={view} onChange={pickView} />
      </p>

      {!ready && <p className="mkt__empty-sub">Loading…</p>}
      {ready && filtered.length === 0 && (
        <div className="mkt__empty">
          <Icon name="store" size={20} />
          <p><span className="display-italic">Nothing here yet.</span></p>
          <p className="mkt__empty-sub">
            {posts.length === 0
              ? 'Be the first — tap List and offer something to the network.'
              : trustLens !== 'any'
              ? 'Nobody in your trust web is offering this yet — widen to Anyone, or weave more people in.'
              : 'Try clearing a filter or searching differently.'}
          </p>
        </div>
      )}

      {/* Browse: the photo-first grid — thumbs know this idiom already. */}
      {ready && view === 'browse' && filtered.length > 0 && (
        <section className="tile-grid">
          {filtered.map((p) => {
            const eyebrow = postToCard(p, me || undefined).eyebrow;
            const ov = overlays[p.id];
            return (
              <ListingTile
                key={p.id}
                post={p}
                offer={eyebrow === 'Mycelium' ? undefined : eyebrow}
                endorsed={!!ov && ((ov.trusted?.length ?? 0) + (ov.recommended?.length ?? 0) > 0)}
                trustLine={sellerLine(p.id)}
                onOpen={() => navigate(postOpenPath(p))}
                onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
              />
            );
          })}
        </section>
      )}

      {view === 'feed' && <section className="mkt__list">
        {filtered.map((p) => (
          <FeedCard
            trustLine={sellerLine(p.id)}
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
        <span className="eyebrow">End of market</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}
