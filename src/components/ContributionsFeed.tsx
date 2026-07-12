import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from './FilterRow';
import FeedCard from './FeedCard';
import { Icon } from './Icon';
import { ensureDirectChat } from '../lib/chatApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import { minToLabel } from '../lib/calendarApi';
import {
  loadAuthorFeed, postAreas, CONTENT_TYPES, SERVICE_AREAS,
  type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { loadMyMycelium, loadMyRecommendations, loadEndorsements, setTrust, setRecommend } from '../lib/myceliumApi';
import type { MyceliumSignals } from './EngagementFooter';
import { postToCard } from '../lib/feedMapping';
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

/** A profile IS a feed (Figma 286-16377): the entity's contributions under
 *  the standard content-type tabs, plus service-area icon toggles that only
 *  appear for areas this entity has actually posted in. Works for people
 *  (profileId) and for spaces posting as themselves (spaceId). */
export default function ContributionsFeed({ profileId, spaceId, me }: {
  profileId?: string;
  spaceId?: string;
  me: string;
}) {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('All');
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const feed = await loadAuthorFeed({ profileId, spaceId });
      const [myc, recs] = await Promise.all([loadMyMycelium(), loadMyRecommendations()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setPosts(feed); setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setReady(true);
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
  if (posts.length === 0) return <p className="cfeed__empty">No contributions yet.</p>;

  return (
    <div className="cfeed">
      <FilterRow options={TABS} value={tab} onChange={setTab} />

      {areasPresent.length > 0 && (
        <div className="cfeed__areas h-scroll">
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

      <div className="cfeed__list">
        {visible.length === 0 && <p className="cfeed__empty">Nothing here under these filters.</p>}
        {visible.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me)}
            eyebrow={whenLabel(p) ?? postToCard(p, me).eyebrow}
            onOpen={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has(p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: !!me && p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend(p.id, on).catch(console.error); }}
            onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
