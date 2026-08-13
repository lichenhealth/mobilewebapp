import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import { ScopeEscape, ScopeEmpty, ScopeMore } from '../components/ScopeEscape';
import { useActing } from '../acting/ActingProvider';
import { possessive } from '../lib/names';
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
import { loadTrustWeb, loadTrustEdgesFor, trustPathTo, namesFor, type TrustWeb } from '../lib/trustPath';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import ViewToggle from '../components/ViewToggle';
import { supabase } from '../lib/supabase';
import { webAuthorFilter } from '../lib/myceliumApi';
import { loadFeed, loadAuthorFeed, deletePost, postAreas, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend, recommendKey,
} from '../lib/myceliumApi';
import './Marketplace.css';
import AssistantDoor from '../components/AssistantDoor';
import { loadSpaceNames } from '../lib/postsApi';
import type { SearchCriteria, OfferKind } from '../lib/smartSearch';

// Same shared chunk as /search (see SmartSearch.tsx) — Marketplace is the
// pilot section embedding it inline instead of navigating away (founder
// 2026-08-09: "all search should be smart search").
const SmartSearchCore = lazy(() => import('../components/SmartSearchCore'));

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
  { chip: 'borrow',     label: 'Borrow',      icon: 'repeat' },
  { chip: 'sale',       label: 'For Sale',    icon: 'dollar' },
  { chip: 'iso',        label: 'ISO',         icon: 'search' },
];
const ALL_CHIPS: Chip[] = MODES.map((m) => m.chip);

