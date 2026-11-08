import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import ChatConversation from '../components/ChatConversation';
import { supabase } from '../lib/supabase';
import FeedCard from '../components/FeedCard';
import { LinkifiedText, CarePreview } from '../components/CarePostCard';
import { SmartLocation } from './Calendar';
import { useAuth } from '../auth/AuthProvider';
import { loadEvent, deleteEvent, minToLabel, type EventRow } from '../lib/calendarApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadPost, loadEventUpdates, rsvpToEvent, unRsvp, deletePost,
  type FeedPost,
} from '../lib/postsApi';
import { loadMyWeb, loadMyRecommendations, loadEndorsements, setRecommend, posterTrustKey, trustPostPoster } from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { postToCard } from '../lib/feedMapping';
import {
  loadEventGuests, inviteEventGuest, inviteEventGuestByPhone, eventInviteSmsHref,
  mintEventLink, approveEventGuest, declineEventGuest, type EventGuest,
} from '../lib/eventGuestsApi';
import { classifyCareContact } from '../lib/careTeamApi';
import './EventPage.css';
import { useConfirm } from '../components/ConfirmDialog';

type Tab = 'About' | 'Updates' | 'Chat' | 'RSVP' | 'Book';

/** Full event page (per the Figma mock): sticky title + tabs; About (hero,
 *  Add-to-Cal / Add-to-Maps cards, unlimited description), Updates (host posts
 *  linked to the same calendar event), RSVP (guest list + action), Book. */
