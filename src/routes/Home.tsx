import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminViewToggle from '../components/AdminViewToggle';
import FilterRow from '../components/FilterRow';
import { useAdminView } from '../lib/adminView';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { Icon } from '../components/Icon';
import { loadFeed, deletePost, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { ensureDirectChat } from '../lib/chatApi';
import ShareToClaudeSheet from '../components/ShareToClaudeSheet';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './Home.css';
import { aiDoorOn } from '../components/AssistantDoor';
import { loadSpaceNames } from '../lib/postsApi';
import { useActing } from '../acting/ActingProvider';
import { spaceAwakeCount } from '../lib/presenceApi';

// THE FEED'S OWN BAND (founder 2026-08-08, restoring the trio deliberately:
// "we may replace that later with more or different filters"). It sits under
// the section switcher — the lit icon owns the row beneath it — and unlike
// every version before this one it actually FILTERS: it was uncontrolled and
// purely decorative from the day it shipped until 2026-08-07, which is why
// nobody noticed it did nothing. Legacy creative/educational/qa read as
// Social; only 'actionable' is its own side.
const FILTERS = ['All', 'Social', 'Actionable'];
const matchesTab = (tab: string, ct: string): boolean =>
  tab === 'All' || (tab === 'Actionable' ? ct === 'actionable' : ct !== 'actionable');

// The greeting tells the truth now (founder, 2026-07-16): a time-aware
// salutation + the real count of network members active in the last 12 hours.
function salutation(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning.';
  if (h < 17) return 'Good afternoon.';
  if (h < 22) return 'Good evening.';
  return 'Good night.';
}
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/** PRESENT, NOT MERELY ONLINE (founder 2026-08-13): a lit candle says "I'm
 *  open to live engagement", and that's the only thing this counts now —
 *  being online was never something anyone chose. network_awake_count() is
 *  YOUR network: your my-celium plus those you share a space with, never the
 *  whole of Lichen. Acting as a space, the count and the words switch to that
 *  space's own members (space_awake_count) — the per-space query the
 *  2026-08-06 note asked for before the label could honestly change. */
function awakeLine(n: number | null, whose: string | null): string {
  if (n === null) return 'Welcome back.';
  const where = whose ?? 'your network';
  if (n === 0) return whose ? `${whose} is resting.` : 'Your network is resting.';
  if (n === 1) return `One in ${where} is present.`;
  return `${NUMBER_WORDS[n] ?? n} in ${where} are present.`;
}

const CATEGORY_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search',      to: '/search' },
  { icon: 'plus',           label: 'Post',        to: '/compose' },
  // Searching, posting, and thinking-with are one family (founder 2026-07-28).
  // Same size as the magnifier and the + beside it (founder 2026-08-08) —
  // size is reserved for "you are here" now; peach alone says "switched on".
  { icon: 'brain',          label: 'Assistant',   to: '/assistant?section=home',
    variant: 'icon-row__btn--ai' },
  // THE SECTION YOU'RE STANDING IN, LIT (founder 2026-08-07: "add a newsfeed
  // icon to the right... orange, signifying that's what you're on, the
  // newspaper of that space. Then you can toggle over to marketplace, or work").
  // The row was already a set of doors; naming the one you're already through
  // turns it into a section switcher you can read at a glance.
  { icon: 'newsfeed',       label: 'Feed',        to: '/home',
    variant: 'icon-row__btn--here', divider: true },
  { icon: 'store',          label: 'Marketplace', to: '/market' },
  { icon: 'rsvp',           label: 'Events',      to: '/events'        },
  { icon: 'briefcase',      label: 'Work',        to: '/work'          },
  { icon: 'graduation-cap', label: 'Education',   to: '/courses'       },
  { icon: 'fork-spoon',     label: 'Food',        to: '/food'          },
  { icon: 'palette',        label: 'Creative',    to: '/art'           },
  { icon: 'location',       label: 'Places',      to: '/places'        },
  { icon: 'plane',          label: 'Travel',      to: '/travel'        },
  { icon: 'book',           label: 'Library',     to: '/library'       },
  { icon: 'member-heart',   label: 'Members',     to: '/directory'     },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const adminView = useAdminView();
  const { promptSaved, openPicker } = useCollect();
  const { actor } = useActing();

  async function messageAuthor(authorId: string, aboutPostId?: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}${aboutPostId ? `?about=${aboutPostId}` : ''}`); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [shareTarget, setShareTarget] = useState<FeedPost | null>(null);
  const [tab, setTab] = useState('All');
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());

  // Provenance names: the spaces these posts were routed into.
  useEffect(() => {
    const ids = posts.flatMap((p) => p.audience_space_ids ?? []);
    if (!ids.length) { setSpaceNames(new Map()); return; }
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [posts]);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [awake, setAwake] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const feed = await loadFeed(50, { river: true });
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([
        loadMyWeb(), loadMyRecommendations(), loadMySaved(),
      ]);
      const ov = await loadEndorsements(feed, myc);
      // Set posts last so cards mount once, with engagement state already in hand.
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
  }, []);

  // Presence follows whoever you're acting as — its own effect so switching
  // hats re-counts without refetching the whole feed (which stays personal,
  // deliberately — see the note above).
  useEffect(() => {
    let live = true;
    void (actor.type === 'space'
      ? spaceAwakeCount(actor.id)
      : supabase.rpc('network_awake_count').then((r) => (r.data as number | null) ?? null)
    ).then((n) => { if (live) setAwake(n ?? null); });
    return () => { live = false; };
  }, [actor]);

  return (
    <div className={'home' + (adminView ? ' is-adminview' : '')}>
      {/* Lichen's own Member view | Admin view — the same pair a space page
          carries, in the same place (founder 2026-08-08). Here it means
          stewarding the platform itself. */}
      <AdminViewToggle />

      <IconRow items={CATEGORY_ICONS.map((it) => (it.label === 'Assistant'
        ? { ...it, variant: `icon-row__btn--ai${aiDoorOn('home') ? '' : ' ai-off'}` }
        : it))} />

      {/* The lit section owns the band beneath it. */}
      <FilterRow options={FILTERS} value={tab} onChange={setTab} />

      <section className="home__greeting">
        <h1 className="home__title">
          <span className="display-italic">{salutation()}</span>{' '}
          {user ? (
            // The doorway: present members lead a WEB — yours as yourself,
            // and the space's own while you're acting as one (founder
            // 2026-08-13: "have the network tagline go... to Countryman
            // Stable's mycelium"). One destination again now that a space
            // has a web of its own and My-celium no longer bounces.
            <button className="display home__awake" onClick={() => navigate('/mycelium/directory?from=home')}>
              {awakeLine(awake, actor.type === 'space' ? actor.name : null)}
              <span className="home__awake-chev" aria-hidden><Icon name="chevron-right" size={16} /></span>
            </button>
          ) : (
            <span className="display">{awakeLine(awake, actor.type === 'space' ? actor.name : null)}</span>
          )}
        </h1>
        {/* The creed — captions the presence doorway it explains. */}
        <p className="home__creed">Being present is a gift.</p>
      </section>

      <section className="home__feed">
        {posts.filter((p) => matchesTab(tab, p.content_type)).map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, user?.id, spaceNames)}
            {...weaveProps(p, myWebSet, user?.id)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has('post:' + p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: p.author_id !== user?.id }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
            saved={mySaves.has('post:' + p.id)}
            onSave={(on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); }}
            extraMenuItems={user ? [
              { label: 'Add to collection…', onClick: () => openPicker(p.id) },
              { label: 'Share to Claude', onClick: () => setShareTarget(p) },
            ] : undefined}
            viewerIsAuthor={p.author_id === user?.id}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onMessage={p.author_id !== user?.id ? () => messageAuthor(p.author_id, p.id) : undefined}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
          />
        ))}
      </section>

      <footer className="home__end">
        <span className="eyebrow">All caught up</span>
        <Icon name="sparkle" size={14} />
      </footer>

      <ShareToClaudeSheet post={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
