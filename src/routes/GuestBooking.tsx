import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LichenMark } from '../components/LichenMark';
import { loadGuestBooking, guestCancelBooking, sendBookingMail, type GuestBookingView } from '../lib/bookingApi';
import { icsDataUri, googleCalUrl } from '../lib/ics';
import './GuestEvent.css';
import './Bookings.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const minLabel = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60, ap = h < 12 ? 'am' : 'pm', h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
};

const STATUS_LINE: Record<string, { head: string; sub: string }> = {
  pending: { head: 'Requested', sub: 'They confirm each request by hand — you’ll get an email as soon as they answer.' },
  confirmed: { head: 'You’re booked', sub: 'It’s on their calendar. Add it to yours below.' },
  declined: { head: 'That time didn’t work', sub: 'Their live availability always has the current picture — pick another slot whenever you like.' },
  cancelled: { head: 'Cancelled', sub: 'This booking is no longer held.' },
};

/** The guest's booking page (/b/:token) — the emailed link IS the key: see
 *  the status, add it to a calendar, or cancel. No account needed. */
export default function GuestBooking() {
  const { token = '' } = useParams();
  const [row, setRow] = useState<GuestBookingView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadGuestBooking(token).then((r) => { if (live) { setRow(r); setReady(true); } });
    return () => { live = false; };
  }, [token]);

  const cal = useMemo(() => row && ({
    title: `${row.type_title} — ${row.provider_name}`,
    description: row.note, location: row.type_location,
    start_date: row.on_date, end_date: row.on_date, all_day: false,
    start_min: row.start_min, end_min: row.end_min,
  }), [row]);

  if (!ready) return <div className="gev"><p className="gev__muted">Loading…</p></div>;
  if (!row) {
    return (
      <div className="gev">
        <div className="gev__mark"><LichenMark size={40} /><span>Lichen</span></div>
        <p className="gev__muted">This booking link isn&rsquo;t valid or has been withdrawn.</p>
      </div>
    );
  }

  const s = STATUS_LINE[row.status] ?? STATUS_LINE.pending;
  const [y, m, d] = row.on_date.split('-').map(Number);
  const dow = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  return (
    <div className="gev">
      <div className="gev__mark"><LichenMark size={40} /><span>Lichen</span></div>
      <header className="bkg__head">
        <p className="eyebrow">{s.head}</p>
        <h1 className="bkg__title display-italic">{row.type_title}</h1>
        <p className="bkg__sub">
          with {row.provider_name} · {dow}, {MONTHS[m - 1]} {d}, {y} · {minLabel(row.start_min)} – {minLabel(row.end_min)}
          {row.type_location ? ` · ${row.type_location}` : ''}
        </p>
        <p className="bkg__sub">{s.sub}</p>
      </header>

      {row.status === 'confirmed' && cal && (
        <div className="bkg__doneactions">
          <a className="btn bkg__btn" href={icsDataUri(cal)} download="lichen-booking.ics">Add to calendar (.ics)</a>
          <a className="btn bkg__btn" href={googleCalUrl(cal)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
        </div>
      )}

      {(row.status === 'pending' || row.status === 'confirmed') && (
        <div className="bkg__doneactions">
          <button
            className="btn bkg__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await guestCancelBooking(token);
                sendBookingMail(token);
                setRow({ ...row, status: 'cancelled' });
              } finally { setBusy(false); }
            }}
          >
            {busy ? 'One moment…' : 'Cancel this booking'}
          </button>
        </div>
      )}

      <footer className="gev__join">
        <p>Lichen is a community for healing, growing and creating — {row.provider_name} is a member.</p>
        <a className="btn bkg__btn" href="/signup">Learn about joining</a>
      </footer>
    </div>
  );
}
