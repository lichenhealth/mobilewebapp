import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import FeedCard, { FeedCardProps } from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { loadFeed, deletePost, postAreas, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import { ensureDirectChat, chatPathForPost } from '../lib/chatApi';
import ShareToClaudeSheet from '../components/ShareToClaudeSheet';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setRecommend, posterTrustKey, trustPostPoster,
} from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import IconRow, { IconRowItem } from '../components/IconRow';
import { FEED_LENSES } from './Home';
import { aiDoorOn } from '../components/AssistantDoor';
import './Mycelium.css';
import { loadSpaceNames } from '../lib/postsApi';

// ENTITY-KIND CHIPS RETIRED (founder 2026-08-07: "they create clutter and
// people can use the search filters if they want to"). Home never had them, so
// the two feeds now read the same; the kinds live on in search's Who filter,
// which is where narrowing by kind actually belongs. Legacy /mycelium/<kind>
// deep links land on the unfiltered feed rather than filtering invisibly.

// THE FEED'S BAND, same as Lichen's (founder 2026-08-08) — My-celium IS the
// home feed narrowed to your web, so it reads the same and filters the same.
// ⚠ The AREA filtering that used to live here stays gone: it required every
// post to carry a service area, so a plain social post from your web never
// appeared in My-celium at all.
const FILTERS = ['All', 'Social', 'Actionable'];

// Your web's own tools, then the sections as FEED LENSES — mirrors Home
// exactly (founder 2026-10-12, one vocabulary: tools first, sections below
// in wrapping rows, multi-select filtering the web's stream; Feed = all).
// The "Open «Section» ›" doors carry ?web=1 so a walk into the full room
// stays inside your web.
const MYC_TOOLS: IconRowItem[] = [
  { icon: 'search', label: 'Search', to: '/search' },
  { icon: 'plus',   label: 'Post',   to: '/compose' },
  { icon: 'brain',  label: 'Assistant', to: '/assistant?section=mycelium',
    variant: 'icon-row__btn--ai' },
];
type Item = {
  key: string;
  card: FeedCardProps;
  actionable: boolean;
  areas: string[];
};

