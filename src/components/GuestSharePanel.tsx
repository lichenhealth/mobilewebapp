import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { classifyCareContact } from '../lib/careTeamApi';
import { listGuestLists, type GuestList } from '../lib/guestListsApi';
import {
  listPostGuests, listPostOrders, addPostGuest, emailPostGuest, removePostGuest,
  respondPostOrder, guestPostLink, postShareSmsHref, centsLabel,
  type PostGuest, type PostOrder,
} from '../lib/postGuestsApi';
import './GuestSharePanel.css';

// SHARE PRIVATELY + SELL TO PEOPLE OFF LICHEN (founder 2026-11-06: "if
// someone off lichen is on the list, it allows them to see the marketplace
// listing… To actually buy the item… they'd have to check out as a guest").
// The seller's side: give someone a private /p/ link (email it from Lichen,
// or text it from your own Messages), pull people in from a guest list, and
// answer purchase requests. Accepting opens card checkout for the guest;
// nothing is charged before the seller's yes.

type Props = { postId: string; me: string; title: string; sellerName: string; priced: boolean };

/** "Rick Countryman rick@barn.com" → name + contact (the tail-phone rule). */
function readLine(raw: string): { name: string; email?: string; phone?: string; sms?: string } | null {
  const c = classifyCareContact(raw);
  const strip = (s: string) => s.replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/\+?[\d\s().-]{7,}/g, '').replace(/[<>,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (c.kind === 'email') return { name: strip(raw), email: c.email };
  if (c.kind === 'phone') return { name: strip(raw), phone: c.digits, sms: c.sms };
  const tail = /(\+?[\d\s().-]{7,})$/.exec(raw.trim());
  const digits = tail ? tail[1].replace(/\D/g, '') : '';
  if (tail && digits.length >= 7 && digits.length <= 16) {
    return { name: strip(raw), phone: digits, sms: tail[1].replace(/[^\d+]/g, '') };
  }
  return null;
}

export default function GuestSharePanel({ postId, me, title, sellerName, priced }: Props) {
  const [isHost, setIsHost] = useState(false);
  const [guests, setGuests] = useState<PostGuest[]>([]);
  const [orders, setOrders] = useState<PostOrder[]>([]);
  const [lists, setLists] = useState<GuestList[]>([]);
  const [line, setLine] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [mailing, setMailing] = useState<string | null>(null);
  const [delGuest, setDelGuest] = useState<string | null>(null);

  async function refresh() {
    const [g, o] = await Promise.all([listPostGuests(postId), listPostOrders(postId)]);
    setGuests(g); setOrders(o);
  }
  useEffect(() => {
    if (!me) return;
    let live = true;
    void supabase.rpc('post_host', { p_post: postId, p_uid: me }).then(({ data }) => {
      if (!live || data !== true) return;
      setIsHost(true);
      void refresh();
      void listGuestLists(me).then((l) => { if (live) setLists(l); });
    });
    return () => { live = false; };
  }, [postId, me]);

  // A bell lands here with #orders — scroll once the panel is standing.
  useEffect(() => {
    if (!isHost || window.location.hash !== '#orders') return;
    const t = window.setTimeout(() => document.getElementById('orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => window.clearTimeout(t);
  }, [isHost, orders.length]);

  if (!isHost) return null;

  async function add(c: { name: string; email?: string; phone?: string }) {
    const dup = guests.some((g) => (c.email && g.email === c.email) || (c.phone && g.phone === c.phone));
    if (dup) return null;
    return addPostGuest(postId, me, c);
  }

  async function addLine() {
    const r = readLine(line);
    if (!r) { setMsg('Type an email or a phone number — a name in front is fine.'); return; }
    setBusy(true); setMsg(null);
    try {
      const g = await add(r);
      if (!g) { setMsg('They already have a link.'); }
      else if (g.email) {
        setMailing(g.id);
        try { await emailPostGuest(g.id); setMsg(`Emailed ${g.name || g.email} their private link ✓`); }
        catch (e) { setMsg((e as Error).message); }
        finally { setMailing(null); }
      } else if (r.sms) {
        window.location.href = postShareSmsHref(r.sms, sellerName, title, g.token);
        setMsg('Their link is ready — your Messages app opened with it.');
      }
      setLine('');
      await refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function addList(gl: GuestList) {
    setBusy(true); setMsg(null);
    let n = 0;
    try {
      for (const e of gl.entries) {
        if (e.kind === 'member') continue;
        const g = await add(e.kind === 'email'
          ? { name: e.name, email: e.value }
          : { name: e.name, phone: e.value });
        if (g?.email) { try { await emailPostGuest(g.id); } catch { /* row still stands; Email again */ } }
        if (g) n += 1;
      }
      const skippedMembers = gl.entries.filter((e) => e.kind === 'member').length;
      setMsg(`${n} new link${n === 1 ? '' : 's'} from “${gl.name}” — emails went out; phone numbers wait for your Text ›.`
        + (skippedMembers ? ` (${skippedMembers} member${skippedMembers === 1 ? '' : 's'} on Lichen already see it inside.)` : ''));
      await refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  async function mail(g: PostGuest) {
    setMailing(g.id);
    try { await emailPostGuest(g.id); await refresh(); }
    catch (e) { setMsg((e as Error).message); }
    finally { setMailing(null); }
  }

  async function copy(g: PostGuest) {
    try { await navigator.clipboard.writeText(guestPostLink(g.token)); setCopied(g.id); window.setTimeout(() => setCopied(null), 2000); }
    catch { window.prompt('Copy this link', guestPostLink(g.token)); }
  }

  async function answer(o: PostOrder, accept: boolean) {
    setBusy(true); setMsg(null);
    try {
      await respondPostOrder(o.id, accept);
      setMsg(accept
        ? `Accepted — ${o.buyer_name || 'they'} can pay ${centsLabel(o.price_cents)} by card now (we emailed them).`
        : 'Declined — nothing was charged.');
      await refresh();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const guestName = (id: string | null) => guests.find((g) => g.id === id);
  const openOrders = orders.filter((o) => o.status === 'requested' || o.status === 'accepted' || o.status === 'paid');

  return (
    <section className="gshare">
      <p className="gshare__head">Share privately — people off Lichen</p>
      <p className="gshare__sub">
        Each person gets their own private link — no account needed to see this
        {priced ? ', and they can ask to buy it. You say yes, then they pay by card and the dollars land in your wallet as Current-cy.' : '.'}
      </p>

      <div className="gshare__add">
        <input className="gshare__input" value={line} placeholder="Name and email or phone"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addLine(); } }} />
        <button className="gshare__btn" disabled={busy || !line.trim()} onClick={() => void addLine()}>Share</button>
      </div>
      {lists.length > 0 && (
        <div className="gshare__lists">
          <span className="gshare__lists-lbl">From a guest list:</span>
          {lists.map((gl) => (
            <button key={gl.id} className="gshare__chip" disabled={busy} onClick={() => void addList(gl)}>{gl.name}</button>
          ))}
        </div>
      )}
      {msg && <p className="gshare__msg">{msg}</p>}

      {priced && (
        <div id="orders" className="gshare__orders">
          <p className="gshare__h3">Purchase requests</p>
          {openOrders.length === 0 && <p className="gshare__none">None yet — when someone you shared with asks to buy, it lands here.</p>}
          {openOrders.map((o) => {
            const g = guestName(o.guest_id);
            return (
              <div key={o.id} className={'gshare__order is-' + o.status}>
                <div className="gshare__order-main">
                  <span className="gshare__order-who">{o.buyer_name || g?.name || 'A guest'}</span>
                  <span className="gshare__order-meta">
                    {centsLabel(o.price_cents)} · {o.paid_at ? 'Paid ✓ — arrange the hand-off'
                      : o.payment_pending_at ? 'Bank transfer on its way'
                      : o.status === 'accepted' ? 'You said yes — waiting for their payment'
                      : 'Wants to buy this'}
                  </span>
                  {o.note && <span className="gshare__order-note">“{o.note}”</span>}
                  {(o.paid_at || o.status === 'accepted') && (o.buyer_email || o.buyer_phone) && (
                    <span className="gshare__order-contact">
                      {o.buyer_email && <a className="link-cue" href={`mailto:${o.buyer_email}`}>{o.buyer_email}</a>}
                      {o.buyer_phone && <a className="link-cue" href={`tel:${o.buyer_phone}`}>{o.buyer_phone}</a>}
                    </span>
                  )}
                </div>
                {!o.paid_at && !o.payment_pending_at && (
                  <div className="gshare__order-acts">
                    {o.status === 'requested' && (
                      <button className="gshare__btn" disabled={busy} onClick={() => void answer(o, true)}>Accept</button>
                    )}
                    <button className="gshare__quiet" disabled={busy} onClick={() => void answer(o, false)}>Decline</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {guests.length > 0 && (
        <div className="gshare__guests">
          <p className="gshare__h3">Shared with</p>
          {guests.map((g) => (
            <div key={g.id} className="gshare__guest">
              <span className="gshare__guest-who">
                <strong>{g.name || g.email || g.phone}</strong>
                {g.name && <span className="gshare__guest-c">{g.email || g.phone}</span>}
              </span>
              <span className="gshare__guest-acts">
                {g.email ? (
                  <button className="gshare__quiet" disabled={mailing === g.id} onClick={() => void mail(g)}>
                    {mailing === g.id ? 'Sending…' : g.emailed_at ? 'Email again' : 'Email it'}
                  </button>
                ) : g.phone ? (
                  <a className="gshare__quiet" href={postShareSmsHref(g.phone, sellerName, title, g.token)}>Text ›</a>
                ) : null}
                <button className="gshare__quiet" onClick={() => void copy(g)}>{copied === g.id ? 'Copied ✓' : 'Copy link'}</button>
                <button className="gshare__quiet gshare__quiet--del"
                  onClick={() => {
                    if (delGuest !== g.id) { setDelGuest(g.id); return; }
                    void removePostGuest(g.id).then(() => { setDelGuest(null); void refresh(); });
                  }}>{delGuest === g.id ? 'Really remove?' : 'Remove'}</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
