import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useActing } from '../acting/ActingProvider';
import type { FeedPost } from '../lib/postsApi';
import {
  requestExchange, decideExchange, completeExchange, cancelExchange,
  approveAsGuardian, isClaimed, myExchangeForPost, takeItLabel, nextStep,
  type Exchange,
} from '../lib/exchangeApi';
import './ExchangePanel.css';

const FULFILMENT: { id: string; label: string }[] = [
  { id: 'pickup', label: 'Pick it up' },
  { id: 'deliver', label: 'Delivered' },
  { id: 'ship', label: 'Shipped' },
  { id: 'in_store', label: 'In store' },
];

/** The exchange, on a listing (founder 2026-08-05). Before: the only door
 *  forward was a DM with a URL pasted into the draft. Now: ask for it, the
 *  owner says yes or not now, and it closes when BOTH of you say it's done —
 *  the moment any Current-cy moves.
 *
 *  Everything degrades quietly: before the migration lands, the RPCs error and
 *  the panel simply doesn't render. */
export default function ExchangePanel({ post, me }: { post: FeedPost; me: string }) {
  const [x, setX] = useState<Exchange | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [open, setOpen] = useState(false);
  const [fulfil, setFulfil] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Wearing a space's hat, the SPACE is the party (founder 2026-08-13: "I'm
  // always a participant, even if i'm an org") — it asks, its treasury pays,
  // and any of its admins can carry the exchange forward. `options` is the
  // list of spaces this member admins, which is exactly the adminship test
  // the server will re-run.
  const { actor, options } = useActing();
  const asSpace = actor.type === 'space' ? actor.id : undefined;
  const adminOf = (spaceId: string | null) =>
    !!spaceId && options.some((o) => o.id === spaceId);

  // "Mine" = the side that's selling, so no CTA. As yourself, anything you
  // authored; as a space, that space's own listings (buying your admin's
  // personal listing AS the space is legitimate — the barn buys the saddle).
  const mine = asSpace ? post.author_space_id === asSpace : post.author_id === me;
  const d = (post.details ?? {}) as { mode?: string; fulfillment?: string[] };
  const offered = (d.fulfillment ?? []).length
    ? FULFILMENT.filter((f) => (d.fulfillment ?? []).includes(f.id))
    : FULFILMENT;

  const load = async () => {
    setX(await myExchangeForPost(post.id, me, asSpace));
    setClaimed(await isClaimed(post.id));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [post.id, me, asSpace]);

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    const r = await fn();
    setMsg(r.message);
    if (r.ok) await load();
    setBusy(false);
  };

  // Someone else has it and I'm not part of that — say so and stop.
  if (!x && claimed && !mine) {
    return (
      <div className="xch xch--quiet">
        <p className="xch__quiet">Spoken for. The listing stays up so you can see what it was.</p>
      </div>
    );
  }

  // No exchange yet: the primary action.
  if (!x) {
    if (mine) return null;
    return (
      <div className="xch">
        {!open ? (
          <button className="btn btn-primary xch__cta" onClick={() => setOpen(true)}>
            <Icon name="store" size={15} /> {takeItLabel(d.mode)}
          </button>
        ) : (
          <div className="xch__form">
            {actor.type === 'space' && (
              <p className="xch__asspace">
                Asking as <strong>{actor.name}</strong> — its Current, not yours,
                pays when you both call it done.
              </p>
            )}
            <p className="xch__label">How would it change hands?</p>
            <div className="cmp__chips">
              {offered.map((f) => (
                <button key={f.id}
                  className={'cmp__chip' + (fulfil === f.id ? ' is-on' : '')}
                  onClick={() => setFulfil(f.id)}>{f.label}</button>
              ))}
            </div>
            <textarea className="xch__note" rows={2} value={note}
              placeholder="A line to them — when you're free, what you'd trade…"
              onChange={(e) => setNote(e.target.value)} />
            <div className="xch__row">
              <button className="btn btn-primary" disabled={busy}
                onClick={() => void run(() => requestExchange(post.id, d.mode, fulfil, note, asSpace))}>
                {busy ? 'Asking…' : 'Send it'}
              </button>
              <button className="btn" onClick={() => { setOpen(false); setMsg(''); }}>Not yet</button>
            </div>
          </div>
        )}
        {msg && <p className="xch__msg">{msg}</p>}
      </div>
    );
  }

  // An exchange exists — show what it's waiting on, and the verb that's next.
  // Space parties act through ANY of their admins, not only whoever clicked.
  const iAmSeller = x.seller_id === me || adminOf(x.seller_space_id);
  const iConfirmed = iAmSeller ? !!x.seller_done_at : !!x.buyer_done_at;
  const live = x.status === 'pending' || x.status === 'accepted';

  return (
    <div className={'xch' + (live ? ' xch--live' : '')}>
      <p className="xch__state">
        <span className="xch__dot" aria-hidden />
        {nextStep(x, me)}
        {x.amount > 0 && <em className="xch__amt">{x.amount} Current-cy</em>}
      </p>
      {x.note && <p className="xch__their-note">“{x.note}”</p>}

      {x.needs_guardian && !x.guardian_ok_at && (
        <p className="xch__guard">
          A grown-up holds one of you — this waits on their yes before anything
          changes hands.
        </p>
      )}

      <div className="xch__row">
        {x.status === 'pending' && iAmSeller && (
          <>
            <button className="btn btn-primary" disabled={busy}
              onClick={() => void run(() => decideExchange(x.id, true))}>Yes, it’s theirs</button>
            <button className="btn" disabled={busy}
              onClick={() => void run(() => decideExchange(x.id, false))}>Not this time</button>
          </>
        )}
        {x.status === 'accepted' && !iConfirmed && (
          <button className="btn btn-primary" disabled={busy}
            onClick={() => void run(() => completeExchange(x.id))}>It’s done</button>
        )}
        {x.needs_guardian && !x.guardian_ok_at && (
          <button className="btn" disabled={busy}
            onClick={() => void run(() => approveAsGuardian(x.id))}>
            I’m their guardian — approve
          </button>
        )}
        {live && (
          <button className="btn" disabled={busy}
            onClick={() => void run(() => cancelExchange(x.id))}>Call it off</button>
        )}
      </div>
      {msg && <p className="xch__msg">{msg}</p>}
    </div>
  );
}
