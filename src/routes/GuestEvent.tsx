import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { LichenMark } from '../components/LichenMark';
import {
  loadGuestEvent, guestRsvp, loadOpenEvent, requestEventSpot, markGuestOpened, loadGuestMessages,
  type GuestEventInfo, type GuestStatus, type OpenEventInfo,
} from '../lib/eventGuestsApi';
import { classifyCareContact } from '../lib/careTeamApi';
import AddToCal from '../components/AddToCal';
import { zoneAbbr } from '../lib/bookingApi';
import { InviteCard, InviteEnvelope, InviteBackdropLayer } from '../components/InviteCard';
import { readInvite, resolveInvite, formAsks } from '../lib/inviteDesign';
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
  const tz = zoneAbbr(e.event_tz, e.start_date, e.start_min);
  return `${date} · ${minLabel(e.start_min)}${end}${tz ? ' ' + tz : ''}`;
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
  // RSVP EXTRAS (the Paperless Post audit): plus-ones, a meal, the host's questions.
  const [plus, setPlus] = useState(0);
  const [meal, setMeal] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [xSaved, setXSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [xErr, setXErr] = useState('');
  const [notes, setNotes] = useState<{ body: string; author_name: string; created_at: string }[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const i = await loadGuestEvent(token);
      if (!live) return;
      if (i) {
        setInfo(i); setOpen(null); setStatus(i.guest_status ?? 'invited');
        setPlus(i.guest_plus_ones ?? 0); setMeal(i.guest_meal ?? '');
        setAnswers(Object.fromEntries((i.guest_answers ?? []).map((a) => [a.q, a.a])));
        setReady(true);
        void markGuestOpened(token);
        void loadGuestMessages(token).then((m) => { if (live) setNotes(m); });
        return;
      }
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

  async function saveExtras() {
    if (busy || (status !== 'going' && status !== 'tentative')) return;
    setXSaved('saving'); setXErr('');
    try {
      await guestRsvp(token, status as GuestStatus, {
        plus_ones: plus, meal: meal || null,
        answers: Object.entries(answers).filter(([, a]) => a.trim()).map(([q, a]) => ({ q, a: a.trim() })),
      });
      setXSaved('saved');
    } catch (e) { setXSaved('error'); setXErr((e as Error).message || 'Couldn’t save that.'); }
  }

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
  const design = readInvite(ev.invite);
  const rd = resolveInvite(design);
  const form = rd.form;
  const asks = formAsks(form);

  return (
    <div className="gev gev--card">
      <div className="gev__backdrop"><InviteBackdropLayer kind={rd.backdrop} accent={rd.accent} /></div>
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>

      {/* THE INVITATION, AS THE HOST DESIGNED IT (founder 2026-11-08, the
          Studio — Paperless Post parity): it arrives sealed in the host's
          envelope, the flap lifts, the card settles in. The card's own
          button walks down to the RSVP below. */}
      <InviteEnvelope design={design} peek={ev.title}>
        <InviteCard design={design}
          facts={{ title: ev.title, when: whenText(ev), where: ev.location || undefined, host: ev.host_name, photo: ev.photo_url }}
          cta={requested ? <span className="gev__cardnote">Your request is with <span className="nobr">{ev.host_name}</span></span> : (
            <button type="button" className="invc__cta gev__cardcta"
              onClick={() => document.getElementById('gev-act')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              {info ? rd.rsvp : 'Ask to come'}
            </button>
          )} />
      </InviteEnvelope>
      {ev.description && <p className="gev__desc gev__desc--below">{ev.description}</p>}

      {/* FROM THE HOST (the host's messages to everyone) — newest first. */}
      {notes.length > 0 && (
        <div className="gev__section">
          <p className="gev__label">From the host</p>
          {notes.map((n, i) => (
            <div key={i} className="gev__note">
              <p className="gev__note-body">{n.body}</p>
              <p className="gev__note-by">{n.author_name} · {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
            </div>
          ))}
        </div>
      )}

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
        <div className="gev__section" id="gev-act">
          <p className="gev__label">Can you come? {status !== 'invited' && <em className="gev__status">— you said {status === 'going' ? "you're going" : status === 'tentative' ? 'maybe' : "you can't make it"}</em>}</p>
          <div className="gev__rsvp">
            <button className={'btn gev__btn' + (status === 'going' ? ' is-on' : '')} onClick={() => rsvp('going')} disabled={busy}>Going</button>
            <button className={'btn gev__btn' + (status === 'tentative' ? ' is-on' : '')} onClick={() => rsvp('tentative')} disabled={busy}>Maybe</button>
            <button className={'btn gev__btn' + (status === 'declined' ? ' is-on' : '')} onClick={() => rsvp('declined')} disabled={busy}>Can’t make it</button>
          </div>
          {asks && (status === 'going' || status === 'tentative') && (
            <div className="gev__extras">
              {form.plusOnes > 0 && (
                <label className="gev__xfield">
                  <span>Bringing anyone?</span>
                  <select value={plus} onChange={(e) => { setPlus(Number(e.target.value)); setXSaved('idle'); }}>
                    {Array.from({ length: form.plusOnes + 1 }, (_, n) => (
                      <option key={n} value={n}>{n === 0 ? 'Just me' : `Me + ${n}`}</option>
                    ))}
                  </select>
                </label>
              )}
              {form.meals.length > 0 && (
                <div className="gev__xfield">
                  <span>Meal</span>
                  <div className="gev__meals">
                    {form.meals.map((m) => (
                      <button key={m} type="button" className={'gev__meal' + (meal === m ? ' is-on' : '')}
                        onClick={() => { setMeal(meal === m ? '' : m); setXSaved('idle'); }}>{m}</button>
                    ))}
                  </div>
                </div>
              )}
              {form.questions.map((q) => (
                <label className="gev__xfield" key={q}>
                  <span>{q}</span>
                  <textarea rows={2} maxLength={500} value={answers[q] ?? ''}
                    onChange={(e) => { setAnswers({ ...answers, [q]: e.target.value }); setXSaved('idle'); }} />
                </label>
              ))}
              <button className="btn gev__btn gev__xsave" onClick={() => void saveExtras()} disabled={xSaved === 'saving'}>
                {xSaved === 'saving' ? 'Saving…' : xSaved === 'saved' ? 'Saved ✓' : 'Send my answers'}
              </button>
              {xSaved === 'error' && <p className="gev__muted">{xErr}</p>}
            </div>
          )}
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
        <div className="gev__section" id="gev-act">
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
