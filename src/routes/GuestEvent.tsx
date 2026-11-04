import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { LichenMark } from '../components/LichenMark';
import {
  loadGuestEvent, guestRsvp, loadOpenEvent, requestEventSpot,
  type GuestEventInfo, type GuestStatus, type OpenEventInfo,
} from '../lib/eventGuestsApi';
import { classifyCareContact } from '../lib/careTeamApi';
import AddToCal from '../components/AddToCal';
import './GuestEvent.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60, ap = h < 12 ? 'am' : 'pm', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}
function whenText(e: OpenEventInfo): string {
  const [y, m, d] = e.start_date.split('-').map(Number);
  const dow = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const date = `${dow}, ${MONTHS[m - 1]} ${d}, ${y}`;
  if (e.all_day || e.start_min == null) return date;
  const end = e.end_min != null ? `–${minLabel(e.end_min)}` : '';
  return `${date} · ${minLabel(e.start_min)}${end}`;
}

/** Public guest landing for an external event invite (/e/:token). No account:
 *  add it to your own calendar, RSVP as a guest, or make a Lichen account. */
export default function GuestEvent() {
  const { token = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<GuestEventInfo | null>(null);
  // THE OPEN EVENT URL (founder 2026-11-04): /e/ answers the event's own
  // SHAREABLE token too — same page, same invitation card, but the RSVP is
  // an ASK: name + contact; someone already on the invite list is
  // recognized and handed to their real invitation, everyone else waits on
  // the host's yes.
  const [open, setOpen] = useState<OpenEventInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string>('invited');
  const [busy, setBusy] = useState(false);
  const [oName, setOName] = useState('');
  const [oContact, setOContact] = useState('');
  const [oMsg, setOMsg] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const i = await loadGuestEvent(token);
      if (!live) return;
      if (i) { setInfo(i); setOpen(null); setStatus(i.guest_status ?? 'invited'); setReady(true); return; }
      const o = await loadOpenEvent(token);
      if (!live) return;
      setInfo(null); setOpen(o); setReady(true);
    })();
    return () => { live = false; };
  }, [token]);

  async function askToCome() {
    if (busy || !oName.trim() || !oContact.trim()) return;
    const c = classifyCareContact(oContact);
    if (c.kind !== 'email' && c.kind !== 'phone') {
      setOMsg('That doesn’t read as an email or a phone number.'); return;
    }
    setBusy(true); setOMsg('');
    try {
      const res = await requestEventSpot(token, oName.trim(),
        c.kind === 'email' ? { email: c.email } : { phone: c.sms });
      // Their own token answers from here — recognized invitees land on
      // their standing invitation, new asks on the waiting state.
      navigate(`/e/${res.token}`, { replace: false });
    } catch (e) {
      setOMsg((e as Error).message || 'Could not send your request.');
    } finally { setBusy(false); }
  }

  const evSrc = info ?? open;
  const cal = useMemo(() => evSrc && ({
    title: evSrc.title, description: evSrc.description, location: evSrc.location,
    start_date: evSrc.start_date, end_date: evSrc.end_date, all_day: evSrc.all_day,
    start_min: evSrc.start_min, end_min: evSrc.end_min,
  }), [evSrc]);

  async function rsvp(s: GuestStatus) {
    if (busy) return;
    setBusy(true);
    const prev = status; setStatus(s);
    try { await guestRsvp(token, s); }
    catch { setStatus(prev); }
    finally { setBusy(false); }
  }

  if (!ready) return <div className="gev"><p className="gev__muted">Loading…</p></div>;
  if (!info && !open) return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>
      <p className="gev__muted">This invitation link isn’t valid or has been withdrawn.</p>
    </div>
  );

  const ev = (info ?? open)!;
  const requested = !!info && status === 'requested';

  return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>

      {/* THE INVITATION CARD (founder 2026-11-04: "pretty invites, like
          paperless post or canva"): the event's own cover photo crowns a
          centered paper card — the emailed invitation wears the same
          anatomy, so the link lands on what the email promised. */}
      <div className="gev__card">
        {ev.photo_url && <div className="gev__hero"><img src={ev.photo_url} alt="" /></div>}
        <div className="gev__card-body">
          <p className="gev__eyebrow">
            {info
              ? (requested ? `Your request is with ${ev.host_name}` : `${ev.host_name} invited you${info.guest_name ? `, ${info.guest_name}` : ''}`)
              : `${ev.host_name} is hosting`}
          </p>
          <h1 className="gev__title">{ev.title}</h1>
          <div className="gev__facts">
            <p className="gev__fact"><Icon name="calendar" size={14} /> {whenText(ev)}</p>
            {ev.location && <p className="gev__fact"><Icon name="location" size={14} /> {ev.location}</p>}
          </div>
          {ev.description && <p className="gev__desc">{ev.description}</p>}
        </div>
      </div>

      {/* A MEMBER IS RECOGNIZED (founder 2026-11-04: "if you are [a
          member], it auto fills your info"): signed in, the real event
          page is one tap away — the RSVP there rides their own account,
          nothing to type. The guest paths below still work either way. */}
      {user && ev.post_id && (
        <p className="gev__member">
          You’re signed in to Lichen —{' '}
          <button className="gev__joinlink" onClick={() => navigate(`/events/${ev.post_id}`)}>
            open this event inside
          </button>{' '}
          and RSVP as yourself.
        </p>
      )}

      {info && !requested && (
        <div className="gev__section">
          <p className="gev__label">Add it to your calendar</p>
          <div className="gev__cal">
            {cal && <AddToCal ev={cal} file={`${ev.title}.ics`} />}
          </div>
        </div>
      )}

      {info && !requested && (
        <div className="gev__section">
          <p className="gev__label">Can you come? {status !== 'invited' && <em className="gev__status">— you said {status === 'going' ? "you're going" : status === 'tentative' ? 'maybe' : "you can't make it"}</em>}</p>
          <div className="gev__rsvp">
            <button className={'btn gev__btn' + (status === 'going' ? ' is-on' : '')} onClick={() => rsvp('going')} disabled={busy}>Going</button>
            <button className={'btn gev__btn' + (status === 'tentative' ? ' is-on' : '')} onClick={() => rsvp('tentative')} disabled={busy}>Maybe</button>
            <button className={'btn gev__btn' + (status === 'declined' ? ' is-on' : '')} onClick={() => rsvp('declined')} disabled={busy}>Can’t make it</button>
          </div>
        </div>
      )}

      {/* The WAITING state (the open URL's approval gate): a request isn't
          an RSVP yet — the host's yes comes first, and the server refuses
          a self-serve RSVP on a requested row either way. */}
      {requested && (
        <div className="gev__section">
          <p className="gev__label">You asked to come</p>
          <p className="gev__muted">
            Your request is with <span className="nobr">{ev.host_name}</span> — once they say yes,
            this page opens up for your RSVP and calendar. Keep the link.
          </p>
        </div>
      )}

      {/* THE OPEN ASK (founder 2026-11-04: "if you're not also on an invite
          list, the request to attend prompts an approval from the host"):
          name + contact. A contact already on the invite list is handed
          straight to their own invitation. */}
      {!info && open && (
        <div className="gev__section">
          <p className="gev__label">Want to come?</p>
          <p className="gev__muted">
            Tell {open.host_name} who you are — if they invited you directly, your invitation
            opens right away; otherwise they’ll get your request.
          </p>
          <div className="gev__ask">
            <input className="gev__ask-input" placeholder="Your name"
              value={oName} onChange={(e) => setOName(e.target.value)} />
            <input className="gev__ask-input" placeholder="Your email or phone"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={oContact} onChange={(e) => setOContact(e.target.value)} />
            <button className="btn gev__btn gev__ask-send" onClick={() => void askToCome()}
              disabled={busy || !oName.trim() || !oContact.trim()}>
              {busy ? 'Sending…' : 'Ask to come'}
            </button>
          </div>
          {oMsg && <p className="gev__muted">{oMsg}</p>}
        </div>
      )}

      {/* The standard join footer (founder 2026-11-02 — one sentence, the
          host's name whole [.nobr], the CTA inline; "free to try" retired
          with the alpha-copy sweep). */}
      <footer className="gev__join">
        <p>
          Lichen is a community for healing, growing and creating — <span className="nobr">{ev.host_name}</span> is a member.{' '}
          <a className="gev__joinlink" href="/signup">Request to join Lichen</a>
        </p>
      </footer>
    </div>
  );
}
