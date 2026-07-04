import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import FeedCard from '../components/FeedCard';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadFeed, postAreas, loadMyRsvps, rsvpToEvent, unRsvp,
  EVENT_CATEGORIES, EVENT_MODES,
  type FeedPost, type EventCategory, type EventMode,
} from '../lib/postsApi';
import { minToLabel } from '../lib/calendarApi';
import { loadMyMycelium, loadMyRecommendations, loadEndorsements, setTrust, setRecommend } from '../lib/myceliumApi';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { postToCard } from '../lib/feedMapping';
import './Events.css';

const TABS = ['All', ...EVENT_CATEGORIES.map((c) => c.label)];

/** Human "when" for an event post's linked calendar event. */
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

/** Events feed — event posts (Where includes 'events'), filterable by category
 *  tabs and Free/Trade/Paid, each backed by a real calendar event for RSVP. */
export default function Events() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [tab, setTab] = useState('All');
  const [modes, setModes] = useState<EventMode[]>([]);
  const [going, setGoing] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  const load = useCallback(async () => {
    const feed = (await loadFeed()).filter((p) => postAreas(p).includes('events'));
    const [myc, recs] = await Promise.all([loadMyMycelium(), loadMyRecommendations()]);
    const ov = await loadEndorsements(feed, myc);
    const rsvps = me
      ? await loadMyRsvps(feed.map((p) => p.linked_event_id).filter((id): id is string => !!id), me)
      : new Set<string>();
    setPosts(feed); setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setGoing(rsvps);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  const toggleMode = (m: EventMode) =>
    setModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const visible = useMemo(() => {
    const cat = EVENT_CATEGORIES.find((c) => c.label === tab)?.value as EventCategory | undefined;
    return posts
      .filter((p) => (tab === 'All' || p.event_category === cat))
      .filter((p) => (modes.length === 0 || (p.event_mode != null && modes.includes(p.event_mode))))
      .sort((a, b) => {
        const da = a.linked_event?.start_date ?? '9999-12-31';
        const db = b.linked_event?.start_date ?? '9999-12-31';
        return da.localeCompare(db);
      });
  }, [posts, tab, modes]);

  async function onBadge(p: FeedPost) {
    const evId = p.linked_event_id;
    if (p.event_mode === 'paid') {
      const url = typeof p.details?.bookingUrl === 'string' ? p.details.bookingUrl : null;
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    if (!evId || !me) return;
    try {
      if (going.has(evId)) { await unRsvp(evId, me); setGoing((s) => { const n = new Set(s); n.delete(evId); return n; }); }
      else { await rsvpToEvent(evId, me); setGoing((s) => new Set(s).add(evId)); }
    } catch (e) { console.error('rsvp', e); }
  }

  function badgeFor(p: FeedPost) {
    const ev = p.linked_event;
    const first = Array.isArray(p.details?.media)
      ? (p.details.media as { type: string; url: string }[]).find((m) => m.type === 'photo')?.url
      : undefined;
    const src = p.image_url ?? first;
    const top = ev
      ? (ev.start_date === ev.end_date ? formatDateShort(ev.start_date) : `${formatDateShort(ev.start_date)}–${formatDateShort(ev.end_date)}`)
      : 'Event';
    const price = typeof p.details?.price === 'string' ? p.details.price : null;
    const bottom = p.event_mode === 'paid'
      ? (price ? `Book · ${price}` : 'Book')
      : p.linked_event_id && going.has(p.linked_event_id) ? 'Going ✓' : 'RSVP';
    return { src, topLabel: top, bottomLabel: bottom };
  }

  async function messageAuthor(otherId: string) {
    const chatId = await ensureDirectChat(otherId);
    navigate(`/chat/${chatId}`);
  }

  return (
    <div className="evt">
      <FilterRow options={TABS} value={tab} onChange={setTab} />

      {/* Search · Post · | · Free / Trade / Paid (Marketplace-style circles) */}
      <div className="evt__actions h-scroll">
        <button className="evt__action" onClick={() => navigate('/compose?area=events')}>
          <span className="evt__action-circle">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="evt__action-label">Post</span>
        </button>
        <div className="evt__action-spacer" />
        {EVENT_MODES.map((m) => (
          <button
            key={m.value}
            className={'evt__action' + (modes.includes(m.value) ? ' is-active' : '')}
            onClick={() => toggleMode(m.value)}
          >
            <span className="evt__action-circle"><Icon name={m.icon} size={14} /></span>
            <span className="evt__action-label">{m.label}</span>
          </button>
        ))}
      </div>

      <section className="evt__feed">
        {visible.length === 0 && (
          <p className="evt__empty">No events here yet — post the first one.</p>
        )}
        {visible.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me)}
            eyebrow={whenLabel(p) ?? postToCard(p, me).eyebrow}
            image={badgeFor(p)}
            onBadgeAction={() => onBadge(p)}
            onOpen={() => navigate(`/events/${p.id}`)}
            trusted={myMyc.has('profile:' + p.author_id)}
            recommended={myRecs.has(p.id)}
            mycelium={overlays[p.id]}
            availability={{ trust: p.author_id !== me }}
            onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
            onRecommend={(on) => { void setRecommend(p.id, on).catch(console.error); }}
            onMessage={p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
          />
        ))}
      </section>
    </div>
  );
}
