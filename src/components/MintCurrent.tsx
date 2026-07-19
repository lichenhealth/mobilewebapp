import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { mintCurrentcy } from '../lib/ledgerApi';
import './CurrentcyCard.css';

interface MemberLite { id: string; full_name: string | null }

/** Admin block (Memberships & gifts page): bring Current into being.
 *  Hidden gracefully until the ledger migration runs (mint errors show). */
export default function MintCurrent() {
  const [who, setWho] = useState('');
  const [pick, setPick] = useState<MemberLite | null>(null);
  const [hits, setHits] = useState<MemberLite[]>([]);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [ctx, setCtx] = useState('grant');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const n = who.trim();
    if (n.length < 2 || pick) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${n}%`).limit(5);
      setHits((data as MemberLite[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [who, pick]);

  const mint = async () => {
    const amt = Number(amount);
    if (!pick || !Number.isFinite(amt) || amt <= 0) { setNote('Pick a member and an amount.'); return; }
    setBusy(true); setNote('');
    try {
      await mintCurrentcy('profile', pick.id, amt, memo.trim(), ctx);
      setNote(`Granted ${amt} Current to ${pick.full_name ?? 'member'}.`);
      setPick(null); setWho(''); setAmount(''); setMemo('');
    } catch (e) {
      setNote((e as { message?: string } | null)?.message || 'Could not mint.');
    }
    setBusy(false);
  };

  return (
    <div className="adminc__gift curc__mint">
      <h2 className="adminc__h2">Mint Current-cy</h2>
      <p className="adminc__sub">
        Bring Current into being — grants for contributions the old economy
        can&rsquo;t see. Every mint is a permanent ledger entry.
      </p>
      <div className="curc__send">
        {pick ? (
          <button className="curc__pick" onClick={() => { setPick(null); setWho(''); }}>
            {pick.full_name ?? 'Member'} ×
          </button>
        ) : (
          <>
            <input
              className="curc__input" placeholder="Member name…"
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
          <select className="curc__input" value={ctx} onChange={(e) => setCtx(e.target.value)} style={{ flex: '0 0 110px' }}>
            <option value="grant">grant</option>
            <option value="gift">gift</option>
            <option value="adjustment">adjustment</option>
          </select>
          <input
            className="curc__input" placeholder="For… (memo)"
            value={memo} onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        {note && <p className="curc__error">{note}</p>}
        <button className="btn btn-primary curc__go" disabled={busy} onClick={mint}>
          {busy ? 'Minting…' : 'Mint'}
        </button>
      </div>
    </div>
  );
}
