import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAllPayouts, markPayoutPaid, cancelCashout, type PayoutRequest,
} from '../lib/bookingApi';

/** THE PAYOUTS DESK (founder 2026-10-29, the cash-out half of "Let's do
 *  both"): every cash-out request, waiting first. The Current already burned
 *  when the member asked; marking a row paid records that the DOLLARS moved
 *  — v1 Galyn sends them by hand (bank/Venmo/check) and writes how in the
 *  note. "Return to wallet" re-mints instead. The year's paid total per
 *  member is the 1099 signal: $600+ paid to one person in a year is
 *  reportable — the line says so when it's near. */
export default function PayoutsDesk() {
  const [rows, setRows] = useState<PayoutRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => { setRows(await listAllPayouts()); }, []);
  useEffect(() => { void load(); }, [load]);

  const waiting = rows.filter((r) => r.status === 'requested');
  const paid = rows.filter((r) => r.status === 'paid');

  // This year's dollars paid per member — the 1099 ledger at a glance.
  const ytd = useMemo(() => {
    const year = String(new Date().getFullYear());
    const by = new Map<string, { name: string; total: number }>();
    for (const r of paid) {
      if (!(r.resolved_at ?? '').startsWith(year)) continue;
      const cur = by.get(r.profile_id) ?? { name: r.member?.full_name ?? 'A member', total: 0 };
      cur.total += Number(r.amount);
      by.set(r.profile_id, cur);
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }, [paid]);

  if (!rows.length) return null;

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  };
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  return (
    <section className="adminc__gift curc__mint">
      <h2 className="adminc__h2">Payouts — cash-outs to pay</h2>
      <p className="adminc__sub">
        Their Current is already set aside; paying the dollars is your act (bank,
        Venmo, check — note how). $600+ paid to one person in a year is 1099 territory.
      </p>
      {error && <p className="curc__error">{error}</p>}
      {waiting.length === 0 && <p className="curc__empty">Nothing waiting.</p>}
      {waiting.map((r) => (
        <div className="curc__donation" key={r.id} style={{ flexWrap: 'wrap', gap: 8 }}>
          <span>
            <strong>{r.member?.full_name ?? 'A member'}</strong> · ${r.amount}
            {' · '}requested {when(r.requested_at)}{r.source === 'auto' ? ' · automatic' : ''}
          </span>
          <input
            className="curc__input"
            style={{ maxWidth: 180 }}
            placeholder="How it was sent (note)"
            value={notes[r.id] ?? ''}
            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
          />
          <button className="btn btn-primary curc__go" disabled={busy === r.id}
            onClick={() => void act(r.id, () => markPayoutPaid(r.id, (notes[r.id] ?? '').trim()))}>
            Mark paid
          </button>
          <button className="btn curc__keep" disabled={busy === r.id}
            onClick={() => void act(r.id, () => cancelCashout(r.id))}>
            Return to wallet
          </button>
        </div>
      ))}
      {ytd.length > 0 && (
        <p className="curc__empty" style={{ marginTop: 10 }}>
          Paid this year:{' '}
          {ytd.map((p, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : ''}{p.name} ${p.total}{p.total >= 600 ? ' ⚠ 1099' : ''}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
