import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from './FilterRow';
import FeedCard from './FeedCard';
import { Icon, IconName } from './Icon';
import { ensureDirectChat } from '../lib/chatApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import { minToLabel } from '../lib/calendarApi';
import {
  loadAuthorFeed, deletePost, postAreas, CONTENT_TYPES, SERVICE_AREAS,
  type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend } from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import type { MyceliumSignals } from './EngagementFooter';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import './ContributionsFeed.css';

const TABS = ['All', ...CONTENT_TYPES.map((t) => t.label)];

/** "when" eyebrow for event posts (same rendering as the Events feed). */
function whenLabel(p: FeedPost): string | undefined {
  const ev = p.linked_event;
  if (!ev) return undefined;
  if (ev.recurrence) return recurrenceLabel(ev.recurrence, ev.start_date);
  const day = localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short' });
  const date = ev.start_date === ev.end_date
    ? `${day} ${formatDateShort(ev.start_date)}`
    : `${formatDateShort(ev.start_date)} – ${formatDateShort(ev.end_date)}`;
  if (ev.all_day || ev.start_min == null) return date;
  return `${date} · ${minToLabel(ev.start_min)} – ${minToLabel(ev.end_min ?? ev.start_min)}`;
}

/** A profile IS a feed (Figma 286-16377 / 286-11770): the entity's stream
 *  under the standard content-type tabs, plus service-area icon toggles that
 *  only appear for areas present in the stream. People (profileId) show what
 *  they authored; spaces (spaceId) show their wall. `leading` prepends
 *  space-anatomy action circles (Chat, Members) to the icon row. */
export default function ContributionsFeed({ profileId, spaceId, me, leading = [], entityName }: {
  profileId?: string;
  spaceId?: string;
  me: string;
  leading?: { icon: IconName; label: string; onClick: () => void }[];
  /** The entity's display name — lets a single area lens read as a PLACE:
   *  tap Library on Melanie's profile and the feed declares "Melanie's
   *  Library" (destination feeling, no navigation cost — founder 2026-07-19). */
  entityName?: string;
}) {
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('All');
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const feed = await loadAuthorFeed({ profileId, spaceId });
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setPosts(feed); setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setReady(true);
    })();
    return () => { live = false; };
  }, [profileId, spaceId]);

  // Only offer toggles for areas this entity actually contributes to.
  const areasPresent = useMemo(() => {
    const present = new Set<ServiceArea>();
    posts.forEach((p) => postAreas(p).forEach((a) => present.add(a)));
    return SERVICE_AREAS.filter((a) => present.has(a.value));
  }, [posts]);

  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  const visible = useMemo(() => {
    const type = CONTENT_TYPES.find((t) => t.label === tab)?.value;
    return posts
      .filter((p) => (tab === 'All' || p.content_type === type))
      .filter((p) => (areas.length === 0 || postAreas(p).some((a) => areas.includes(a))));
  }, [posts, tab, areas]);

  async function messageAuthor(otherId: string) {
    const chatId = await ensureDirectChat(otherId);
    navigate(`/chat/${chatId}`);
  }

  if (!ready) return <p className="cfeed__empty">Loading…</p>;
  // Space anatomy (Chat/Members) stays visible even before the first post.
  if (posts.length === 0 && leading.length === 0) {
    return <p className="cfeed__empty">No contributions yet.</p>;
  }

  return (
    <div className="cfeed">
      {posts.length > 0 && <FilterRow options={TABS} value={tab} onChange={setTab} />}

      {(leading.length > 0 || areasPresent.length > 0) && (
        <div className="cfeed__areas h-scroll">
          {leading.map((l) => (
            <button key={l.label} className="cfeed__area" onClick={l.onClick}>
              <span className="cfeed__area-circle"><Icon name={l.icon} size={14} /></span>
              <span className="cfeed__area-label">{l.label}</span>
            </button>
          ))}
          {leading.length > 0 && areasPresent.length > 0 && <span className="cfeed__area-gap" />}
          {areasPresent.map((a) => (
            <button
              key={a.value}
              className={'cfeed__area' + (areas.includes(a.value) ? ' is-active' : '')}
              onClick={() => toggleArea(a.value)}
            >
              <span className="cfeed__area-circle"><Icon name={a.icon} size={14} /></span>
              <span className="cfeed__area-label">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {entityName && areas.length === 1 && (
        <h2 className="cfeed__shelf">
          {entityName}&rsquo;s <span className="display-italic">
            {areasPresent.find((a) => a.value === areas[0])?.label ?? areas[0]}
          </span>
        </h2>
      )}

      <div className="cfeed__list">
        {posts.length === 0 && <p className="cfeed__empty">No contributions yet.</p>}
        {posts.length > 0 && visible.length === 0 && <p className="cfeed__empty">Nothing here under these filters.</p>}
        {visible.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me)}
            {...weaveProps(p, myWebSet, me)}
            eyebrow={whenLabel(p) ?? postToCard(p, me).eyebrow}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
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
          />
        ))}
      </div>
    </div>
  );
}
