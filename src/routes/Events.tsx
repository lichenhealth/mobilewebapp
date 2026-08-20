import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import FilterRow from '../components/FilterRow';
import FeedCard from '../components/FeedCard';
import { ScrollHintRow } from '../components/ScrollHintRow';
import AssistantDoor from '../components/AssistantDoor';
import { Icon } from '../components/Icon';
import ScopeBack from '../components/ScopeBack';
import { ScopeEmpty, ScopeMore } from '../components/ScopeEscape';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat, chatPathForPost } from '../lib/chatApi';
import { formatDateShort, localDate, todayISO } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadFeed, loadAuthorFeed, postAreas, loadMyRsvpStatuses, rsvpToEvent, unRsvp,
  EVENT_CATEGORIES, EVENT_MODES,
  type FeedPost, type EventCategory, type EventMode, type MyRsvpStatus,
} from '../lib/postsApi';
import { supabase } from '../lib/supabase';
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
  const [params] = useSearchParams();
  // Scoped events: /events?space=<id> = "Pine Valley Grange's Events"
  // (founder 2026-07-25 — area doors open the REAL section, not search);
  // /events?member=<id> likewise. Scoped views browse only (My Events is
  // personal, reachable via the plain tabs).
  const member = params.get('member');
  const space = params.get('space');
  const scoped = member || space;
  const [scopeName, setScopeName] = useState('');
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
    const raw = member ? await loadAuthorFeed({ profileId: member })
      : space ? await loadAuthorFeed({ spaceId: space })
      : await loadFeed();
    const feed = raw.filter((p) => postAreas(p).includes('events'));
    if (member) {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', member).maybeSingle();
      setScopeName((data as { full_name: string | null } | null)?.full_name ?? '');
    } else if (space) {
      const { data } = await supabase.from('spaces').select('name').eq('id', space).maybeSingle();
      setScopeName((data as { name: string | null } | null)?.name ?? '');
    }
    const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
    const ov = await loadEndorsements(feed, myc);
    const rsvps = me
      ? await loadMyRsvpStatuses(feed.map((p) => p.linked_event_id).filter((id): id is string => !!id), me)
      : new Map<string, MyRsvpStatus>();
    setPosts(feed); setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setStatuses(rsvps);
  }, [me, member, space]);
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

  // One rule for every feed's chat door (founder 2026-08-17): a post in a
  // space's voice opens the conversation WITH that space, answered by the
  // admin who wrote it; a personal post opens the DM. The post rides along.
  async function messageAbout(post: { id: string; author_id: string; author_space_id?: string | null }) {
    try { navigate(await chatPathForPost(post)); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  // The calendar rail's rows: every visible event with a real upcoming date,
  // chronological — the feed's own posts, just sorted by when.
  const todayStr = new Date().toISOString().slice(0, 10);
  const agenda = visible
    .filter((p) => p.linked_event && (p.linked_event.end_date ?? p.linked_event.start_date) >= todayStr)
    .map((p) => ({ p, ev: p.linked_event! }))
    .sort((a, b) => a.ev.start_date.localeCompare(b.ev.start_date) || (a.ev.start_min ?? 0) - (b.ev.start_min ?? 0));

  const card = (p: FeedPost, eyebrow?: string) => (
    <FeedCard
      key={p.id}
      {...postToCard(p, me)}
      {...weaveProps(p, myWebSet, me)}
      eyebrow={eyebrow ?? whenLabel(p) ?? postToCard(p, me).eyebrow}
      image={badgeFor(p)}
      /* badgeFor() already draws details.media's photo as the date/RSVP
         cover — postToCard's own `media` would render the SAME photo a
         second time, full-width, below the body (founder 2026-08-10:
         "the mocks for Events have redundant images"). An event's photo
         lives in the badge only. */
      media={undefined}
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
      onMessage={p.author_id !== me ? () => messageAbout(p) : undefined}
    />
  );

  return (
    <div className="evt">
      <ScopeBack />
      {/* Scoped: a slim header in place of the personal tabs — back to the
          entity, "{Name}'s Events". */}
      {scoped ? (
        <header className="mkt__head">
          <button className="cmp__back mkt__memberback" onClick={() => navigate(member ? `/members/${member}` : `/spaces/${space}`)}>
            <Icon name="arrow-left" size={14} /> {scopeName || 'Back'}
          </button>
          <h1 className="mkt__title">
            {scopeName}&rsquo;s <span className="display-italic">Events</span>
          </h1>
        </header>
      ) : view === 'mine' ? (
        /* My Events is a MANAGEMENT page now (founder 2026-07-26): back chip
           home to Events, same as the calendar's. */
        <header className="mkt__head">
          <button className="cmp__back mkt__memberback" onClick={() => navigate('/events')}>
            <Icon name="arrow-left" size={14} /> Events
          </button>
          <h1 className="mkt__title">
            My <span className="display-italic">Events</span>
          </h1>
        </header>
      ) : null}

      {view === 'browse' && (
        <>
          {/* THE DOORS (icon-only, Marketplace's 2026-08-08 pattern) share one
              row with the type lenses — Events only has 3 (not Marketplace's
              6-8), so it comfortably fits without needing its own line.
              ICONS ABOVE, TOGGLES BELOW (founder 2026-08-14): the category
              word-tabs moved beneath this row, matching Home/My-celium. */}
          <ScrollHintRow className="evt__actions evt__actions--doors h-scroll" role="toolbar" ariaLabel="Event tools and type filters" gutter>
            <button
              className="evt__action evt__action--door"
              onClick={() => navigate(`/search?area=events${member ? `&member=${member}` : space ? `&space=${space}` : ''}`)}
              aria-label="Search" title="Search"
            >
              <span className="evt__action-circle"><Icon name="search" size={14} /></span>
            </button>
            <button
              className="evt__action evt__action--door"
              onClick={() => navigate(`/compose?area=events${space ? `&space=${space}` : ''}`)}
              aria-label="Post an event" title="Post an event"
            >
              <span className="evt__action-circle">
                <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            {/* The brain closes the doors group, same slot as Marketplace's
                (founder 2026-08-14: "we need a brain for Events, so you can
                click on your assistant and it can summarize your events"). */}
            <AssistantDoor section="events" size={36} label="Your assistant — your RSVPs, what you're hosting, what's coming up" />
            <div className="evt__action-spacer" />
            {/* The lit Feed door — this page IS the events feed, said the way
                Home says it (founder 2026-08-20: consistency). */}
            <button className="evt__action evt__action--here" aria-current="page" title="The events feed — you're here">
              <span className="evt__action-circle"><Icon name="newsfeed" size={14} /></span>
            </button>
            <div className="evt__action-push" />
            {/* Free / Trade / Paid read as signals, same vocabulary as
                Marketplace's mode lenses — text + icon, no circle, a check
                when it's on. */}
            {EVENT_MODES.map((m) => {
              const on = modes.includes(m.value);
              return (
                <button
                  key={m.value}
                  className={'evt__lens' + (on ? ' is-on' : '')}
                  onClick={() => toggleMode(m.value)}
                  aria-pressed={on}
                  title={on ? `Showing ${m.label.toLowerCase()} events — tap to hide` : `Tap to show ${m.label.toLowerCase()} events`}
                >
                  <Icon name={m.icon} size={16} />
                  {m.label}{on ? ' ✓' : ''}
                </button>
              );
            })}
          </ScrollHintRow>

          {scoped ? <FilterRow options={TABS} value={tab} onChange={setTab} /> : (
            <div className="evt__nav evt__nav--below">
              <div className="evt__nav-tabs">
                {TABS.map((t) => (
                  <button
                    key={t}
                    className={'evt__navtab' + (tab === t ? ' is-active' : '')}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <span className="evt__nav-doors">
                <button className="evt__navdoor" onClick={() => navigate('/events/mine')} title="My Events">
                  <Icon name="rsvp" size={13} /><span>My Events</span>
                </button>
                <button className="evt__navdoor" onClick={() => navigate('/calendar?from=events')} title="My Calendar">
                  <Icon name="calendar" size={13} /><span>My Calendar</span>
                </button>
              </span>
            </div>
          )}

          <div className="evt__body">
          <section className="evt__feed">
            {visible.length === 0 && (scoped ? (
              <ScopeEmpty
                icon="rsvp" section="Events" who={scopeName || 'them'}
                to="/events" label="Visit Lichen Events"
              />
            ) : (
              <p className="evt__empty">No events here yet — post the first one.</p>
            ))}
            {visible.map((p) => card(p))}
            {scoped && (
              <ScopeMore
                count={visible.length}
                section="Events"
                who={scopeName || 'they'}
                to="/events"
                label="Browse Lichen Events"
              />
            )}
          </section>

          {/* THE CALENDAR RAIL (founder 2026-08-20): upcoming events in
              chronological order beside the feed — sort by date at a glance.
              Desktop only; phones keep the single stream. */}
          <aside className="evt__agenda" aria-label="Upcoming events by date">
            <p className="evt__agenda-head">Coming up</p>
            {agenda.length === 0 && <p className="evt__agenda-empty">Nothing scheduled ahead.</p>}
            {agenda.map(({ p, ev }) => (
              <button key={p.id} className="evt__agenda-row" onClick={() => navigate(`/events/${p.id}`)}>
                <span className="evt__agenda-date">
                  {localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })}
                </span>
                <span className="evt__agenda-title">{p.title || p.body.slice(0, 40)}</span>
                {ev.start_min != null && !ev.all_day && (
                  <span className="evt__agenda-time">{minToLabel(ev.start_min)}</span>
                )}
              </button>
            ))}
          </aside>
          </div>
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
