import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import IconRow, { IconRowItem } from '../components/IconRow';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { Icon, type IconName } from '../components/Icon';
import InstallPrompt from '../components/InstallPrompt';
import { loadFeed, loadAuthorFeed, deletePost, postAreas, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { ensureDirectChat, chatPathForPost } from '../lib/chatApi';
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
import { spacePresentCount, availableList } from '../lib/presenceApi';

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
/** TWO TIERS (founder 2026-08-13). PRESENT is here-this-minute: candle lit
 *  and Lichen in front of you. AVAILABLE is your published SOCIAL hours minus
 *  what's booked — it asks nothing of you at the time, which is the point
 *  ("I just want people to be offline as much as possible, but be able to
 *  signal when they're available"). Work hours are a booking concern and
 *  deliberately never reach this line: Home is for connection, not commerce.
 *
 *  The word "awake" is retired — it read as either enlightened or asleep,
 *  and neither is what being off Lichen means.
 *
 *  Acting as a space, the count is that space's own members (present only —
 *  a space doesn't publish hours, its members do).
 */
function presenceLine(present: number | null, available: number, whose: string | null): string {
  if (present === null) return 'Welcome back.';
  const where = whose ?? 'your network';
  const n = (x: number) => NUMBER_WORDS[x] ?? String(x);
  const isAre = (x: number) => (x === 1 ? 'is' : 'are');
  if (present && available) {
    return `${n(present)} ${isAre(present)} present and ${n(available).toLowerCase()} ${isAre(available)} available.`;
  }
  if (present) return `${n(present)} in ${where} ${isAre(present)} present.`;
  if (available) return `${n(available)} in ${where} ${isAre(available)} available.`;
  // The state itself is named ELSEWHERE (founder 2026-08-14) — the third of
  // present / available / elsewhere. The greeting renders it as "out living":
  // nobody here is a GOOD sign (founder 2026-08-13: "they are out in the
  // world living their lives... we want Lichen to be a utility for healthy,
  // real engagement in the world, not a social network that's addictive").
  // "Resting" implied being here was the natural state and everyone had
  // lapsed from it — the addictive-network frame, the same trap "awake" was.
  return whose ? `${whose} is out living.` : 'Your network is out living.';
}

// THE STACKED ROWS — the brain feed's shape as the overall UI (founder
// 2026-10-12, three passes in one sitting: "I really like this UI, Let's
// make this the overall UI and then have multiple rows for the subsection
// icons… instead of a scroll"): tools first on their own line, then the
// section icons below, wrapping to as many rows as they need.
const TOOL_ICONS: IconRowItem[] = [
  { icon: 'search', label: 'Search', to: '/search' },
  { icon: 'plus',   label: 'Post',   to: '/compose' },
  // Searching, posting, and thinking-with are one family (founder 2026-07-28).
  { icon: 'brain',  label: 'Assistant', to: '/assistant?section=home',
    variant: 'icon-row__btn--ai' },
];
// THE SECTIONS ARE FEED LENSES NOW, MULTI-SELECT (founder 2026-10-12:
// "feed being 'all' but clicking on sub sections as filtering the feed to
// only those subsections… allow you to select or de-select multiple. E.G.
// feed itself means everything, but you click marketplace and feed (all)
// gets de-selected. Then, you can also select Travel, Courses, etc, so
// multiple are lit up" — the Maps-layer grammar, on Home's river): each
// carries its service_area for the filter AND its room for the quiet
// "Open «Section» ›" door that keeps the full rooms one tap away.
export const FEED_LENSES: { icon: IconName; label: string; area: string; room: string }[] = [
  { icon: 'store',          label: 'Marketplace', area: 'marketplace', room: '/market'  },
  { icon: 'rsvp',           label: 'Events',      area: 'events',      room: '/events'  },
  { icon: 'briefcase',      label: 'Work',        area: 'work',        room: '/work'    },
  { icon: 'graduation-cap', label: 'Education',   area: 'courses',     room: '/courses' },
  { icon: 'fork-spoon',     label: 'Food',        area: 'food',        room: '/food'    },
  { icon: 'palette',        label: 'Creative',    area: 'art',         room: '/art'     },
  { icon: 'location',       label: 'Places',      area: 'places',      room: '/places'  },
  { icon: 'plane',          label: 'Travel',      area: 'travel',      room: '/travel'  },
  { icon: 'book',           label: 'Library',     area: 'library',     room: '/library' },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const { actor, ready: actingReady } = useActing();

  // One rule for every feed's chat door (founder 2026-08-17): a post in a
  // space's voice opens the conversation WITH that space, answered by the
  // admin who wrote it; a personal post opens the DM. The post rides along.
  async function messageAbout(post: { id: string; author_id: string; author_space_id?: string | null }) {
    try { navigate(await chatPathForPost(post)); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [shareTarget, setShareTarget] = useState<FeedPost | null>(null);
  const [tab, setTab] = useState('All');
  // The lit lenses — empty = Feed/All (founder 2026-10-12, multi-select).
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());
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
  const [present, setPresent] = useState<number | null>(null);
  const [available, setAvailable] = useState(0);

  // THE FEED FOLLOWS THE HAT (founder 2026-08-22, the FB-mode decision —
  // reversing 2026-08-10's personal-feed-while-acting call): wearing a
  // space's hat, Home is the SPACE's stream — what its page shows — and
  // your own river waits a hat-switch away. Waits for the persisted hat to
  // restore (the actor-branch rule) so it never paints the wrong feed.
  useEffect(() => {
    if (!actingReady) return;
    let live = true;
    (async () => {
      const feed = actor.type === 'space'
        ? await loadAuthorFeed({ spaceId: actor.id })
        : await loadFeed(50, { river: true });
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([
        loadMyWeb(), loadMyRecommendations(), loadMySaved(),
      ]);
      const ov = await loadEndorsements(feed, { web, vouched: myc });
      if (!live) return;
      // Set posts last so cards mount once, with engagement state already in hand.
      setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
    return () => { live = false; };
  }, [actingReady, actor]);

  // Presence follows whoever you're acting as — its own effect so switching
  // hats re-counts without refetching the whole feed (which stays personal,
  // deliberately — see the note above).
  useEffect(() => {
    let live = true;
    void (actor.type === 'space'
      ? spacePresentCount(actor.id)
      : supabase.rpc('network_present_count').then((r) => (r.data as number | null) ?? null)
    ).then((n: number | null) => { if (live) setPresent(n ?? null); });
    // Availability is personal — a space doesn't publish social hours.
    if (actor.type === 'space') setAvailable(0);
    else void availableList().then((rows) => { if (live) setAvailable(rows.length); });
    return () => { live = false; };
  }, [actor]);

  return (
    <div className="home">
      {/* The Member view | Admin view pair is RETIRED (founder 2026-09-26:
          "get rid of admin view altogether") — the side menu shows desk
          work inline now, no mode to flip. */}
      <IconRow
        className="icon-row--tools"
        ariaLabel="Tools"
        items={TOOL_ICONS.map((it) => (it.label === 'Assistant'
          ? { ...it, variant: `icon-row__btn--ai${aiDoorOn('home') ? '' : ' ai-off'}` }
          : it))}
      />
      {/* Feed = ALL; the sections light as multi-select lenses on the river
          (founder 2026-10-12). Members stays a DOOR — people aren't posts,
          there's nothing of theirs to filter the feed by. */}
      <IconRow
        className="icon-row--lenses"
        ariaLabel="Feed lenses"
        items={[
          { icon: 'newsfeed', label: 'Feed',
            variant: areaSel.size === 0 ? 'icon-row__btn--here' : undefined },
          ...FEED_LENSES.map((l) => ({
            icon: l.icon, label: l.label,
            variant: areaSel.has(l.area) ? 'icon-row__btn--here' : undefined,
          })),
          { icon: 'member-heart', label: 'Members', to: '/directory' },
        ]}
        onSelect={(label) => {
          if (label === 'Feed') { setAreaSel(new Set()); return; }
          const lens = FEED_LENSES.find((l) => l.label === label);
          if (!lens) return;
          setAreaSel((cur) => {
            const next = new Set(cur);
            if (next.has(lens.area)) next.delete(lens.area); else next.add(lens.area);
            return next;
          });
        }}
      />

      {/* The lit section owns the band beneath it. */}
      <FilterRow options={FILTERS} value={tab} onChange={setTab} />

      {/* The full rooms stay one tap away while filtering (the lenses used
          to BE the doors — never strand someone outside Marketplace). */}
      {areaSel.size > 0 && (
        <p className="lensdoors">
          {FEED_LENSES.filter((l) => areaSel.has(l.area)).map((l) => (
            <button key={l.area} className="lensdoor" onClick={() => navigate(l.room)}>
              <span className="link-cue">Open {l.label}</span> ›
            </button>
          ))}
        </p>
      )}

      <section className="home__greeting">
        <h1 className="home__title">
          <span className="display-italic">{salutation()}</span>{' '}
          {user ? (
            // The doorway opens WHAT THE LINE COUNTS. As yourself: your web
            // (network_present_count) → My-celium. Acting as a space: the
            // space's MEMBERS present (space_present_count) → its Members tab,
            // present-first. The 2026-08-13 choice to send a space to its web
            // read as a bug once seen live (founder 2026-08-18: "says 1 in my
            // network is present… then gives me a blank mycelium screen") —
            // the count and the door disagreed. A door must open on the
            // people it counted.
            <button className="display home__presence" onClick={() => navigate(
              actor.type === 'space' ? `/spaces/${actor.id}?tab=members` : '/mycelium/directory?from=home')}>
              {presenceLine(present, available, actor.type === 'space' ? actor.name : null)}
              <span className="home__presence-chev" aria-hidden><Icon name="chevron-right" size={16} /></span>
            </button>
          ) : (
            <span className="display">{presenceLine(present, available, actor.type === 'space' ? actor.name : null)}</span>
          )}
        </h1>
        {/* The creed — captions the presence doorway it explains. */}
        <p className="home__creed">Being present is a gift.</p>
      </section>

      {/* IN THE PAGE, NOT OVER IT (founder 2026-08-17). It was fixed above the
          bottom nav on every route, so it sat on top of whatever you were
          reading — two marketplace tiles, in the case that surfaced it. Here
          it scrolls with the page, covers nothing, and asks once where you
          land rather than following you around the app. Below the greeting,
          not above it: the greeting is what Home is for. */}
      <InstallPrompt />


      <section className="home__feed">
        {/* The lenses narrow by service_areas — several lit means ANY of
            them (founder 2026-10-12); no lenses lit means the whole river. */}
        {posts.filter((p) => matchesTab(tab, p.content_type)
          && (areaSel.size === 0 || postAreas(p).some((a) => areaSel.has(a)))).map((p) => (
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
            onShareToClaude={user ? () => setShareTarget(p) : undefined}
            viewerIsAuthor={p.author_id === user?.id}
            onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onMessage={p.author_id !== user?.id ? () => messageAbout(p) : undefined}
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
