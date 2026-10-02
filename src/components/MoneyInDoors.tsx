import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { operatingRate, startLoadCheckout } from '../lib/ledgerApi';
import './MoneyInDoors.css';

/** The wallet's money-in doors (founder 2026-10-01: "donate directly into
 *  the platform thru their profiles") — ONE component so the /currentcy
 *  wallet page and Profile's Current-cy drawer can never drift (founder
 *  2026-10-02, after refreshing Profile and not finding the new doors).
 *  With loads LIVE (the operatingRate probe): Load Current-cy (inline $
 *  amount → load-checkout → Stripe; $1 = 1 Current, not deductible) +
 *  Donate; gifts to members are made FROM the balance via the card's Send
 *  box. Pre-migration the probe reads null → Load hidden, the dollar-gift
 *  door stands in — a payment door whose fulfillment path isn't live must
 *  never render. */
export default function MoneyInDoors() {
  const [loadsLive, setLoadsLive] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadAmt, setLoadAmt] = useState('');
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => { void operatingRate().then((r) => setLoadsLive(r !== null)); }, []);

  const startLoad = async () => {
    const n = Number(loadAmt);
    if (!Number.isFinite(n) || n < 1 || n > 2000) {
      setLoadErr('Enter an amount between $1 and $2,000.');
      return;
    }
    setLoadBusy(true); setLoadErr('');
    try {
      await startLoadCheckout(Math.round(n * 100) / 100);
    } catch (e) {
      setLoadErr((e as { message?: string } | null)?.message || 'Could not start checkout.');
      setLoadBusy(false);
    }
  };

  return (
    <section className="curx">
      <h2 className="curx__h2">Put dollars in</h2>
      <div className="curx__doors">
        {loadsLive && (
          <button className="curx__door curx__door--btn" onClick={() => { setLoadOpen((o) => !o); setLoadErr(''); }}>
            Load Current-cy — dollars into your wallet ›
          </button>
        )}
        {loadsLive && loadOpen && (
          <div className="curx__loadrow">
            <input
              className="curx__loadamt" placeholder="$ amount" inputMode="decimal"
              value={loadAmt} onChange={(e) => setLoadAmt(e.target.value)}
            />
            <button className="btn btn-primary" disabled={loadBusy} onClick={startLoad}>
              {loadBusy ? 'One moment…' : 'Load it →'}
            </button>
            {loadErr && <p className="curx__loaderr">{loadErr}</p>}
            <p className="curx__loadfine">
              $1 becomes 1 Current, usable across the platform. A load is a
              purchase of spending power, not a donation — it isn&rsquo;t
              tax-deductible.
            </p>
          </div>
        )}
        <Link className="curx__door" to="/donate">
          Donate — generally, or aimed at care &amp; community subsidies ›
        </Link>
        {!loadsLive && (
          <Link className="curx__door" to="/donate?flow=gift">
            Send a dollar gift to someone ›
          </Link>
        )}
      </div>
    </section>
  );
}
