import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { numericAmount } from '../lib/ledgerApi';
import { loadMoneySafeguards, saveMoneySafeguards } from '../lib/moneySafeguardsApi';
import { MONEY_CEILING_NOTE } from '../lib/assistantAllowanceApi';
import { Bolt } from './CurrentcyCard';
import './CashOutCard.css';

/** MONEY SAFEGUARDS (founder 2026-11-08: "maybe there's a pending period for
 *  big purchases. Can there be overdraft controls, too? Claude will alert you
 *  if you're outpacing your monthly budget"). Three rails, one card:
 *  the FLOOR (the ledger itself refuses any spend that would take the wallet
 *  below it — by hand or by Claude), PACING (a daily read of real outflow
 *  against the budget's planned monthly expenses, spoken once by the money
 *  coach), and the standing note on Claude's own money ceilings + 24h hold.
 *  Shares CashOutCard's paper grammar. */
export default function MoneySafeguards() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [floor, setFloor] = useState('');
  const [savedFloor, setSavedFloor] = useState<number | null>(null);
  const [pacing, setPacing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    void loadMoneySafeguards().then((s) => {
      setSavedFloor(s.floor); setFloor(s.floor != null ? String(s.floor) : ''); setPacing(s.pacing);
    });
  }, [me]);
  if (!me) return null;

  const typed = floor.trim() === '' ? null : Number(floor);
  const floorDirty = (typed || null) !== (savedFloor || null);

  const save = async (nextFloor: number | null, nextPacing: boolean, msg: string) => {
    setBusy(true); setError(''); setNote('');
    try {
      const s = await saveMoneySafeguards(nextFloor, nextPacing);
      setSavedFloor(s.floor); setFloor(s.floor != null ? String(s.floor) : ''); setPacing(s.pacing);
      setNote(msg);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="cashout" id="safeguards">
      <h2 className="cashout__h2">Money safeguards</h2>
      <p className="cashout__sub">
        A floor your wallet never goes below — every send, trade and purchase
        honors it, whether you make it or Claude proposes it.
      </p>

      <label className="cashout__prefrow" htmlFor="floor-amt"><span>Never take me below</span></label>
      <div className="cashout__ask">
        <span className="cashout__dollar"><Bolt small /></span>
        <input
          id="floor-amt"
          className="cashout__amount"
          inputMode="decimal"
          placeholder="No floor"
          value={floor}
          onChange={(e) => setFloor(numericAmount(e.target.value))}
        />
        <button
          className="cashout__btn"
          disabled={busy || !floorDirty}
          onClick={() => void save(typed && typed > 0 ? typed : null, pacing,
            typed && typed > 0 ? `Floor set ✓ — nothing will take you below ⚡${typed}.` : 'Floor cleared ✓')}
        >
          {busy ? 'One moment…' : !(typed && typed > 0) && savedFloor != null ? 'Clear floor ›' : 'Set floor ›'}
        </button>
      </div>
      {savedFloor != null && !floorDirty && (
        <p className="cashout__bal">Your floor: <Bolt small />{savedFloor}. A send that would cross it is refused, in plain words.</p>
      )}

      <label className="msafe__check">
        <input
          type="checkbox"
          checked={pacing}
          disabled={busy}
          onChange={(e) => void save(savedFloor, e.target.checked,
            e.target.checked ? 'Pacing on ✓' : 'Pacing off ✓')}
        />
        <span>
          Tell me when the month is running ahead of my budget — Claude compares
          what's gone out against the planned monthly expenses below, and says
          so once, never more than that in a month.
        </span>
      </label>

      {note && <p className="cashout__note">{note}</p>}
      {error && <p className="cashout__error">{error}</p>}
      <p className="cashout__fine">
        When Claude sends Current for you: {MONEY_CEILING_NOTE} Anything over
        ⚡500 waits 24 hours after you confirm, and you can cancel it.
      </p>
    </section>
  );
}
