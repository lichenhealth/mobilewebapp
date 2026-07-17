import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import FeedCard from '../components/FeedCard';
import { ScrollHintRow } from '../components/ScrollHintRow';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { formatDateShort, localDate, todayISO } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadFeed, postAreas, loadMyRsvpStatuses, rsvpToEvent, unRsvp,
  EVENT_CATEGORIES, EVENT_MODES,
  type FeedPost, type EventCategory, type EventMode, type MyRsvpStatus,
} from '../lib/postsApi';
import { minToLabel } from '../lib/calendarApi';
import { loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend } from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { postToCard, weaveProps } from '../lib/feedMapping';
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

/** Events — top tabs Events (browse feed, category + Free/Trade/Paid filters) ·
 *  My Events (hosting + going + maybe, upcoming & past) · My Calendar (jumps
 *  to /calendar). Each event post is backed by a real calendar event for RSVP. */
export default function Events() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const view: 'browse' | 'mine' = useLocation().pathname.endsWith('/mine') ? 'mine' : 'browse';

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [tab, setTab] = useState('All');
  const [modes, setModes] = useState<EventMode[]>(['free', 'trade', 'paid']);   // lenses default all-on
  const [statuses, setStatuses] = useState<Map<string, MyRsvpStatus>>(new Map());
  const [showPast, setShowPast] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  const load = useCallback(async () => {
    const feed = (await loadFeed()).filter((p) => postAreas(p).includes('events'));
    const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
    const ov = await loadEndorsements(feed, myc);
    const rsvps = me
      ? await loadMyRsvpStatuses(feed.map((p) => p.linked_event_id).filter((id): id is string => !!id), me)
      : new Map<string, MyRsvpStatus>();
    setPosts(feed); setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setStatuses(rsvps);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  /** Am I actively attending (going or maybe)? */
  const attending = (p: FeedPost): MyRsvpStatus | null => {
    const st = p.linked_event_id ? statuses.get(p.linked_event_id) : undefined;
    return st === 'going' || st === 'tentative' ? st : null;
  };

  const toggleMode = (m: EventMode) =>
    setModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const visible = useMemo(() => {
    const cat = EVENT_CATEGORIES.find((c) => c.label === tab)?.value as EventCategory | undefined;
    return posts
      .filter((p) => (tab === 'All' || p.event_category === cat))
      .filter((p) => (p.event_mode == null ? modes.length > 0 : modes.includes(p.event_mode)))
      .sort((a, b) => {
        const da = a.linked_event?.start_date ?? '9999-12-31';
        const db = b.linked_event?.start_date ?? '9999-12-31';
        return da.localeCompare(db);
      });
  }, [posts, tab, modes]);

  // My Events: hosting + going + maybe, split into upcoming and past by the
  // linked calendar event (recurring events never age out).
  const mine = useMemo(() => {
    const items = posts.filter((p) =>
      p.linked_event_id && (p.author_id === me || attending(p)));
    const today = todayISO();
    const isPast = (p: FeedPost) => {
      const ev = p.linked_event;
      if (!ev || ev.recurrence) return false;
      return (ev.end_date ?? ev.start_date) < today;
    };
    const upcoming = items.filter((p) => !isPast(p)).sort((a, b) =>
      (a.linked_event?.start_date ?? '').localeCompare(b.linked_event?.start_date ?? ''));
    const past = items.filter(isPast).sort((a, b) =>
      (b.linked_event?.start_date ?? '').localeCompare(a.linked_event?.start_date ?? ''));
    return { upcoming, past };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, statuses, me]);

  /** "Hosting · Sat 7/12 · 6pm – 8pm" — role tag ahead of the when line. */
  function myEyebrow(p: FeedPost): string {
    const role = p.author_id === me ? 'Hosting' : attending(p) === 'tentative' ? 'Maybe' : 'Going';
    const when = whenLabel(p);
    return when ? `${role} · ${when}` : role;
  }

  async function onBadge(p: FeedPost) {
    const evId = p.linked_event_id;
    if (p.event_mode === 'paid') {
      const url = typeof p.details?.bookingUrl === 'string' ? p.details.bookingUrl : null;
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    if (!evId || !me) return;
    try {
      if (attending(p)) {
        await unRsvp(evId, me);
        setStatuses((s) => { const n = new Map(s); n.delete(evId); return n; });
      } else {
        await rsvpToEvent(evId, me);
        setStatuses((s) => new Map(s).set(evId, 'going'));
      }
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
    const st = attending(p);
    const bottom = p.event_mode === 'paid'
      ? (price ? `Book · ${price}` : 'Book')
      : st === 'going' ? 'Going ✓' : st === 'tentative' ? 'Maybe ✓' : 'RSVP';
    return { src, topLabel: top, bottomLabel: bottom };
  }

  async function messageAuthor(otherId: string) {
    const chatId = await ensureDirectChat(otherId);
    navigate(`/chat/${chatId}`);
  }

  const card = (p: FeedPost, eyebrow?: string) => (
    <FeedCard
      key={p.id}
      {...postToCard(p, me)}
      {...weaveProps(p, myWebSet, me)}
      eyebrow={eyebrow ?? whenLabel(p) ?? postToCard(p, me).eyebrow}
      image={badgeFor(p)}
      onBadgeAction={() => onBadge(p)}
      onOpen={() => navigate(`/events/${p.id}`)}
      onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
      trusted={myMyc.has('profile:' + p.author_id)}
      recommended={myRecs.has('post:' + p.id)}
      mycelium={overlays[p.id]}
      availability={{ trust: p.author_id !== me }}
      onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
      onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
      saved={mySaves.has('post:' + p.id)}
      onSave={(on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); }}
      extraMenuItems={me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined}
      viewerIsAuthor={p.author_id === me}
      onManage={() => navigate(`/events/${p.id}`)}
      onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
      onMessage={p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
    />
  );

  return (
    <div className="evt">
      {/* Screen nav: Events · My Events · My Calendar (Figma 286-11251) */}
      <div className="evt__tabs">
        <button
          className={'evt__tab' + (view === 'browse' ? ' is-active' : '')}
          onClick={() => navigate('/events')}
        >
          Events
        </button>
        <button
          className={'evt__tab' + (view === 'mine' ? ' is-active' : '')}
          onClick={() => navigate('/events/mine')}
        >
          My Events
        </button>
        <button className="evt__tab" onClick={() => navigate('/calendar')}>
          My Calendar
        </button>
      </div>

      {view === 'browse' && (
        <>
          <FilterRow options={TABS} value={tab} onChange={setTab} />

          {/* Search · Post · | · Free / Trade / Paid (Marketplace-style circles) */}
          <ScrollHintRow className="evt__actions h-scroll" role="toolbar" ariaLabel="Tools and filters">
            <button className="evt__action" onClick={() => navigate('/search?area=events')}>
              <span className="evt__action-circle"><Icon name="search" size={14} /></span>
              <span className="evt__action-label">Search</span>
            </button>
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
          </ScrollHintRow>

          <section className="evt__feed">
            {visible.length === 0 && (
              <p className="evt__empty">No events here yet — post the first one.</p>
            )}
            {visible.map((p) => card(p))}
          </section>
        </>
      )}

      {view === 'mine' && (
        <section className="evt__feed">
          {mine.upcoming.length === 0 && mine.past.length === 0 && (
            <p className="evt__empty">
              Nothing here yet — RSVP to something in Events, or host your own.
            </p>
          )}
          {mine.upcoming.map((p) => card(p, myEyebrow(p)))}
          {mine.past.length > 0 && (
            <>
              <button className="evt__past-toggle" onClick={() => setShowPast((s) => !s)}>
                <span className={'evt__past-chevron' + (showPast ? ' is-open' : '')}>
                  <Icon name="chevron-right" size={14} />
                </span>
                <span>Past events ({mine.past.length})</span>
              </button>
              {showPast && mine.past.map((p) => card(p, myEyebrow(p)))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
