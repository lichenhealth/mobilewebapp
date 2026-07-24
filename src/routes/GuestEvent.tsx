import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import { loadGuestEvent, guestRsvp, type GuestEventInfo, type GuestStatus } from '../lib/eventGuestsApi';
import { icsDataUri, googleCalUrl } from '../lib/ics';
import './GuestEvent.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60, ap = h < 12 ? 'am' : 'pm', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}
function whenText(e: GuestEventInfo): string {
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
  const [info, setInfo] = useState<GuestEventInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string>('invited');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const i = await loadGuestEvent(token);
      if (!live) return;
      setInfo(i); setStatus(i?.guest_status ?? 'invited'); setReady(true);
    })();
    return () => { live = false; };
  }, [token]);

  const cal = useMemo(() => info && ({
    title: info.title, description: info.description, location: info.location,
    start_date: info.start_date, end_date: info.end_date, all_day: info.all_day,
    start_min: info.start_min, end_min: info.end_min,
  }), [info]);

  async function rsvp(s: GuestStatus) {
    if (busy) return;
    setBusy(true);
    const prev = status; setStatus(s);
    try { await guestRsvp(token, s); }
    catch { setStatus(prev); }
    finally { setBusy(false); }
  }

  if (!ready) return <div className="gev"><p className="gev__muted">Loading…</p></div>;
  if (!info) return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>
      <p className="gev__muted">This invitation link isn’t valid or has been withdrawn.</p>
    </div>
  );

  return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>
      <p className="gev__eyebrow">{info.host_name} invited you{info.guest_name ? `, ${info.guest_name}` : ''}</p>
      <h1 className="gev__title">{info.title}</h1>

      <div className="gev__facts">
        <p className="gev__fact"><Icon name="calendar" size={14} /> {whenText(info)}</p>
        {info.location && <p className="gev__fact"><Icon name="location" size={14} /> {info.location}</p>}
      </div>
      {info.description && <p className="gev__desc">{info.description}</p>}

      <div className="gev__section">
        <p className="gev__label">Add it to your calendar</p>
        <div className="gev__cal">
          {cal && <a className="btn gev__btn" href={icsDataUri(cal)} download={`${info.title}.ics`}>Apple / Outlook (.ics)</a>}
          {cal && <a className="btn gev__btn" href={googleCalUrl(cal)} target="_blank" rel="noreferrer">Google Calendar</a>}
        </div>
      </div>

      <div className="gev__section">
        <p className="gev__label">Can you come? {status !== 'invited' && <em className="gev__status">— you said {status === 'going' ? "you're going" : status === 'tentative' ? 'maybe' : "you can't make it"}</em>}</p>
        <div className="gev__rsvp">
          <button className={'btn gev__btn' + (status === 'going' ? ' is-on' : '')} onClick={() => rsvp('going')} disabled={busy}>Going</button>
          <button className={'btn gev__btn' + (status === 'tentative' ? ' is-on' : '')} onClick={() => rsvp('tentative')} disabled={busy}>Maybe</button>
          <button className={'btn gev__btn' + (status === 'declined' ? ' is-on' : '')} onClick={() => rsvp('declined')} disabled={busy}>Can’t make it</button>
        </div>
      </div>

      <p className="gev__join">
        Want the full experience? <a href="/signup">Create a Lichen account</a> — it’s free to try.
      </p>
    </div>
  );
}
