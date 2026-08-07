import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard, { FeedCardProps } from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { loadFeed, deletePost, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import { ensureDirectChat } from '../lib/chatApi';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import IconRow, { IconRowItem } from '../components/IconRow';
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

// Your web's own newspaper, then the rest of your web by section. Mirrors
// Home's row exactly — one vocabulary, wherever you're standing.
const MYC_ICONS: IconRowItem[] = [
  { icon: 'search',         label: 'Search',      to: '/search' },
  { icon: 'plus',           label: 'Post',        to: '/compose' },
  { icon: 'brain',          label: 'Assistant',   to: '/assistant?section=mycelium',
    variant: 'icon-row__btn--ai' },
  { icon: 'newsfeed',       label: 'Feed',        to: '/mycelium',
    variant: 'icon-row__btn--here', size: 22, divider: true },
  { icon: 'store',          label: 'Marketplace', to: '/market?web=1' },
  { icon: 'rsvp',           label: 'Events',      to: '/events' },
  { icon: 'briefcase',      label: 'Work',        to: '/work?web=1' },
  { icon: 'graduation-cap', label: 'Education',   to: '/courses?web=1' },
  { icon: 'fork-spoon',     label: 'Food',        to: '/food?web=1' },
  { icon: 'palette',        label: 'Creative',    to: '/art?web=1' },
  { icon: 'plane',          label: 'Travel',      to: '/travel?web=1' },
  { icon: 'book',           label: 'Library',     to: '/library?web=1' },
  { icon: 'member-heart',   label: 'Members',     to: '/mycelium/directory' },
];
type Item = {
  key: string;
  card: FeedCardProps;
  actionable: boolean;
};

export default function Mycelium() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  const [tab, setTab] = useState('All');
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());

  const [posts, setPosts] = useState<FeedPost[]>([]);
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
    (async () => {
      const feed = await loadFeed(50, { river: true });
      const [{ web, vouched }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, vouched);
      setMyWeb(web); setMyMyc(vouched); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
  }, []);

  // The feed: real posts from entities in your mycelium.
  const items = useMemo<Item[]>(() => {
    return posts
      // Authors in your WEB (person or the space they posted as — membership,
      // vouched or not) — and always your own posts, so what you share to your
      // mycelium shows in your own web.
      .filter((p) =>
        myWeb.has('profile:' + p.author_id)
        || (p.author_space_id != null && myWeb.has('space:' + p.author_space_id))
        || p.author_id === user?.id)
      .map((p) => ({
        key: p.id,
        actionable: p.content_type === 'actionable',
        card: {
          ...postToCard(p, user?.id, spaceNames),
          ...weaveProps(p, myWeb, user?.id),
          trusted: myMyc.has('profile:' + p.author_id),
          recommended: myRecs.has('post:' + p.id),
          mycelium: overlays[p.id],
          availability: { trust: p.author_id !== user?.id },
          onTrust: (on: boolean) => { void setTrust('profile', p.author_id, on).catch(console.error); },
          onRecommend: (on: boolean) => { void setRecommend('post', p.id, on).catch(console.error); },
          saved: mySaves.has('post:' + p.id),
          onSave: (on: boolean) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); },
          extraMenuItems: user ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined,
          viewerIsAuthor: p.author_id === user?.id,
          onManage: p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined,
          onEdit: !p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined,
          onDelete: !p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onHide: user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onMessage: p.author_id !== user?.id ? () => messageAuthor(p.author_id) : undefined,
          onOpen: () => navigate(postOpenPath(p)),
          onAuthor: () => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`),
        },
      }));
  }, [posts, myWeb, myMyc, myRecs, mySaves, overlays, user, promptSaved, openPicker]);

  const visible = useMemo(
    () => items.filter((it) =>
      tab === 'All' || (tab === 'Actionable' ? it.actionable : !it.actionable)),
    [items, tab]
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

      {/* THE SECTION SWITCHER (founder 2026-08-07: "do the same for Mycelium,
          and have people always default to the newsfeed of any space. Then you
          can toggle to marketplace or events within your mycelium"). The lens
          chips are gone — narrowing by area is search's job now, and this row
          says where you ARE instead of quietly filtering what you see. Every
          door carries web=1, so you stay inside your web when you switch. */}
      <IconRow items={MYC_ICONS.map((it) => (it.label === 'Assistant'
        ? { ...it, variant: `icon-row__btn--ai${aiDoorOn('mycelium') ? '' : ' ai-off'}` }
        : it))} />

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
                <span className="display-italic">Nothing here yet.</span>
                <p>Weave more people and places into your web.</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
