import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import FeedCard from '../components/FeedCard';
import { LinkifiedText } from '../components/CarePostCard';
import { SmartLocation } from './Calendar';
import { useAuth } from '../auth/AuthProvider';
import { loadEvent, minToLabel, type EventRow } from '../lib/calendarApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadPost, loadEventUpdates, rsvpToEvent, unRsvp,
  type FeedPost,
} from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import './EventPage.css';

type Tab = 'About' | 'Updates' | 'Chat' | 'RSVP' | 'Book';

/** Full event page (per the Figma mock): sticky title + tabs; About (hero,
 *  Add-to-Cal / Add-to-Maps cards, unlimited description), Updates (host posts
 *  linked to the same calendar event), RSVP (guest list + action), Book. */
export default function EventPage() {
  const { postId = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [calEvent, setCalEvent] = useState<EventRow | null>(null);
  const [updates, setUpdates] = useState<FeedPost[]>([]);
  const [tab, setTab] = useState<Tab>('About');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await loadPost(postId);
    setPost(p);
    if (p?.linked_event_id) {
      const [ev, ups] = await Promise.all([
        loadEvent(p.linked_event_id),
        loadEventUpdates(p.linked_event_id, p.id),
      ]);
      setCalEvent(ev); setUpdates(ups);
    }
    setLoading(false);
  }, [postId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="evp"><p className="evp__muted">Loading…</p></div>;
  if (!post) return <div className="evp"><p className="evp__muted">This event isn't available.</p></div>;

  const hostName = post.author_space?.name || post.author?.full_name || 'A member';
  const title = post.title || hostName + "'s event";
  const hero = post.image_url
    ?? (Array.isArray(post.details?.media)
      ? (post.details.media as { type: string; url: string }[]).find((m) => m.type === 'photo')?.url
      : undefined);
  const going = !!calEvent?.attendees?.some((a) => a.profile_id === me && a.status !== 'declined');
  const attendees = (calEvent?.attendees ?? []).filter((a) => a.status !== 'declined');
  const price = typeof post.details?.price === 'string' ? post.details.price : null;
  const bookingUrl = typeof post.details?.bookingUrl === 'string' ? post.details.bookingUrl : null;
  const location = typeof post.details?.location === 'string' ? post.details.location : '';

  const whenLines = (() => {
    if (!calEvent) return ['Date to be announced'];
    if (calEvent.recurrence) return [recurrenceLabel(calEvent.recurrence, calEvent.start_date)];
    const day = localDate(calEvent.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const dates = calEvent.start_date === calEvent.end_date
      ? day
      : `${formatDateShort(calEvent.start_date)} – ${formatDateShort(calEvent.end_date)}`;
    if (calEvent.all_day || calEvent.start_min == null) return [dates, 'All day'];
    return [dates, `${minToLabel(calEvent.start_min)} – ${minToLabel(calEvent.end_min ?? calEvent.start_min)}`];
  })();

  async function toggleRsvp() {
    if (!me || !post?.linked_event_id) return;
    try {
      if (going) await unRsvp(post.linked_event_id, me);
      else await rsvpToEvent(post.linked_event_id, me);
      await load();
    } catch (e) { console.error('rsvp', e); }
  }

  const TABS: Tab[] = ['About', 'Updates', 'Chat', 'RSVP', 'Book'];

  return (
    <div className="evp">
      {/* Sticky title + tabs (à la the calendar pin) */}
      <div className="evp__pin">
        <div className="evp__titlerow">
          <button className="conc__back" onClick={() => navigate('/events')} aria-label="Back to events">
            <Icon name="arrow-left" size={18} />
          </button>
          <h1 className="evp__title">{title}</h1>
          <span className="evp__host">by {hostName}</span>
        </div>
        <div className="evp__tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={'evp__tab' + (tab === t ? ' is-active' : '')}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'About' && (
        <div className="evp__body">
          {hero && <img className="evp__hero" src={hero} alt="" />}

          <div className="evp__cards">
            <button className="evp__infocard" onClick={toggleRsvp} disabled={!post.linked_event_id}>
              <Icon name="calendar" size={20} />
              <span className="evp__infocard-cta">{going ? 'On your calendar ✓' : 'Add to Cal'}</span>
              {whenLines.map((l) => <span className="evp__infocard-line" key={l}>{l}</span>)}
            </button>
            {location ? (
              <div className="evp__infocard">
                <Icon name="location" size={20} />
                <span className="evp__infocard-cta">Add to Maps</span>
                <SmartLocation loc={location} className="evp__infocard-loc" />
              </div>
            ) : (
              <div className="evp__infocard evp__infocard--empty">
                <Icon name="location" size={20} />
                <span className="evp__infocard-line">Location to be announced</span>
              </div>
            )}
          </div>

          <div className="evp__desc">
            <LinkifiedText text={post.body} />
          </div>
        </div>
      )}

      {tab === 'Updates' && (
        <div className="evp__body">
          {updates.length === 0 && <p className="evp__muted">No updates yet — the host's follow-up posts will land here.</p>}
          {updates.map((p) => <FeedCard key={p.id} {...postToCard(p, me)} />)}
        </div>
      )}

      {tab === 'Chat' && (
        <div className="evp__body">
          <p className="evp__muted">Event chat is coming in the next update — a room for everyone who's going.</p>
        </div>
      )}

      {tab === 'RSVP' && (
        <div className="evp__body">
          <button className="btn btn-primary evp__rsvp-btn" onClick={toggleRsvp} disabled={!post.linked_event_id}>
            {going ? 'Going ✓ — tap to cancel' : "RSVP — I'll be there"}
          </button>
          <p className="evp__count">{attendees.length} going</p>
          <div className="evp__people">
            {attendees.map((a) => (
              <div className="evp__person" key={a.profile_id}>
                <Avatar id={a.profile_id} name={a.profile?.full_name ?? 'Member'} url={a.profile?.avatar_url} size={34} />
                <span className="evp__person-name">{a.profile?.full_name ?? 'Member'}</span>
                {a.status === 'invited' && <span className="evp__person-status">invited</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'Book' && (
        <div className="evp__body">
          {post.event_mode === 'paid' ? (
            <>
              {price && <p className="evp__price">{price}</p>}
              {bookingUrl ? (
                <a className="btn btn-primary evp__rsvp-btn" href={bookingUrl} target="_blank" rel="noopener noreferrer">
                  Book with {hostName}
                </a>
              ) : (
                <p className="evp__muted">The host hasn't added a booking link yet — message them to reserve a spot.</p>
              )}
            </>
          ) : (
            <p className="evp__muted">
              This event is {post.event_mode === 'trade' ? 'open to trades' : 'free'} — no booking needed, just RSVP.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