const ALL_MODES: Mode[] = ['gift', 'trade', 'rent', 'lend', 'borrow', 'sale', 'sliding', 'iso'];
const MODE_ICON: Record<Mode, IconName> = {
  gift: 'heart-line', trade: 'trade', rent: 'rent', lend: 'lend',
  borrow: 'repeat', sale: 'dollar', sliding: 'dollar', iso: 'search',
};
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
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());
  const { promptSaved, openPicker } = useCollect();
  // YOU'RE ALWAYS A PARTICIPANT, EVEN AS AN ORG (founder 2026-08-13: "I want
  // to be able to participate in the lichen marketplace as countryman
  // stables"). Recommending is a public voice, so it can be the space's —
  // setRecommend has taken asSpace since 2026-08-06 and this simply never
  // passed it. TRUST STAYS PERSONAL: a space has no shield to give, by
  // doctrine, so the shield keeps speaking for the human behind the hat.
  const { actor } = useActing();
  const asSpace = actor.type === 'space' ? actor.id : undefined;
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  // Provenance names: the spaces these posts were routed into.
  useEffect(() => {
    const ids = posts.flatMap((p) => p.audience_space_ids ?? []);
    if (!ids.length) { setSpaceNames(new Map()); return; }
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [posts]);
  const [ready, setReady] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [activeChips, setActiveChips] = useState<Chip[]>(ALL_CHIPS);   // lenses default all-on
  const [showSearch, setShowSearch] = useState(false);
  // Smart search takes over the results area while it has something to say
  // (a typed sentence, an active filter) — the normal grid/feed underneath
  // isn't "gone", just not what's showing; closing the search box returns to it.
  const [searchActive, setSearchActive] = useState(false);
  // Browse (photo-first tile grid) is the default; the trust-lens card feed
  // stays one toggle away. The choice sticks per device.
  const [view, setView] = useState<'browse' | 'feed'>(
    () => (localStorage.getItem('mkt-view') === 'feed' ? 'feed' : 'browse'));
  const pickView = (v: 'browse' | 'feed') => { setView(v); localStorage.setItem('mkt-view', v); };
  // THE SAFETY LENS (founder 2026-07-28): narrow the whole market to sellers
  // your web vouches for. Empty set ("Anyone") stays the default — the lens
  // is a choice, never a wall. Vocabulary is the trust ladder, viewer-relative
  // always. MULTI-SELECT (founder 2026-08-03): degrees stack — "someone I
  // trust" and "trusted by someone I trust" can both be on at once, even
  // though the latter already implies the former; comfort over strict logic.
  // NOT sticky (founder 2026-08-03): every visit to Marketplace starts at
  // Anyone — the lens is a within-visit narrowing, not a standing filter.
  type TrustLens = 'second' | 'mine' | 'rec-mine' | 'rec-second';
  const [trustLenses, setTrustLenses] = useState<Set<TrustLens>>(new Set());
  const toggleLens = (l: TrustLens) => {
    setTrustLenses((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l); else next.add(l);
      return next;
    });
  };
  const clearLenses = () => setTrustLenses(new Set());
  const [web, setWeb] = useState<TrustWeb | null>(null);
  // Category dropdowns (founder 2026-07-28, Figma 286-3905): the composer's
  // pickers as FILTERS — goods, services, places & spaces. A listing passes
  // when its tags intersect, or its words name the category (untagged
  // listings aren't invisible just because tagging is new).
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [catFilter, setCatFilter] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void supabase.from('categories').select('*').order('sort')
      .then(({ data }) => { if (live) setAllCats((data as Category[] | null) ?? []); });
    return () => { live = false; };
  }, []);
  const [viaNames, setViaNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadTrustWeb(me).then(async (w) => {
      // mycelium's RLS only returns MY OWN edges now — the 2-hop "trusted
      // by someone I trust" check needs the sellers' own edges too, fetched
      // for exactly these posts' authors, not a whole-graph read.
      const targets = posts.filter((p) => !p.author_space_id)
        .map((p) => ({ type: 'profile' as const, id: p.author_id }));
      const extra = await loadTrustEdgesFor(targets);
      if (live) setWeb({ ...w, edges: [...w.edges, ...extra] });
    });
    return () => { live = false; };
  }, [me, posts]);
  // Seller paths, viewer-relative: postId → my path to its author.
  const sellerPaths = useMemo(() => {
    if (!web) return new Map<string, { degree: 'mine' | 'second'; via: string | null }>();
    const m = new Map<string, { degree: 'mine' | 'second'; via: string | null }>();
    for (const p of posts) {
      // Trust stays person-only (founder 2026-08-07) — a space-authored
      // post has no trust path, only its author (a person) can.
      if (p.author_space_id) continue;
      const hit = trustPathTo(web, 'profile', p.author_id);
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
  // Recommend lens: who recommended THIS post (not its author), narrowed to
  // recommenders inside my trust web — mirrors sellerPaths but for the
  // recommendations table instead of authorship.
  const [postRecommenders, setPostRecommenders] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    if (!posts.length) { setPostRecommenders(new Map()); return; }
    let live = true;
    const ids = posts.map((p) => p.id);
    void supabase.from('recommendations').select('recommender_id, target_id')
      .eq('target_type', 'post').in('target_id', ids)
      .then(({ data }) => {
        if (!live) return;
        const m = new Map<string, string[]>();
        for (const r of (data ?? []) as { recommender_id: string; target_id: string }[]) {
          const arr = m.get(r.target_id) ?? [];
          arr.push(r.recommender_id);
          m.set(r.target_id, arr);
        }
        setPostRecommenders(m);
      });
    return () => { live = false; };
  }, [posts]);
  const recPaths = useMemo(() => {
    const m = new Map<string, { degree: 'mine' | 'second' }>();
    if (!web) return m;
    for (const [postId, ids] of postRecommenders) {
      let best: { degree: 'mine' | 'second' } | null = null;
      for (const rid of ids) {
        const hit = trustPathTo(web, 'profile', rid);
        if (hit?.degree === 'mine') { best = { degree: 'mine' }; break; }
        if (hit && !best) best = { degree: 'second' };
      }
      if (best) m.set(postId, best);
    }
    return m;
  }, [web, postRecommenders]);

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const raw = member ? await loadAuthorFeed({ profileId: member })
        : space ? await loadAuthorFeed({ spaceId: space })
        : await loadFeed(200);
      let feed = raw.filter((p) => postAreas(p).includes('marketplace'));
      // ?web=1 — you came here from My-celium; stay in it (founder 2026-08-07).
      if (params.get('web') === '1') {
        const inWeb = await webAuthorFilter();
        feed = feed.filter(inWeb);
      }
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
    if (catFilter.length) {
      const wantedCats = allCats.filter((c) => catFilter.includes(c.id));
      list = list.filter((p) => {
        const tagged = Array.isArray(p.details?.categories)
          ? (p.details.categories as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        if (tagged.some((t) => catFilter.includes(t))) return true;
        const hay = `${p.title ?? ''} ${p.body}`.toLowerCase();
        return wantedCats.some((c) => hay.includes(c.name.toLowerCase()));
      });
    }
    if (trustLenses.size > 0) {
      list = list.filter((p) => {
        if (trustLenses.has('mine') && (p.author_id === me || sellerPaths.get(p.id)?.degree === 'mine')) return true;
        if (trustLenses.has('second') && (p.author_id === me || sellerPaths.get(p.id))) return true;
        if (trustLenses.has('rec-mine') && recPaths.get(p.id)?.degree === 'mine') return true;
        if (trustLenses.has('rec-second') && recPaths.get(p.id)) return true;
        return false;
      });
    }
    return list;
  }, [posts, activeChips, trustLenses, sellerPaths, recPaths, me, catFilter, allCats]);

  const toggleChip = (c: Chip) =>
    setActiveChips((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  // Fold the current filter row into smart search so opening it doesn't
  // silently drop what you'd already narrowed to. All-chips-active is the
  // default (no filter) — same "don't seed a non-filter" rule merge() uses
  // for categoryIds:'all'.
  const searchSeed = useMemo((): Partial<SearchCriteria> => {
    const seed: Partial<SearchCriteria> = {};
    if (activeChips.length > 0 && activeChips.length < ALL_CHIPS.length) {
      seed.offers = [...new Set(activeChips.flatMap((c) =>
        CHIP_MODES[c].map((m) => (m === 'sale' || m === 'sliding' ? 'buy' : m) as OfferKind)))];
    }
    if (catFilter.length) seed.categories = allCats.filter((c) => catFilter.includes(c.id));
    // Broader degree wins when both are on — 'second' already includes 'mine'.
    if (trustLenses.has('second')) seed.trust = { degree: 'second', personId: null };
    else if (trustLenses.has('mine')) seed.trust = { degree: 'mine', personId: null };
    if (trustLenses.has('rec-second')) seed.rec = { degree: 'second', personId: null };
    else if (trustLenses.has('rec-mine')) seed.rec = { degree: 'mine', personId: null };
    return seed;
  }, [activeChips, catFilter, allCats, trustLenses]);

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
          {/* A filtered Marketplace is still the Marketplace — the way to
              the whole of it sits left of the mark (founder 2026-08-11). */}
          {scoped && <ScopeEscape to="/market" label="Go to Lichen Marketplace" />}
          <Icon name="store" size={11} />
          <span>Marketplace</span>
        </p>
        <h1 className="mkt__title">
          {scoped
            ? <>{possessive(scopeName)} <span className="display-italic">Marketplace</span></>
            : <>What members are <span className="display-italic">offering &amp; seeking.</span></>}
        </h1>
        {!scoped && (
          <p className="mkt__sub">
            Goods, services, and things people are looking for.
            Trust the trader, not the platform.
          </p>
        )}
      </header>

      {/* THE DOORS — icon-only (founder 2026-08-08), the same vocabulary Home's
          row and the area feeds already speak. Search, post and the brain are
          the platform's three constant doors; they don't need naming on every
          screen. The lenses live on their own line below. */}
      <ScrollHintRow className="mkt__actions mkt__actions--doors h-scroll" role="toolbar" ariaLabel="Marketplace tools" gutter>
        <button
          className={'mkt__action mkt__action--door' + (showSearch ? ' is-active' : '')}
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setSearchActive(false); }}
          aria-label="Search" title="Search"
        >
          <span className="mkt__action-circle"><Icon name="search" size={14} /></span>
        </button>
        <button className="mkt__action mkt__action--door"
          onClick={() => navigate(`/compose?area=marketplace${space ? `&space=${space}` : ''}`)}
          aria-label="List something" title="List something">
          <span className="mkt__action-circle"><Icon name="plus" size={14} /></span>
        </button>
        <div className="mkt__action mkt__action--door mkt__action--assistant">
          <AssistantDoor section="market" size={30} label="Your assistant — offers, seeks, and what moved" />
        </div>
        {/* The featured door: entrust your offering to the routing — ideally
            the algorithm does better than any of us could alone. It sits with
            the DOORS now, not among the lenses: it composes something, it
            doesn't narrow what you're looking at. */}
        <button
          className="mkt__action mkt__action--door mkt__action--lichen"
          onClick={() => navigate(`/compose?area=marketplace&entrust=1${space ? `&space=${space}` : ''}`)}
          aria-label="Offer something and let Lichen route it"
          title="Offer something and let Lichen route it where it's needed most"
        >
          <span className="mkt__action-circle"><LichenMark size={22} label="" /></span>
        </button>
      </ScrollHintRow>

      {/* The lens band, on its own line: the doors were eating half a phone's
          width, and a word is wider than a circle — sharing one row left a
          single lens visible before the chevron. Own line, full width, ~5
          visible. */}
      <ScrollHintRow className="mkt__lensrow h-scroll" role="toolbar" ariaLabel="Modes of exchange" gutter>
        {MODES.map((m) => {
          const on = activeChips.includes(m.chip);
          return (
            <button
              key={m.chip}
              className={'mkt__lens' + (on ? ' is-on' : '')}
              onClick={() => toggleChip(m.chip)}
              aria-pressed={on}
              title={on ? `Showing ${m.label.toLowerCase()} — tap to hide` : `Tap to show ${m.label.toLowerCase()}`}
            >
              <Icon name={m.icon} size={16} />
              {m.label}{on ? ' ✓' : ''}
            </button>
          );
        })}
      </ScrollHintRow>

      {showSearch && (
        <Suspense fallback={<p className="mkt__empty-sub">Loading search…</p>}>
          <SmartSearchCore
            embedded
            scopeIsSignal={false}
            scope={{ area: 'marketplace', memberId: member, spaceId: space }}
            scopeLabel={scopeName || undefined}
            seed={searchSeed}
            assistantSection="market"
            placeholder="Search listings — try distance, trust, or a category…"
            onActiveChange={setSearchActive}
          />
        </Suspense>
      )}

      <div className="mkt__filters">
        <div className="mkt__cats">
          {(['good', 'service', 'place'] as const).map((d) => (
            allCats.some((c) => c.domain === d) && (
              <CategoryPicker key={d} domain={d} categories={allCats}
                selected={catFilter} onChange={setCatFilter} compact />
            )
          ))}
        </div>
        {me && (
          <div className="mkt__trustlens" role="group" aria-label="Who you'll do business with">
            <button className={'mkt__trustlens-chip' + (trustLenses.size === 0 ? ' is-on' : '')}
              onClick={clearLenses}>Anyone</button>
            {([
              ['mine', 'Trusted (1st)', 'Someone you trust, directly'],
              ['second', 'Trusted (2nd)', 'Trusted by someone you trust'],
              ['rec-mine', 'Recommended (1st)', 'Recommended by someone you trust'],
              ['rec-second', 'Recommended (2nd)', 'Recommended by someone trusted by someone you trust'],
            ] as const).map(([v, l, title]) => {
              const on = trustLenses.has(v);
              return (
                <button key={v} className={'mkt__trustlens-chip' + (on ? ' is-on' : '')}
                  onClick={() => toggleLens(v)} title={title}>{l}{on ? ' ✓' : ''}</button>
              );
            })}
          </div>
        )}
      </div>

      {/* Smart search takes the results area over while it's active — the
          grid/feed below isn't gone, just not what's showing right now. */}
      {!searchActive && <>
      <p className="mkt__count">
        <span className="mkt__count-n">{filtered.length}</span>{' '}
        {filtered.length === 1 ? 'listing' : 'listings'}
        <ViewToggle view={view} onChange={pickView} />
      </p>

      {!ready && <p className="mkt__empty-sub">Loading…</p>}
      {ready && filtered.length === 0 && scoped && posts.length === 0 && (
        <ScopeEmpty
          icon="store"
          section="Marketplace"
          who={scopeName || 'them'}
          to="/market"
          label="Visit the Lichen Marketplace"
        />
      )}
      {ready && filtered.length === 0 && !(scoped && posts.length === 0) && (
        <div className="mkt__empty">
          <Icon name="store" size={20} />
          <p><span className="display-italic">Nothing here yet.</span></p>
          <p className="mkt__empty-sub">
            {posts.length === 0
              ? 'Be the first — tap List and offer something to the network.'
              : trustLenses.size > 0
              ? 'Nobody in your trust web is offering this yet — widen to Anyone, or weave more people in.'
              : 'Try clearing a filter or searching differently.'}
          </p>
        </div>
      )}

      {/* Browse: the photo-first grid — thumbs know this idiom already. */}
      {ready && view === 'browse' && filtered.length > 0 && (
        <section className="tile-grid">
          {filtered.map((p) => {
            const eyebrow = postToCard(p, me || undefined, spaceNames).eyebrow;
            const ov = overlays[p.id];
            return (
              <ListingTile
                key={p.id}
                post={p}
                offer={eyebrow === 'Mycelium' ? undefined : eyebrow}
                endorsed={!!ov && ((ov.trusted?.length ?? 0) + (ov.recommended?.length ?? 0) > 0)}
                trustLine={sellerLine(p.id)}
                modeIcons={[...new Set(postModes(p).map((m) => MODE_ICON[m]))]}
                recommended={myRecs.has(recommendKey('post', p.id, undefined, asSpace))}
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
            {...postToCard(p, me || undefined, spaceNames)}
            {...weaveProps(p, myWebSet, me || undefined)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has(recommendKey('post', p.id, undefined, asSpace))}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on, undefined, asSpace).catch(console.error); }}
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

      {/* A thin shelf gets the same pointer as a bare one — under the
          results, never instead of them (founder 2026-08-13). */}
      {ready && scoped && (
        <ScopeMore
          count={filtered.length}
          section="Marketplace"
          who={scopeName || 'they'}
          to="/market"
          label="Browse the Lichen Marketplace"
        />
      )}

      <footer className="mkt__end">
        <span className="eyebrow">End of market</span>
        <Icon name="sparkle" size={14} />
      </footer>
      </>}
    </div>
  );
}
