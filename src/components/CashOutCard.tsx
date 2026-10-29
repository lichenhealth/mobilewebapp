import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { myBalance, numericAmount } from '../lib/ledgerApi';
import {
  listMyPayouts, requestCashout, cancelCashout, loadPayoutPref, savePayoutPref,
  type PayoutRequest,
} from '../lib/bookingApi';
import { Bolt } from './CurrentcyCard';
import './CashOutCard.css';

/** CASH OUT — the dollars half of "you can choose to have it be cash out,
 *  current-cy or either" (founder 2026-10-29). Any Current you hold —
 *  session payments, marketplace exchanges, gifts — can turn back into
 *  dollars: the Current burns now (the ledger's cashout context) and the
 *  payout is paid by hand from the admin desk, v1 (Stripe Connect automation
 *  stays the later phase, as the ledger doctrine always said). The
 *  preference below answers it per SESSION PAYMENT automatically; this door
 *  is the "either" — always here, whatever you chose.
 *  ⚠ Copy stays TAX-NEUTRAL by standing honesty rules: no "not taxable"
 *  promises — cash-outs are tracked for tax reporting; the rest is between
 *  a member and their tax person. */
export default function CashOutCard() {
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [balance, setBalance] = useState<number | null>(null);
  const [pref, setPref] = useState<'keep' | 'auto_cashout'>('keep');
  const [rows, setRows] = useState<PayoutRequest[]>([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!me) return;
    const [bal, p, list] = await Promise.all([myBalance(me), loadPayoutPref(me), listMyPayouts(me)]);
    setBalance(bal); setPref(p); setRows(list);
  }, [me]);
  useEffect(() => { void load(); }, [load]);

  if (!me) return null;

  const amt = Number(amount || '0');
  const open = rows.filter((r) => r.status === 'requested');
  const settled = rows.filter((r) => r.status !== 'requested').slice(0, 5);
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <section className="cashout">
      <h2 className="cashout__h2">Current-cy or dollars — your call</h2>
      <p className="cashout__sub">
        What you earn — sessions, Marketplace, gifts — lands in this wallet as
        Current-cy and keeps circulating in the Lichen economy. Any of it can
        become dollars: <Bolt small />1 = $1, paid out by hand from Lichen
        (usually within a few days) and tracked for tax reporting.
      </p>

      <label className="cashout__prefrow">
        <span>Session payments arrive as</span>
        <select
          className="cashout__select"
          value={pref}
          onChange={(e) => {
            const v = e.target.value as 'keep' | 'auto_cashout';
            setPref(v);
            void savePayoutPref(me, v).catch(() => void load());
          }}
        >
          <option value="keep">Current-cy — cash out whenever you like</option>
          <option value="auto_cashout">Dollars — cash out automatically, every time</option>
        </select>
      </label>

      {error && <p className="cashout__error">{error}</p>}

      <div className="cashout__ask">
        <span className="cashout__dollar"><Bolt small /></span>
        <input
          className="cashout__amount"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(numericAmount(e.target.value))}
          aria-label="Current to cash out"
        />
        <button
          className="cashout__btn"
          disabled={busy || !(amt > 0) || (balance != null && amt > balance)}
          onClick={async () => {
            setBusy(true); setError(''); setNote('');
            try {
              await requestCashout(amt);
              setAmount('');
              setNote('Cash-out requested ✓ — the dollars are sent by hand, usually within a few days.');
              await load();
            } catch (e) {
              setError((e as { message?: string } | null)?.message || 'Something went wrong.');
            } finally { setBusy(false); }
          }}
        >
          {busy ? 'One moment…' : 'Cash out ›'}
        </button>
      </div>
      {balance != null && <p className="cashout__bal">You hold <Bolt small />{balance}.</p>}
      {note && <p className="cashout__note">{note}</p>}

      {open.length > 0 && (
        <ul className="cashout__list">
          {open.map((r) => (
            <li className="cashout__row" key={r.id}>
              <span>${r.amount} · requested {when(r.requested_at)}{r.source === 'auto' ? ' · automatic' : ''}</span>
              <button
                className="cashout__quiet"
                onClick={() => { void cancelCashout(r.id).then(load).catch((e) => setError((e as Error).message)); }}
              >
                Return to wallet
              </button>
            </li>
          ))}
        </ul>
      )}
      {settled.length > 0 && (
        <ul className="cashout__list cashout__list--settled">
          {settled.map((r) => (
            <li className="cashout__row" key={r.id}>
              <span>
                ${r.amount} · {r.status === 'paid'
                  ? `paid ${r.resolved_at ? when(r.resolved_at) : ''}${r.note ? ` · ${r.note}` : ''}`
                  : 'returned to your wallet'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="cashout__fine">
        For what any of this means at tax time, ask your tax person — Lichen
        reports what the law asks of it on dollars it pays out.
      </p>
    </section>
  );
}
