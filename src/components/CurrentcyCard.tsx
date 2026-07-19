import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { formatDateShort } from '../lib/conciergeApi';
import {
  LedgerEntry, myBalance, myStatement, sendCurrentcy, fmtCurrent,
} from '../lib/ledgerApi';
import './CurrentcyCard.css';

interface MemberLite { id: string; full_name: string | null }

/** The member's Current-cy wallet (Profile section): balance, statement,
 *  and a small send flow. Hidden entirely until the ledger migration runs. */
export default function CurrentcyCard() {
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [who, setWho] = useState('');
  const [pick, setPick] = useState<MemberLite | null>(null);
  const [hits, setHits] = useState<MemberLite[]>([]);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [b, s] = await Promise.all([myBalance(me), myStatement(me, 12)]);
    setBalance(b);
    setEntries(s);
  };
  useEffect(() => { if (me) void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [me]);

  useEffect(() => {
    const n = who.trim();
    if (n.length < 2 || pick) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${n}%`).neq('id', me).limit(5);
      setHits((data as MemberLite[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [who, pick, me]);

  // Ledger not live (or empty account with nothing to show and no sends yet)
  if (balance === null) return null;

  const send = async () => {
    const amt = Number(amount);
    if (!pick) { setError('Choose who to send to.'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter an amount.'); return; }
    setBusy(true); setError('');
    try {
      await sendCurrentcy('profile', me, 'profile', pick.id, amt, memo.trim());
      setSendOpen(false); setWho(''); setPick(null); setAmount(''); setMemo('');
      await load();
    } catch (e) {
      setError((e as { message?: string } | null)?.message || 'Could not send.');
    }
    setBusy(false);
  };

  return (
    <section className="prof__section">
      <h2 className="prof__h2">Current-cy</h2>
      <div className="curc">
        <div className="curc__balrow">
          <span className="curc__bal">{fmtCurrent(balance)}</span>
          <button className="btn curc__sendbtn" onClick={() => { setSendOpen((s) => !s); setError(''); }}>
            {sendOpen ? 'Close' : 'Send'}
          </button>
        </div>

        {sendOpen && (
          <div className="curc__send">
            {pick ? (
              <button className="curc__pick" onClick={() => { setPick(null); setWho(''); }}>
                {pick.full_name ?? 'Member'} ×
              </button>
            ) : (
              <>
                <input
                  className="curc__input" placeholder="To whom?"
                  value={who} onChange={(e) => setWho(e.target.value)}
                />
                {hits.map((h) => (
                  <button className="curc__hit" key={h.id} onClick={() => { setPick(h); setHits([]); }}>
                    {h.full_name ?? 'Member'}
                  </button>
                ))}
              </>
            )}
            <div className="curc__row">
              <input
                className="curc__input curc__amount" placeholder="Amount"
                inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              />
              <input
                className="curc__input" placeholder="For… (optional)"
                value={memo} onChange={(e) => setMemo(e.target.value)}
              />
            </div>
            {error && <p className="curc__error">{error}</p>}
            <button className="btn btn-primary curc__go" disabled={busy} onClick={send}>
              {busy ? 'Sending…' : 'Send Current'}
            </button>
          </div>
        )}

        {entries.length > 0 && (
          <div className="curc__list">
            {entries.map((e) => {
              const incoming = e.to_type === 'profile' && e.to_id === me;
              return (
                <div className="curc__entry" key={e.id}>
                  <span className={'curc__amt' + (incoming ? ' is-in' : '')}>
                    {incoming ? '+' : '−'}{Number.isInteger(e.amount) ? e.amount : e.amount.toFixed(2)}
                  </span>
                  <span className="curc__desc">
                    {incoming ? `from ${e.from_name}` : `to ${e.to_name}`}
                    {e.memo && <em> · {e.memo}</em>}
                  </span>
                  <span className="curc__when">{formatDateShort(e.created_at.slice(0, 10))}</span>
                </div>
              );
            })}
          </div>
        )}
        {entries.length === 0 && (
          <p className="curc__empty">
            Every contribution tracked and returned — your statement starts with
            its first entry.
          </p>
        )}
      </div>
    </section>
  );
}
