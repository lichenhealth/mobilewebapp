import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LichenMark } from '../components/LichenMark';
import {
  loadGuestBooking, guestCancelBooking, guestRescheduleBooking, sendBookingMail,
  publicBookingBoard, slotsForDay, startBookingCheckout, usdLabel, payOpen,
  type GuestBookingView, type BookingBoard,
} from '../lib/bookingApi';
import { addDays, todayISO } from '../lib/conciergeApi';
import AddToCal from '../components/AddToCal';
import SlotMonth from '../components/SlotMonth';
import { videoServiceOf } from '../lib/linkify';
import { Icon } from '../components/Icon';
import PayDoors from '../components/PayDoors';
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
  cancelled: { head: 'Cancelled', sub: 'This booking has been cancelled.' },
};

/** The guest's booking page (/b/:token) — the emailed link IS the key: see
 *  the status, add it to a calendar, or cancel. No account needed. */
export default function GuestBooking() {
  const { token = '' } = useParams();
  const [row, setRow] = useState<GuestBookingView | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reschedule in place (founder 2026-10-03, the Calendly audit's #1 gap):
  // the token link is the key here too — pick a new open slot, the server
  // re-validates everything a fresh booking would.
  const [moving, setMoving] = useState(false);
  const [board, setBoard] = useState<BookingBoard | null>(null);
  const [moveErr, setMoveErr] = useState('');
  // The month grid's picked day — seeded to the day they'd BOOKED when the
  // picker opens (founder 2026-11-02: "bring back the cal with the orange
  // circles, but have the day they'd chosen selected as a placeholder…
  // choose a diff day if they want to, before selecting a new time").
  const [moveSel, setMoveSel] = useState<string | null>(null);
  // Payment (founder 2026-10-29): arriving back from Stripe (?paid=1) the
  // webhook's stamp can lag a breath — re-read once instead of showing an
  // unpaid page to someone who just paid.
  const [payErr, setPayErr] = useState('');
  const justPaid = new URLSearchParams(location.search).get('paid') === '1';
  // Arriving straight from the booking flow (founder 2026-11-02: "bring all
  // the details from the 'see your booking' page one page forward") — the
  // confirmation LANDS here now, so say the email is coming.
  const justBooked = new URLSearchParams(location.search).get('just') === '1';

  // The pickers' two-month browsable window (the SlotMonth standard).
  const moveFrom = useMemo(() => todayISO(), []);
  const moveTo = useMemo(() => addDays(moveFrom, 59), [moveFrom]);

  useEffect(() => {
    if (!moving || !row?.type_id || board) return;
    let live = true;
    void publicBookingBoard(row.type_id, moveFrom, moveTo)
      .then((b) => { if (live) setBoard(b); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, row?.type_id]);

  // Every day in the window with at least one open time — SlotMonth's fuel.
  const moveOpenDays = useMemo(() => {
    const out = new Set<string>();
    if (!board) return out;
    for (let i = 0; i < 60; i++) {
      const iso = addDays(moveFrom, i);
      if (slotsForDay(board, iso).length > 0) out.add(iso);
    }
    return out;
  }, [board, moveFrom]);
  const moveSlots = useMemo(
    () => (board && moveSel ? slotsForDay(board, moveSel) : []),
    [board, moveSel],
  );

  useEffect(() => {
    let live = true;
    void loadGuestBooking(token).then((r) => { if (live) { setRow(r); setReady(true); } });
    return () => { live = false; };
  }, [token]);

  // Quiet re-reads after a Stripe return while the webhook lands (a few
  // tries, then the page stands as it is — the emailed receipt still comes).
  // A bank transfer resolves to the in-transit state instead of paid — the
  // re-read picks up payment_pending_at and the page says so.
  useEffect(() => {
    if (!justPaid || !ready || row?.paid_at || row?.payment_pending_at) return;
    let live = true; let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (tries > 6) { clearInterval(t); return; }
      void loadGuestBooking(token).then((r) => {
        if (!live || !r) return;
        setRow(r);
        if (r.paid_at) clearInterval(t);
      });
    }, 2500);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPaid, ready, row?.paid_at]);

  const cal = useMemo(() => {
    if (!row) return null;
    // THE INVITE WEARS THE SERVICE'S NAME, never the raw address (founder
    // 2026-10-07: "having zoom be what is shown in the invite as the link
    // to the meeting, instead of a long, ugly URL"): LOCATION reads "Zoom" /
    // "Google Meet", the real link rides the description's first line (still
    // tappable in Google/Apple/Outlook) AND the ICS URL property; a real
    // place rides along after.
    const svc = row.meeting_url ? (videoServiceOf(row.meeting_url) ?? 'Video call') : null;
    return {
      title: `${row.type_title} — ${row.provider_name}`,
      description: [
        row.meeting_url ? `Join ${svc}:\n${row.meeting_url}` : '',
        row.note,
        row.meeting_url && row.type_location ? `Location: ${row.type_location}` : '',
      ].filter(Boolean).join('\n\n'),
      location: row.meeting_url ? svc! : row.type_location,
      url: row.meeting_url || undefined,
      start_date: row.on_date, end_date: row.on_date, all_day: false,
      start_min: row.start_min, end_min: row.end_min,
    };
  }, [row]);

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
        {justBooked && <p className="bkg__sub">A confirmation email is on its way to your inbox.</p>}
      </header>

      {/* THE WAY FORWARD (founder 2026-11-02, from the cancelled page whose
          only link was the dead booking: "a CTA to book a different
          time/meeting type with Galyn, and take users to
          lichen.health/book/galyn so they see the highest level link"):
          cancelled/declined lead to the provider's TOP-LEVEL booking menu. */}
      {(row.status === 'cancelled' || row.status === 'declined') && row.provider_handle && (
        <div className="bkg__doneactions">
          <a className="btn btn-primary bkg__btn" href={`/book/${row.provider_handle}`}>
            Book another time with {row.provider_name.split(' ')[0]}
          </a>
        </div>
      )}

      {/* PAYMENT (founder 2026-10-29): the frozen price + where it stands.
          Instant types pay right away; request types once confirmed —
          nothing charges before the provider's yes. */}
      {!!row.price_cents && row.paid_at && (
        <p className="bkg__sub" style={{ color: '#4a7a52', fontWeight: 600 }}>Paid ✓ · {usdLabel(row.price_cents)}</p>
      )}
      {!!row.price_cents && !row.paid_at && row.payment_pending_at && (
        <p className="bkg__sub">
          Your bank transfer is on its way — it usually clears within a few
          business days. Nothing more to do; you&rsquo;ll get an email when it lands.
        </p>
      )}
      {!!row.price_cents && !row.paid_at && !row.payment_pending_at && justPaid && (
        <p className="bkg__sub">Payment received — confirming it now…</p>
      )}
      {payErr && <p className="bkg__error">{payErr}</p>}
      {payOpen(row) && !justPaid && (
        <div className="bkg__doneactions">
          <button
            className="btn btn-primary bkg__btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setPayErr('');
              try { window.location.href = await startBookingCheckout({ token }); }
              catch (e) { setPayErr((e as { message?: string } | null)?.message || 'Checkout failed.'); setBusy(false); }
            }}
          >
            {busy ? 'One moment…'
              : row.pay_choice === 'later' ? `Settle up — pay ${usdLabel(row.price_cents!)}`
              : `Pay ${usdLabel(row.price_cents!)} to secure it`}
          </button>
        </div>
      )}
      {!!row.price_cents && !row.paid_at && row.status === 'pending' && row.approval !== 'instant' && (
        <p className="bkg__sub">{usdLabel(row.price_cents)} — payment opens once {row.provider_name} confirms.</p>
      )}
      {/* The provider's own ways to be paid (founder 2026-11-02) — shown once
          confirmed, until an online payment is recorded. */}
      {row.status === 'confirmed' && !row.paid_at && (
        <PayDoors
          methods={row.pay_methods}
          lead={payOpen(row) ? 'Or pay directly' : 'Ways to pay'}
          className="bkg__paydoors"
        />
      )}

      {row.status === 'confirmed' && row.meeting_url && (
        <div className="bkg__doneactions">
          <a className="btn btn-primary bkg__btn" href={row.meeting_url} target="_blank" rel="noopener noreferrer">
            <Icon name="video" size={14} /> Join {videoServiceOf(row.meeting_url) ?? 'the video call'}
          </a>
        </div>
      )}

      {/* The four major-calendar doors (founder 2026-11-02: "links to the
          major calendars out there to seamlessly add it to your most used
          cal") — one shared row, the .ics as the universal catch-all. */}
      {row.status === 'confirmed' && cal && <AddToCal ev={cal} />}

      {/* Actionable, so PEACH, with air above (founder 2026-11-02 markup). */}
      {(row.status === 'pending' || row.status === 'confirmed') && (
        <div className="bkg__doneactions bkg__doneactions--roomy">
          <button
            className="btn bkg__btn bkg__btn--act"
            onClick={() => {
              setMoveErr('');
              // Opening the picker seeds the month grid on the day they'd
              // already chosen — a placeholder they can walk away from.
              setMoveSel(row.on_date);
              setMoving((v) => !v);
            }}
          >
            {moving ? 'Never mind — keep this time' : 'Pick a new time'}
          </button>
          <button
            className="btn bkg__btn bkg__btn--act"
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

      {/* The reschedule picker speaks the SlotMonth grammar (founder
          2026-11-02: "when you choose a new time, bring back the cal with
          the orange circles, but have the day they'd chosen selected as a
          placeholder" — so a different day is one tap before any time). */}
      {moving && (row.status === 'pending' || row.status === 'confirmed') && (
        <section className="bkg__sec">
          {moveErr && <p className="bkg__error">{moveErr}</p>}
          {!board && <p className="gev__muted">Loading open times…</p>}
          {board && moveOpenDays.size === 0 && (
            <p className="gev__muted">No open times in the next two months — check back soon, or cancel and rebook later.</p>
          )}
          {board && moveOpenDays.size > 0 && (
            <>
              <SlotMonth
                availableDays={moveOpenDays}
                selected={moveSel}
                onSelect={setMoveSel}
                minIso={moveFrom}
                maxIso={moveTo}
              />
              {moveSel && (() => {
                const [yy, mm, dd] = moveSel.split('-').map(Number);
                const dt = new Date(Date.UTC(yy, mm - 1, dd));
                return (
                  <section className="bkg__day">
                    <h2 className="bkg__h2">{WEEKDAY[dt.getUTCDay()]} · {MONTHS[mm - 1]} {dd}</h2>
                    {moveSlots.length === 0 && (
                      <p className="gev__muted">Nothing open this day — pick a lit day above.</p>
                    )}
                    <div className="bkg__slots">
                      {moveSlots.map((s) => (
                        <button
                          key={s}
                          className="bkg__slot"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true); setMoveErr('');
                            try {
                              await guestRescheduleBooking(token, moveSel, s);
                              sendBookingMail(token);
                              const fresh = await loadGuestBooking(token);
                              if (fresh) setRow(fresh);
                              setMoving(false); setBoard(null); setMoveSel(null);
                            } catch (e) {
                              setMoveErr((e as { message?: string } | null)?.message || 'Something went wrong.');
                            } finally { setBusy(false); }
                          }}
                        >
                          {minLabel(s)}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })()}
            </>
          )}
        </section>
      )}

      {/* The standard join footer (founder 2026-11-02, marking this page's
          old button row: the name never splits [.nobr] and the CTA rides
          INLINE in the sentence — the BookPublic shape, missed here). */}
      <footer className="gev__join">
        <p>
          Lichen is a community for healing, growing and creating — <span className="nobr">{row.provider_name}</span> is a member.{' '}
          <a className="gev__joinlink" href="/signup">Request to join Lichen</a>
        </p>
      </footer>
    </div>
  );
}