export default function EventPage(props: { postId?: string } = {}) {
  // A vanity link renders this page IN PLACE (founder 2026-11-06).
  const { postId: routeId = '' } = useParams();
  const postId = props.postId ?? routeId;
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const confirmDialog = useConfirm();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [calEvent, setCalEvent] = useState<EventRow | null>(null);
  const [updates, setUpdates] = useState<FeedPost[]>([]);
  const [upOverlays, setUpOverlays] = useState<Record<string, MyceliumSignals>>({});
  const [upRecs, setUpRecs] = useState<Set<string>>(new Set());
  const [upSaves, setUpSaves] = useState<Set<string>>(new Set());
  const [upVouched, setUpVouched] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('About');
  const [loading, setLoading] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatErr, setChatErr] = useState(false);
  const chatAsked = useRef(false);
  // Host: invite people outside Lichen (external guests) — by EMAIL or
  // PHONE since 2026-11-04 (founder: "I invite people to an event via
  // email or phone"; the Invite-to-Lichen pattern — a phone invite opens
  // the host's OWN Messages with the tokened text, no SMS provider).
  const [guests, setGuests] = useState<EventGuest[]>([]);
  const [gName, setGName] = useState('');
  const [gContact, setGContact] = useState('');
  const [gBusy, setGBusy] = useState(false);
  const [gMsg, setGMsg] = useState('');
  const [gText, setGText] = useState<{ name: string; href: string } | null>(null);
  // THE OPEN EVENT URL (founder 2026-11-04: "An Event URL is really
  // handy… if you're not also on an invite list, the request to attend
  // prompts an approval from the host"): one shareable link per event,
  // host-minted, rotatable (the kill switch for a leaked link); link-born
  // asks arrive as 'requested' rows the host answers right here.
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [gActBusy, setGActBusy] = useState<string | null>(null);
  const [armDecline, setArmDecline] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await loadPost(postId);
    // AN EVENTS-ROW ID IS ALSO A FAIR DOOR (founder 2026-11-08: the brain
    // linked "Kapulli in Mexico" — a calendar-only event, no post — to
    // /events/<event id> and the page said "isn't available"). No post by
    // that id: look for an EVENT; walk to its post when one links it, else
    // to its day on the calendar, where calendar-only events live.
    if (!p) {
      const { data: ev } = await supabase.from('events').select('id, start_date').eq('id', postId).maybeSingle();
      if (ev) {
        const { data: lp } = await supabase.from('posts').select('id').eq('linked_event_id', ev.id).limit(1).maybeSingle();
        navigate(lp ? `/events/${lp.id}` : `/calendar?d=${ev.start_date}`, { replace: true });
        return;
      }
    }
    setPost(p);
    if (p?.linked_event_id) {
      const [ev, ups] = await Promise.all([
        loadEvent(p.linked_event_id),
        loadEventUpdates(p.linked_event_id, p.id),
      ]);
      setCalEvent(ev); setUpdates(ups);
      // The updates' cards wear the platform signals too (founder 2026-10-26,
      // the mock's footer on EVERY card) — this was the one FeedCard surface
      // that never loaded the who-engaged overlay, so its chips sat gray and
      // its Recommend/Save wrote nothing.
      if (ups.length && me) {
        try {
          const [{ web, vouched }, recs, saves] = await Promise.all([
            loadMyWeb(), loadMyRecommendations(), loadMySaved(),
          ]);
          const ov = await loadEndorsements(ups, { web, vouched });
          setUpOverlays(ov); setUpRecs(recs); setUpSaves(saves); setUpVouched(vouched);
        } catch (e) { console.error(e); }
      }
    }
    setLoading(false);
  }, [postId, me]);
  useEffect(() => { load(); }, [load]);

  // Load external guests (+ the standing shareable link, if minted) once
  // we know the viewer is the host.
  useEffect(() => {
    if (!post || post.author_id !== me || !post.linked_event_id) { setGuests([]); setShareLink(null); return; }
    let live = true;
    loadEventGuests(post.linked_event_id).then((g) => { if (live) setGuests(g); });
    void supabase.from('events').select('guest_link_token').eq('id', post.linked_event_id).maybeSingle()
      .then(({ data }) => {
        const tok = (data as { guest_link_token: string | null } | null)?.guest_link_token;
        if (live && tok) setShareLink(`https://lichen.health/e/${tok}`);
      });
    return () => { live = false; };
  }, [post, me]);

  async function makeLink(rotate = false) {
    if (!post?.linked_event_id || linkBusy) return;
    setLinkBusy(true);
    try {
      const tok = await mintEventLink(post.linked_event_id, rotate);
      setShareLink(`https://lichen.health/e/${tok}`);
      setLinkCopied(false);
    } catch (e) { setGMsg((e as Error).message || 'Could not make the link.'); }
    finally { setLinkBusy(false); }
  }

  async function copyLink() {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 3000); }
    catch { window.prompt('Copy the link:', shareLink); }
  }

  async function approveGuest(g: EventGuest) {
    if (gActBusy) return;
    setGActBusy(g.id);
    try {
      await approveEventGuest(g);
      if (post?.linked_event_id) setGuests(await loadEventGuests(post.linked_event_id));
      setGMsg(g.email ? `${g.name} is in — they've been emailed.` : `${g.name} is in — text them the good news below.`);
    } catch (e) { setGMsg((e as Error).message || 'Could not approve.'); }
    finally { setGActBusy(null); }
  }

  async function refuseGuest(g: EventGuest) {
    if (armDecline !== g.id) { setArmDecline(g.id); return; }   // worded second tap
    setArmDecline(null); setGActBusy(g.id);
    try {
      await declineEventGuest(g.id);
      if (post?.linked_event_id) setGuests(await loadEventGuests(post.linked_event_id));
    } catch (e) { setGMsg((e as Error).message || 'Could not remove the request.'); }
    finally { setGActBusy(null); }
  }

  /** Short "when" for the texted invite ("Thu, Nov 20 · 5pm"). */
  const smsWhen = () => {
    if (!calEvent) return '';
    const d = formatDateShort(calEvent.start_date);
    return calEvent.all_day || calEvent.start_min == null ? d : `${d} · ${minToLabel(calEvent.start_min)}`;
  };

  async function sendGuestInvite() {
    if (!post?.linked_event_id || !gName.trim() || !gContact.trim() || gBusy) return;
    const contact = classifyCareContact(gContact);
    if (contact.kind !== 'email' && contact.kind !== 'phone') {
      setGMsg('That doesn’t read as an email or a phone number.'); return;
    }
    setGBusy(true); setGMsg(''); setGText(null);
    try {
      if (contact.kind === 'email') {
        await inviteEventGuest(post.linked_event_id, gName.trim(), contact.email);
        setGMsg(`Invite sent to ${contact.email}.`);
      } else {
        // Phone: mint the token, then the HOST texts it from their own
        // Messages (one token per person — it RSVPs for them).
        const token = await inviteEventGuestByPhone(post.linked_event_id, gName.trim(), contact.sms);
        const { data } = await supabase.from('profiles').select('full_name').eq('id', me).maybeSingle();
        const hostName = (data as { full_name: string | null } | null)?.full_name || 'A friend';
        const { href } = eventInviteSmsHref(contact.sms, hostName, post.title ?? calEvent?.title ?? 'an event', smsWhen(), token);
        setGText({ name: gName.trim(), href });
        setGMsg('Their text is ready below — tap it to send from your Messages.');
        window.location.href = href;
      }
      setGName(''); setGContact('');
      setGuests(await loadEventGuests(post.linked_event_id));
    } catch (e) {
      setGMsg((e as Error).message || 'Could not send the invite.');
    } finally { setGBusy(false); }
  }

  /** A phone row's "Text again ›" — same token, the sms just re-opens. */
  async function reTextGuest(g: EventGuest) {
    if (!g.phone) return;
    const { data } = await supabase.from('profiles').select('full_name').eq('id', me).maybeSingle();
    const hostName = (data as { full_name: string | null } | null)?.full_name || 'A friend';
    const { href } = eventInviteSmsHref(g.phone.replace(/[^\d+]/g, ''), hostName, post?.title ?? calEvent?.title ?? 'an event', smsWhen(), g.token);
    window.location.href = href;
  }

  // Everything hook-shaped must live ABOVE the early returns — React requires
  // the same hook sequence on every render. (A trailing effect below the
  // loading return crashed the whole app to a blank page the moment a real
  // event finished loading: "Rendered more hooks than during the previous
  // render".)
  const myStatus = calEvent?.attendees?.find((a) => a.profile_id === me)?.status ?? null;
  const isHost = !!post && post.author_id === me;
  // Room membership = host + going + maybes (invited-but-unanswered isn't in yet).
  const inRoom = isHost || myStatus === 'going' || myStatus === 'tentative';

  // Open (or lazily create) the event room — host or anyone going/maybe.
  useEffect(() => {
    if (tab !== 'Chat' || chatId || chatAsked.current) return;
    if (!me || !post?.linked_event_id || !inRoom) return;
    chatAsked.current = true;
    (async () => {
      const { data, error } = await supabase.rpc('ensure_event_chat', { p_event: post.linked_event_id });
      if (error) { console.warn('ensure_event_chat', error.message); setChatErr(true); return; }
      setChatId(data as string);
    })();
  }, [tab, chatId, me, post, inRoom]);

  if (loading) return <div className="evp"><p className="evp__muted">Loading…</p></div>;
  if (!post) return <div className="evp"><p className="evp__muted">This event isn't available.</p></div>;

  const hostName = post.author_space?.name || post.author?.full_name || 'A member';
  const title = post.title || hostName + "'s event";
  const hero = post.image_url
    ?? (Array.isArray(post.details?.media)
      ? (post.details.media as { type: string; url: string }[]).find((m) => m.type === 'photo')?.url
      : undefined);
  const going = !!myStatus && myStatus !== 'declined';
  const attendees = (calEvent?.attendees ?? []).filter((a) => a.status !== 'declined');
  const goingCount = attendees.filter((a) => a.status === 'going').length;
  const maybeCount = attendees.filter((a) => a.status === 'tentative').length;
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

  // Going / Maybe buttons: tap your current answer again to cancel.
  async function setRsvp(status: 'going' | 'tentative') {
    if (!me || !post?.linked_event_id) return;
    try {
      if (myStatus === status) await unRsvp(post.linked_event_id, me);
      else await rsvpToEvent(post.linked_event_id, me, status);
      await load();
    } catch (e) { console.error('rsvp', e); }
  }

  const TABS: Tab[] = ['About', 'Updates', 'Chat', 'RSVP', 'Book'];

  /** Host cancels: the calendar event goes first (cascades guests' calendar
   *  entries and the event chat room), then the post itself. */
  async function cancelEvent() {
    if (!post || !isHost) return;
    const ok = await confirmDialog({
      message: "Cancel this event? Guests' calendars and the event chat will be removed too.",
      confirmLabel: 'Cancel event', cancelLabel: 'Keep it', danger: true,
    });
    if (!ok) return;
    try {
      if (post.linked_event_id) await deleteEvent(post.linked_event_id);
      await deletePost(post.id);
      navigate('/events');
    } catch (e) {
      console.error('cancel event', e);
    }
  }
  return (
    <div className="evp">
      {/* Sticky title + tabs (à la the calendar pin) */}
      <div className="evp__pin">
        {/* The TopBar's arrow is the one back button (founder 2026-09-24). */}
        <div className="evp__titlerow">
          <h1 className="evp__title">{title}</h1>
          <button
            className="evp__host evp__host--link"
            onClick={() => navigate(post.author_space_id ? `/spaces/${post.author_space_id}` : `/members/${post.author_id}`)}
          >
            by {hostName}
          </button>
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
        {isHost && (
          <div className="evp__manage">
            <button
              className="evp__manage-btn"
              onClick={() => navigate(`/compose?area=events&post=${post.id}`)}
            >
              Edit event
            </button>
            <button className="evp__manage-btn evp__manage-btn--danger" onClick={cancelEvent}>
              Cancel event
            </button>
          </div>
        )}
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
          {Array.isArray(post.details?.previews) && (post.details.previews as { url: string }[]).length > 0 && (
            <div className="cpost__previews">
              {(post.details.previews as Parameters<typeof CarePreview>[0]['p'][]).map((pv, i) => (
                <CarePreview key={i} p={pv} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'Updates' && (
        <div className="evp__body">
          {updates.length === 0 && <p className="evp__muted">No updates yet — the host's follow-up posts will land here.</p>}
          {updates.map((p) => (
            <FeedCard
              key={p.id}
              {...postToCard(p, me)}
              mycelium={upOverlays[p.id]}
              trusted={upVouched.has(posterTrustKey(p))}
              availability={{ trust: !!me && p.author_id !== me }}
              onTrust={me ? (on) => { void trustPostPoster(p, on).catch(console.error); } : undefined}
              recommended={upRecs.has('post:' + p.id)}
              onRecommend={me ? (on) => { void setRecommend('post', p.id, on).catch(console.error); } : undefined}
              saved={upSaves.has('post:' + p.id)}
              onSave={me ? (on) => { void setSaved('post', p.id, on).catch(console.error); } : undefined}
              viewerIsAuthor={p.author_id === me}
            />
          ))}
        </div>
      )}

      {tab === 'Chat' && (
        inRoom ? (
          chatId ? (
            <div className="evp__chat">
              <ChatConversation chatId={chatId} me={me} showIntro={false} />
            </div>
          ) : (
            <div className="evp__body">
              <p className="evp__muted">{chatErr ? "The room couldn't open — run the event-chat migration, or try again." : 'Opening the room…'}</p>
            </div>
          )
        ) : (
          <div className="evp__body">
            <p className="evp__muted">The chat is for everyone who's going — or might be.</p>
            <button className="btn btn-primary evp__rsvp-btn" onClick={() => setRsvp('going')} disabled={!post.linked_event_id}>
              RSVP to join the room
            </button>
          </div>
        )
      )}

      {tab === 'RSVP' && (
        <div className="evp__body">
          <div className="evp__rsvp-row">
            <button className="btn btn-primary evp__rsvp-btn" onClick={() => setRsvp('going')} disabled={!post.linked_event_id}>
              {myStatus === 'going' ? 'Going ✓ — tap to cancel' : "Going — I'll be there"}
            </button>
            <button
              className={'btn evp__rsvp-btn evp__rsvp-btn--maybe' + (myStatus === 'tentative' ? ' is-on' : '')}
              onClick={() => setRsvp('tentative')}
              disabled={!post.linked_event_id}
            >
              {myStatus === 'tentative' ? 'Maybe ✓ — tap to cancel' : 'Maybe'}
            </button>
          </div>
          <p className="evp__count">
            {goingCount} going{maybeCount > 0 ? ` · ${maybeCount} maybe` : ''}
          </p>
          <div className="evp__people">
            {attendees.map((a) => (
              <div className="evp__person" key={a.profile_id}>
                <Avatar id={a.profile_id} name={a.profile?.full_name ?? 'Member'} url={a.profile?.avatar_url} size={34} />
                <span className="evp__person-name">{a.profile?.full_name ?? 'Member'}</span>
                {a.status === 'invited' && <span className="evp__person-status">invited</span>}
                {a.status === 'tentative' && <span className="evp__person-status">maybe</span>}
              </div>
            ))}
          </div>

          {isHost && post.linked_event_id && (
            <div className="evp__guests">
              <h3 className="evp__guests-h">Invite someone outside Lichen</h3>
              <p className="evp__guests-sub">
                An email sends them a pretty invitation{postToCard(post).media?.some((m) => m.type === 'photo') ? ' wearing your event’s cover photo' : ' — add a photo to this event and the invitation wears it'};
                a phone number opens a ready-to-send text from your own Messages. No account
                needed — they can RSVP, add it to their calendar, and ask to join Lichen.
              </p>
              <div className="evp__guests-form">
                <input className="evp__guests-input" placeholder="Their name" value={gName} onChange={(e) => setGName(e.target.value)} />
                <input className="evp__guests-input" placeholder="Their email or phone"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={gContact} onChange={(e) => setGContact(e.target.value)} />
                <button className="btn btn-primary evp__guests-send" onClick={sendGuestInvite}
                  disabled={gBusy || !gName.trim() || !gContact.trim()}>
                  {gBusy ? 'Sending…' : 'Send invite'}
                </button>
              </div>
              {gMsg && <p className="evp__guests-msg">{gMsg}</p>}
              {gText && (
                <p className="evp__guests-msg"><a className="link-cue" href={gText.href}>Text {gText.name} the invite ›</a></p>
              )}

              {/* THE SHAREABLE URL (founder 2026-11-04): one link for
                  anywhere — and it WEARS THE AUDIENCE'S TIER (same day,
                  the Drive-ladder rule: "generating a link would auto
                  apply the restrictions of audience to the link"):
                  Anyone → the link admits directly; Everyone on Lichen →
                  members RSVP in-app, off-Lichen openers knock; a subset →
                  on-list recognized, everyone else knocks. Enforced
                  server-side off the post's visibility in
                  request_event_spot. "New link" stays the kill switch. */}
              <div className="evp__sharelink">
                <p className="evp__guests-sub">
                  Or share one link anywhere — a flyer, a group text, a post. It follows your
                  audience: {post.visibility === 'public'
                    ? 'this event is open to anyone, so whoever opens the link can RSVP straight away.'
                    : post.visibility === 'lichen'
                      ? 'members RSVP right away inside Lichen; anyone off Lichen asks to come and you approve them right here.'
                      : 'people you invited are recognized and land on their own invitation; anyone else asks to come and you approve them right here.'}
                </p>
                {shareLink ? (
                  <>
                    <p className="evp__sharelink-url">{shareLink}</p>
                    <div className="evp__sharelink-row">
                      <button className="btn evp__sharelink-btn" onClick={() => void copyLink()}>{linkCopied ? 'Copied ✓' : 'Copy the link'}</button>
                      <button className="btn evp__sharelink-btn" onClick={() => void makeLink(true)} disabled={linkBusy}>New link</button>
                    </div>
                    <p className="evp__guests-fine">“New link” retires the old one everywhere it was posted.</p>
                  </>
                ) : (
                  <button className="btn btn-primary evp__guests-send" onClick={() => void makeLink()} disabled={linkBusy}>
                    {linkBusy ? 'Making it…' : 'Create the shareable link'}
                  </button>
                )}
              </div>

              {guests.some((g) => g.status === 'requested') && (
                <>
                  <h4 className="evp__guests-h4">Asked to come</h4>
                  <ul className="evp__guests-list">
                    {guests.filter((g) => g.status === 'requested').map((g) => (
                      <li key={g.id} className="evp__guest">
                        <span className="evp__guest-name">
                          {g.name}
                          <span className="evp__guest-contact"> · {g.email ?? g.phone}</span>
                        </span>
                        <span className="evp__guest-acts">
                          <button className="evp__guest-approve" onClick={() => void approveGuest(g)} disabled={gActBusy === g.id}>
                            {gActBusy === g.id ? '…' : 'Approve'}
                          </button>
                          <button className="evp__guest-refuse" onClick={() => void refuseGuest(g)} disabled={gActBusy === g.id}>
                            {armDecline === g.id ? 'Sure?' : 'Not a fit'}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {guests.some((g) => g.status !== 'requested') && (
                <ul className="evp__guests-list">
                  {guests.filter((g) => g.status !== 'requested').map((g) => (
                    <li key={g.id} className="evp__guest">
                      <span className="evp__guest-name">{g.name}</span>
                      {g.phone && (
                        <button className="evp__guest-retext" onClick={() => void reTextGuest(g)}>Text ›</button>
                      )}
                      <span className="evp__guest-status">{g.status === 'invited' ? 'invited' : g.status === 'going' ? 'going' : g.status === 'tentative' ? 'maybe' : "can't"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
