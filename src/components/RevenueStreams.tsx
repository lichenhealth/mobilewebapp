import { useEffect, useMemo, useState } from 'react';
import { numericAmount } from '../lib/ledgerApi';
import {
  STREAM_KINDS, coveredBy, deleteStream, gapOf, listMyStreams, saveStream, usd,
  type Stream, type StreamKind,
} from '../lib/streamsApi';

/** "Your services & who pays" (founder 2026-11-12): per service, the rate
 *  that makes the work feasible, then each payer and what it covers. The
 *  gap is what a client pays over their coverage — or, when they can't, what
 *  a subsidy request asks the well for. Lives on /practice; styled by
 *  Practice.css. */
type Form = { id?: string; service: string; rate: string; label: string; kind: StreamKind; mode: 'amount' | 'pct'; pays: string; note: string };
const blank = (service = '', rate = ''): Form => ({ service, rate, label: '', kind: 'public', mode: 'amount', pays: '', note: '' });
const toCents = (s: string) => { const n = parseFloat(s); return isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

export default function RevenueStreams({ me }: { me: string }) {
  const [rows, setRows] = useState<Stream[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => { if (me) void listMyStreams(me).then(setRows); }, [me]);

  const services = useMemo(() => {
    const m = new Map<string, Stream[]>();
    for (const r of rows) m.set(r.service, [...(m.get(r.service) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  const needsPays = (k: StreamKind) => k !== 'cash' && k !== 'sliding';

  const save = async () => {
    if (!form) return;
    setErr('');
    const rate = toCents(form.rate);
    if (!form.service.trim()) return setErr('Name the service (e.g. “Therapy session, 60 min”).');
    if (!rate) return setErr('Add the rate that makes this work feasible for you.');
    if (!form.label.trim()) return setErr('Name the payer (e.g. “Medi-Cal”, “Aetna out of network”, “Cash”).');
    const pct = form.mode === 'pct' ? Math.min(100, Math.max(0, Math.round(parseFloat(form.pays) || 0))) : 0;
    const cents = form.mode === 'amount' ? toCents(form.pays) : 0;
    if (needsPays(form.kind) && !pct && !cents) return setErr('Say what this payer covers — an amount or a percentage.');
    setBusy(true);
    try {
      const saved = await saveStream(me, {
        id: form.id, service: form.service, rate_cents: rate, label: form.label, kind: form.kind,
        pays_cents: needsPays(form.kind) ? (cents || null) : null,
        pays_pct: needsPays(form.kind) ? (pct || null) : null,
        note: form.note || null,
      });
      // A changed rate applies to the whole service — keep its siblings in step.
      const siblings = rows.filter((r) => r.service === saved.service && r.id !== saved.id && r.rate_cents !== saved.rate_cents);
      const synced = await Promise.all(siblings.map((r) => saveStream(me, { ...r, rate_cents: saved.rate_cents })));
      setRows((rs) => {
        const map = new Map(rs.map((r) => [r.id, r]));
        map.set(saved.id, saved);
        for (const s of synced) map.set(s.id, s);
        return [...map.values()];
      });
      setForm(null);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const edit = (r: Stream) => setForm({
    id: r.id, service: r.service, rate: String(r.rate_cents / 100), label: r.label, kind: r.kind,
    mode: r.pays_pct ? 'pct' : 'amount', pays: r.pays_pct ? String(r.pays_pct) : r.pays_cents ? String(r.pays_cents / 100) : '',
    note: r.note ?? '',
  });

  const remove = async (id: string) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    try { await deleteStream(id); setRows((rs) => rs.filter((r) => r.id !== id)); } catch (e) { setErr((e as Error).message); }
    setConfirmDel(null);
  };

  const formEl = form && (
    <div className="prac__client prac__stream-form">
      <div className="prac__grid2">
        <input className="prac__input" placeholder="Service (Therapy session, 60 min)" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} />
        <span className="prac__amt">$<input className="prac__input" inputMode="decimal" placeholder="Rate that works for you" value={form.rate} onChange={(e) => setForm({ ...form, rate: numericAmount(e.target.value) })} /></span>
      </div>
      <div className="prac__grid2">
        <input className="prac__input" placeholder="Payer (Medi-Cal, Aetna, Cash…)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <select className="prac__input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as StreamKind })}>
          {STREAM_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </div>
      {needsPays(form.kind) && (
        <div className="prac__row">
          <span className="prac__lbl">It covers</span>
          <select className="prac__input prac__input--sm" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as Form['mode'], pays: '' })}>
            <option value="amount">a dollar amount</option>
            <option value="pct">a percentage</option>
          </select>
          <span className="prac__amt">{form.mode === 'amount' ? '$' : ''}<input className="prac__input prac__input--sm" inputMode="decimal"
            placeholder={form.mode === 'amount' ? '80' : '70'} value={form.pays}
            onChange={(e) => setForm({ ...form, pays: numericAmount(e.target.value) })} />{form.mode === 'pct' ? '%' : ''}</span>
        </div>
      )}
      <input className="prac__input" placeholder="Note (optional — e.g. after the deductible)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      {err && <p className="prac__hint prac__err">{err}</p>}
      <div className="prac__row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setForm(null); setErr(''); }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="prac__sb">
      <p className="prac__hint">For each service, the rate that makes the work feasible for you, then each payer and what it covers. The gap is what a client pays over their coverage — or, if they can’t, what you or they can ask the subsidy fund for from their care plan.</p>
      {services.map(([service, list]) => (
        <div key={service} className="prac__client">
          <div className="prac__stream-head"><strong>{service}</strong><span className="prac__hint">{usd(list[0].rate_cents)} rate</span></div>
          {list.map((r) => (
            <div key={r.id} className="prac__stream">
              <div className="prac__stream-main">
                <span>{r.label}</span>
                <span className="prac__hint">
                  {r.kind === 'cash' ? 'client pays in full' : r.kind === 'sliding' ? 'sliding scale — client pays what they can' :
                    `covers ${r.pays_pct ? `${r.pays_pct}% (${usd(coveredBy(r))})` : usd(coveredBy(r))} · gap ${usd(gapOf(r))}`}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </div>
              <div className="prac__row">
                <button className="prac__link" onClick={() => edit(r)}>Edit</button>
                <button className="prac__link" onClick={() => void remove(r.id)}>{confirmDel === r.id ? 'Delete?' : 'Delete'}</button>
              </div>
            </div>
          ))}
          {!form && <button className="prac__link" onClick={() => setForm(blank(service, String(list[0].rate_cents / 100)))}>+ Another payer for this service</button>}
        </div>
      ))}
      {!rows.length && !form && <p className="prac__hint">Nothing yet.</p>}
      {formEl}
      {!form && <button className="btn btn-ghost" onClick={() => setForm(blank())}>+ Add a service or payer</button>}
    </div>
  );
}