export default function Mycelium() {
  const { user } = useAuth();
  const { actor } = useActing();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();

  // A space now HAS a web of its own (mycelium.truster_space_id, 2026-08-13),
  // so acting as one no longer bounces to its profile page — this reads that
  // space's web instead of the wrong person's.
  const asSpace = actor.type === 'space' ? actor.id : undefined;
  const { ready: actingReady } = useActing();

  // One rule for every feed's chat door (founder 2026-08-17): a post in a
  // space's voice opens the conversation WITH that space, answered by the
  // admin who wrote it; a personal post opens the DM. The post rides along.
  async function messageAbout(post: { id: string; author_id: string; author_space_id?: string | null }) {
    try { navigate(await chatPathForPost(post)); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  const [tab, setTab] = useState('All');
  // The lit lenses — empty = Feed/All (founder 2026-10-12, multi-select).
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [shareTarget, setShareTarget] = useState<FeedPost | null>(null);
  // Provenance names: the spaces these posts were routed into.
  useEffect(() => {
    const ids = posts.flatMap((p) => p.audience_space_ids ?? []);
    if (!ids.length) { setSpaceNames(new Map()); return; }
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [posts]);
  const [myWeb, setMyWeb] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    // ⚠ Wait for the hat (the acting-as rule): loading before the persisted
    // actor restores would read the PERSON's web for a beat and swap it.
    if (!actingReady) return;
    (async () => {
      const feed = await loadFeed(50, { river: true });
      const [{ web, vouched }, recs, saves] = await Promise.all([
        loadMyWeb(asSpace), loadMyRecommendations(), loadMySaved(),
      ]);
      const ov = await loadEndorsements(feed, { web, vouched });
      setMyWeb(web); setMyMyc(vouched); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
  }, [asSpace, actingReady]);

  // The feed: real posts from entities in your mycelium.
  const items = useMemo<Item[]>(() => {
    return posts
      // Authors in your WEB (person or the space they posted as — membership,
      // vouched or not) — and always your own posts, so what you share to your
      // mycelium shows in your own web.
      .filter((p) =>
        myWeb.has(posterTrustKey(p))
        || (p.author_space_id != null && myWeb.has('space:' + p.author_space_id))
        || p.author_id === user?.id)
      .map((p) => ({
        key: p.id,
        actionable: p.content_type === 'actionable',
        areas: postAreas(p),
        card: {
          ...postToCard(p, user?.id, spaceNames),
          ...weaveProps(p, myWeb, user?.id),
          trusted: myMyc.has(posterTrustKey(p)),
          recommended: myRecs.has('post:' + p.id),
          mycelium: overlays[p.id],
          availability: { trust: p.author_id !== user?.id },
          onTrust: (on: boolean) => { void trustPostPoster(p, on).catch(console.error); },
          onRecommend: (on: boolean) => { void setRecommend('post', p.id, on).catch(console.error); },
          saved: mySaves.has('post:' + p.id),
          onSave: (on: boolean) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); },
          onShareToClaude: user ? () => setShareTarget(p) : undefined,
          viewerIsAuthor: p.author_id === user?.id,
          onManage: p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined,
          onEdit: !p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined,
          onDelete: !p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onHide: user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onMessage: p.author_id !== user?.id ? () => messageAbout(p) : undefined,
          onOpen: () => navigate(postOpenPath(p)),
          onAuthor: () => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`),
        },
      }));
  }, [posts, myWeb, myMyc, myRecs, mySaves, overlays, user, promptSaved, openPicker]);

  const visible = useMemo(
    () => items.filter((it) =>
      (tab === 'All' || (tab === 'Actionable' ? it.actionable : !it.actionable))
      && (areaSel.size === 0 || it.areas.some((a) => areaSel.has(a)))),
    [items, tab, areaSel]
  );

  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="sparkle" size={11} />
          {/* "My-celium" (founder 2026-07-25): the name carries the point —
              this is YOUR specific network. Display-only; routes and DB
              tables keep the plain spelling. */}
          <span>My-celium</span>
        </p>
        <h1 className="myc__title">Your My-celium</h1>
        <p className="myc__sub">
          What your web is sharing.
        </p>
      </header>

      {/* THE STACKED ROWS + FEED LENSES (founder 2026-10-12, superseding the
          2026-08-07 section-switcher doors): tools first, then the sections
          as multi-select lenses on the web's stream — Home's exact grammar. */}
      <IconRow
        className="icon-row--tools"
        ariaLabel="Tools"
        items={MYC_TOOLS.map((it) => {
          if (it.label === 'Assistant')
            return { ...it, variant: `icon-row__btn--ai${aiDoorOn('mycelium') ? '' : ' ai-off'}` };
          // The + follows the lit lenses, Home's 2026-10-15 rule: Feed = plain
          // social compose, lit lenses = actionable with those areas preloaded.
          if (it.label === 'Post' && areaSel.size > 0)
            return { ...it, to: `/compose?area=${[...areaSel].join(',')}` };
          return it;
        })}
      />
      <IconRow
        className="icon-row--lenses"
        ariaLabel="Feed lenses"
        items={[
          { icon: 'newsfeed', label: 'Feed',
            variant: areaSel.size === 0 ? 'icon-row__btn--here' : undefined },
          // A LIT lens grows its › door tab (founder 2026-10-23, Home's
          // grammar) — here it walks into the section INSIDE your web (?web=1).
          ...FEED_LENSES.map((l) => ({
            icon: l.icon, label: l.label,
            variant: areaSel.has(l.area) ? 'icon-row__btn--here' : undefined,
            door: areaSel.has(l.area)
              ? { label: `Open ${l.label}`, onClick: () => navigate(`${l.room}?web=1`) }
              : undefined,
          })),
          { icon: 'member-heart', label: 'Members', to: '/mycelium/directory' },
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

      <p className="myc__count">
        <span className="myc__count-n">{visible.length}</span>{' '}
        {visible.length === 1 ? 'post' : 'posts'}
      </p>

      <section className="myc__feed">
        {visible.map((it) => <FeedCard key={it.key} {...it.card} />)}
        {visible.length === 0 && (
          <div className="myc__empty">
            {items.length > 0 ? (
              <>
                <span className="display-italic">Nothing matches.</span>
                <p>Try All, or a different side of the feed.</p>
              </>
            ) : (
              <>
                {/* Your web IS a filter on Lichen (founder 2026-08-11) — an
                    empty one should say so and point at the whole. ⚠ This is
                    the FEED, not one area: the copy said "No Marketplace
                    content" and offered a door to /market, which made no
                    sense on a page showing everything your web shares
                    (founder 2026-08-16). */}
                <span className="display-italic">Nothing from your web yet!</span>
                <p>Weave more people and places in — or see what the whole network is sharing.</p>
                <button className="btn myc__empty-go" onClick={() => navigate('/home')}>
                  Visit Lichen
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <ShareToClaudeSheet post={shareTarget} onClose={() => setShareTarget(null)} />
    </div>
  );
}
