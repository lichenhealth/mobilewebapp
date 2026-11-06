import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { LichenMark } from '../components/LichenMark';
import {
  loadGuestPost, requestPurchase, cancelPurchase, startPostCheckout, centsLabel,
  type GuestPostInfo,
} from '../lib/postGuestsApi';
import './GuestEvent.css';

/** A listing shared privately with someone off Lichen (/p/:token —
 *  founder 2026-11-06: "they shouldn't have to join lichen to engage in the
 *  specific piece of content, but they can if they want as we have a CTA").
 *  The invitation card's anatomy; buying is ask → the seller's yes → card. */
export default function GuestPost() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<GuestPostInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [photoIx, setPhotoIx] = useState(0);
  const justPaid = params.get('paid') === '1';

  async function reload() {
    try { setInfo(await loadGuestPost(token)); }
    catch { setInfo(null); }
    setReady(true);
  }
  useEffect(() => { void reload(); }, [token]);
  // Back from Stripe: the webhook lands a breath after the redirect —
  // re-read a few times until the order reads paid (or in transit).
  useEffect(() => {
    if (!justPaid) return;
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      void loadGuestPost(token).then((i) => {
        if (i) setInfo(i);
        if (i?.order_paid_at || i?.order_pending_at || n >= 8) window.clearInterval(t);
      });
    }, 2000);
    return () => window.clearInterval(t);
  }, [justPaid, token]);

  async function ask() {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await requestPurchase(token, note.trim()); await reload(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await cancelPurchase(token); await reload(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function pay() {
    if (busy) return;
    setBusy(true); setMsg('');
    try { window.location.href = await startPostCheckout(token); }
    catch (e) { setMsg((e as Error).message); setBusy(false); }
  }

  if (!ready) return <div className="gev"><p className="gev__muted">Loading…</p></div>;
  if (!info) return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>
      <p className="gev__muted">This link isn’t valid, or the listing has been taken down.</p>
    </div>
  );

  const title = info.title?.trim() || (info.body ?? '').trim().slice(0, 60) || 'A listing';
  const photo = info.photos[photoIx] ?? null;
  const ccyOnly = !!info.currentcy_only;
  const buyable = !ccyOnly && (info.price_cents ?? 0) >= 100 && (info.price_cents ?? 0) <= 500000;
  const st = info.order_status;
  const paid = !!info.order_paid_at || st === 'paid';
  const inTransit = !paid && !!info.order_pending_at;
  const orderAmt = centsLabel(info.order_price_cents ?? info.price_cents ?? 0);
  const seller = info.seller_name;

  return (
    <div className="gev">
      <div className="gev__brand"><LichenMark size={40} /><span>Lichen</span></div>

      <div className="gev__card">
        {photo && (
          <div className="gev__hero">
            <img src={photo} alt="" />
          </div>
        )}
        {info.photos.length > 1 && (
          <div className="gpost__dots" role="tablist" aria-label="Photos">
            {info.photos.map((_, i) => (
              <button key={i} className={'gpost__dot' + (i === photoIx ? ' is-on' : '')}
                aria-label={`Photo ${i + 1}`} onClick={() => setPhotoIx(i)} />
            ))}
          </div>
        )}
        <div className="gev__card-body">
          <p className="gev__eyebrow">
            {seller} shared this with you{info.guest_name ? `, ${info.guest_name.split(' ')[0]}` : ''}
          </p>
          <h1 className="gev__title">{title}</h1>
          {info.price && <p className="gpost__price">{info.price}</p>}
          {info.body && <p className="gev__desc">{info.body}</p>}
        </div>
      </div>

      {user && (
        <p className="gev__member">
          You’re signed in to Lichen —{' '}
          <button className="gev__joinlink" onClick={() => navigate(`/posts/${info.post_id}`)}>
            open this listing inside
          </button>{' '}
          to message {seller} or trade as yourself.
        </p>
      )}

      {/* BUYING — ask, the seller's yes, then card. Nothing is charged
          before the seller confirms, so a "no" never needs a refund. */}
      {buyable && (
        <div className="gev__section">
          {paid ? (
            <>
              <p className="gev__label">Paid ✓</p>
              <p className="gev__muted">
                You paid {orderAmt}. <span className="nobr">{seller}</span> has been told and will be in touch to
                arrange the hand-off. A receipt is in your email.
              </p>
            </>
          ) : inTransit ? (
            <>
              <p className="gev__label">Your bank transfer is on its way</p>
              <p className="gev__muted">It usually clears within a few business days — {seller} will hear when it lands.</p>
            </>
          ) : st === 'accepted' ? (
            <>
              <p className="gev__label"><span className="nobr">{seller}</span> said yes</p>
              <p className="gev__muted">Pay {orderAmt} by card through Lichen’s secure checkout.</p>
              <div className="gpost__acts">
                <button className="btn gev__btn gpost__pay" onClick={() => void pay()} disabled={busy}>
                  {busy ? 'Opening checkout…' : `Pay ${orderAmt}`}
                </button>
                <button className="gpost__quiet" onClick={() => void withdraw()} disabled={busy}>Never mind</button>
              </div>
              {justPaid && <p className="gev__muted">Checking on your payment…</p>}
            </>
          ) : st === 'requested' ? (
            <>
              <p className="gev__label">You asked to buy this</p>
              <p className="gev__muted">
                Your request is with <span className="nobr">{seller}</span>. Once they say yes, this page opens a
                card payment for {orderAmt} — and we’ll email you. Nothing is charged until then.
              </p>
              <button className="gpost__quiet" onClick={() => void withdraw()} disabled={busy}>Withdraw my request</button>
            </>
          ) : (
            <>
              <p className="gev__label">
                {st === 'declined' ? `${seller} couldn’t take your last request` : 'Want it?'}
              </p>
              <p className="gev__muted">
                Ask to buy it for {centsLabel(info.price_cents ?? 0)} — once {seller} says yes, you pay by card.
                No account needed.
              </p>
              <div className="gev__ask">
                <textarea className="gev__ask-input" rows={2} placeholder="A note for the seller (optional) — pickup, timing, questions"
                  value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                <button className="btn gev__btn gev__ask-send" onClick={() => void ask()} disabled={busy}>
                  {busy ? 'Sending…' : 'Ask to buy'}
                </button>
              </div>
            </>
          )}
          {!paid && !user && (
            <p className="gev__muted gpost__ccy">
              Rather pay in Current-cy, Lichen&rsquo;s own currency?{' '}
              <a className="gev__joinlink" href="/signup">Become a member</a> and trade inside the network.
            </p>
          )}
          {msg && <p className="gev__muted gpost__err">{msg}</p>}
        </div>
      )}

      {/* CURRENT-CY ONLY (founder 2026-11-06): the seller trades this one
          inside Lichen's economy — the guest's door is joining, not a card. */}
      {ccyOnly && !paid && (
        <div className="gev__section">
          <p className="gev__label">Traded in Current-cy</p>
          <p className="gev__muted">
            <span className="nobr">{seller}</span> takes Current-cy for this one — Lichen&rsquo;s own currency,
            one per dollar. To buy it, join Lichen; your membership is free while we&rsquo;re in alpha.
          </p>
          {user ? (
            <button className="btn gev__btn" onClick={() => navigate(`/posts/${info.post_id}`)}>Open it inside Lichen</button>
          ) : (
            <a className="btn gev__btn" href="/signup">Request to join Lichen</a>
          )}
        </div>
      )}

      <footer className="gev__join">
        <p>
          Lichen is a community for healing, growing and creating — <span className="nobr">{seller}</span> is a member.{' '}
          <a className="gev__joinlink" href="/signup">Request to join Lichen</a>
        </p>
      </footer>
    </div>
  );
}
