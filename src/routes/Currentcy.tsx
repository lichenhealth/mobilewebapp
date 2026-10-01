import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import CurrentcyCard from '../components/CurrentcyCard';
import AssistantDoor from '../components/AssistantDoor';
import { operatingRate, startLoadCheckout } from '../lib/ledgerApi';
import './Concierge.css';

/** The wallet's own screen (founder 2026-09-13: "your wallet just lives in
 *  your profile… it should be a left nav on desktop and a bottom nav on
 *  mobile"). Profile's Current-cy drawer stays — several doors, one ledger.
 *  TopBar's arrow is the back button (no in-page second one). The brain is
 *  the MONEY COACH (founder 2026-09-13, same day): a Current-cy assistant
 *  like every section's — and like every section's, one switch turns it off.
 *  "Your Current-cy is like a checking account — you can earn it or you can
 *  load money into it" (founder 2026-10-01): the LOAD door appears once the
 *  money-in migration is live (the operatingRate probe — a payment door
 *  whose fulfillment path isn't live must never render). */
export default function Currentcy() {
  const [params] = useSearchParams();
  const justLoaded = params.get('loaded') === '1';

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
    <div className="cedit">
      <header className="cedit__head cedit__head--noback">
        <h1 className="cedit__title">Current-cy</h1>
      </header>
      <p className="means__pagelead">
        Your wallet — like a checking account: earn Current-cy, or load dollars
        in to use on the platform.
      </p>
      {justLoaded && (
        <p className="curx__loaded">
          Payment received — your Current lands here in a moment. Pull back in
          if it hasn&rsquo;t appeared yet.
        </p>
      )}
      <div className="cedit__doors">
        <AssistantDoor section="currentcy" label="Your money coach — what moved, and where you could earn more" />
      </div>
      {/* Money in (founder 2026-10-01: "donate directly into the platform
          thru their profiles"). With loads live, gifts to members are made
          FROM your balance (the Send box below — it prompts a load when the
          balance is short), so the dollar-gift door retires; until then the
          doors route to the existing consented flows only. */}
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
                className="curc__input curx__loadamt" placeholder="$ amount" inputMode="decimal"
                value={loadAmt} onChange={(e) => setLoadAmt(e.target.value)}
              />
              <button className="btn btn-primary" disabled={loadBusy} onClick={startLoad}>
                {loadBusy ? 'One moment…' : 'Load it →'}
              </button>
              {loadErr && <p className="curc__error">{loadErr}</p>}
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
      <CurrentcyCard />
    </div>
  );
}
