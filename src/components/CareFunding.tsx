import { useEffect, useState } from 'react';
import { CarePostRow, CarePayPart, setCareFunding, reviewCareSubsidy } from '../lib/conciergeApi';
import { numericAmount } from '../lib/ledgerApi';
import { coveredBy, gapOf, listMyStreams, usd, type Stream } from '../lib/streamsApi';
import './CareFunding.css';

/** HOW THIS PART OF THE PLAN IS PAID (founder 2026-11-12): three parts —
 *  covered elsewhere · subsidy needed · client pays — each with an optional
 *  amount, so a split reads "$80 covered elsewhere · $40 subsidy needed".
 *  Never HOW it's covered. The client, or the provider whose work it is,
 *  submits; whoever didn't submit confirms or questions a subsidy ask. */

const PARTS: { key: CarePayPart; label: string; short: string }[] = [
  { key: 'covered', label: 'Covered elsewhere', short: 'covered elsewhere' },
  { key: 'subsidy', label: 'Subsidy needed', short: 'subsidy needed' },
  { key: 'self', label: 'Client pays', short: 'client pays' },
];
const centsOf = (p: CarePostRow, k: CarePayPart) =>
  k === 'covered' ? p.pay_covered_cents : k === 'subsidy' ? p.pay_subsidy_cents : p.pay_self_cents;
const dollars = (c: number | null | undefined) =>
  c ? `$${(c / 100).toFixed(2).replace(/\.00$/, '')}` : '';
const toCents = (s: string) => { const n = parseFloat(s); return isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

export default function CareFunding({ post, me }: { post: CarePostRow; me?: string }) {
  const provider = post.author_id !== post.patient_id ? post.author_id : null;
  const isClient = !!me && me === post.patient_id;
  const isProvider = !!me && me === provider;
  const canEdit = isClient || isProvider;

  const [row, setRow] = useState(post);
  useEffect(() => setRow(post), [post]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<CarePayPart>>(new Set());
  const [amt, setAmt] = useState<Record<CarePayPart, string>>({ covered: '', subsidy: '', self: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // The provider's own revenue streams pre-shape an ask (founder 2026-11-12).
  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamGap, setStreamGap] = useState<number | null>(null);
  useEffect(() => { if (open && isProvider && me && !streams.length) void listMyStreams(me).then(setStreams); }, [open, isProvider, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyStream = (id: string) => {
    const st = streams.find((x) => x.id === id);
    if (!st) return;
    const cov = coveredBy(st), gap = gapOf(st);
    const n = new Set<CarePayPart>();
    const a = { covered: '', subsidy: '', self: '' } as Record<CarePayPart, string>;
    if (cov) { n.add('covered'); a.covered = String(cov / 100); }
    if (gap) { n.add('subsidy'); a.subsidy = String(gap / 100); }
    setSel(n); setAmt(a); setStreamGap(gap || null);
  };
  /** Move the stream's gap between "subsidy needed" and "client pays". */
  const gapTo = (part: 'subsidy' | 'self') => {
    if (streamGap == null) return;
    const other = part === 'subsidy' ? 'self' : 'subsidy';
    const n = new Set(sel); n.delete(other); n.add(part); setSel(n);
    setAmt({ ...amt, [other]: '', [part]: String(streamGap / 100) });
  };

  const cur = row.pay_parts ?? [];
  const providerName = (post.author?.full_name || '').split(' ')[0] || 'the provider';
  const who = (id?: string | null) => (id === row.patient_id ? (isClient ? 'you' : 'the client') : (isProvider ? 'you' : providerName));

  const startEdit = () => {
    setSel(new Set(cur));
    const a = { covered: '', subsidy: '', self: '' } as Record<CarePayPart, string>;
    for (const p of PARTS) { const c = centsOf(row, p.key); if (c) a[p.key] = (c / 100).toString(); }
    setAmt(a); setErr(''); setOpen(true);
  };

  const save = async () => {
    setBusy(true); setErr('');
    const ps = PARTS.map((p) => p.key).filter((k) => sel.has(k));
    try {
      await setCareFunding(row.id, ps, {
        covered: toCents(amt.covered), subsidy: toCents(amt.subsidy), self: toCents(amt.self),
      });
      setRow({
        ...row, pay_parts: ps.length ? ps : null,
        pay_covered_cents: ps.includes('covered') ? (toCents(amt.covered) ?? 0) : null,
        pay_subsidy_cents: ps.includes('subsidy') ? (toCents(amt.subsidy) ?? 0) : null,
        pay_self_cents: ps.includes('self') ? (toCents(amt.self) ?? 0) : null,
        subsidy_review: ps.includes('subsidy') ? 'pending' : null,
        pay_set_by: ps.length ? me ?? null : null,
      });
      setOpen(false);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const review = async (ok: boolean) => {
    setBusy(true); setErr('');
    try { await reviewCareSubsidy(row.id, ok); setRow({ ...row, subsidy_review: ok ? 'confirmed' : 'questioned' }); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!canEdit && cur.length === 0) return null;

  if (open) {
    return (
      <div className="cfund cfund--edit">
        <p className="cfund__q">How is this paid? <span>Pick any that apply — amounts are optional.</span></p>
        {isProvider && streams.length > 0 && (
          <div className="cfund__row">
            <select className="cfund__select" defaultValue="" onChange={(e) => applyStream(e.target.value)} aria-label="Fill from one of your revenue streams">
              <option value="" disabled>Fill from your revenue streams…</option>
              {streams.map((st) => (
                <option key={st.id} value={st.id}>{st.service} · {st.label} ({usd(coveredBy(st))} covered, {usd(gapOf(st))} gap)</option>
              ))}
            </select>
            {streamGap != null && (
              <span className="cfund__gap">
                The {usd(streamGap)} gap:
                <button className={'cfund__chip' + (sel.has('subsidy') ? ' is-on' : '')} onClick={() => gapTo('subsidy')}>ask the well</button>
                <button className={'cfund__chip' + (sel.has('self') ? ' is-on' : '')} onClick={() => gapTo('self')}>client pays it</button>
              </span>
            )}
          </div>
        )}
        {isProvider && !streams.length && (
          <p className="cfund__fine">Tip: list your rates and what each payer covers under <a className="link-cue" href="/practice#streams">Practice → Your services &amp; who pays</a>, and this box fills itself.</p>
        )}
        {PARTS.map((p) => (
          <div key={p.key} className="cfund__row">
            <label className="cfund__check">
              <input type="checkbox" checked={sel.has(p.key)} onChange={(e) => {
                const n = new Set(sel); if (e.target.checked) n.add(p.key); else n.delete(p.key); setSel(n);
              }} />
              {p.label}
            </label>
            {sel.has(p.key) && (
              <span className="cfund__amt">$<input inputMode="decimal" placeholder="amount" value={amt[p.key]}
                onChange={(e) => setAmt({ ...amt, [p.key]: numericAmount(e.target.value) })} /></span>
            )}
          </div>
        ))}
        <p className="cfund__fine">Lichen never asks how something is covered — only that it is.
          {sel.has('subsidy') && (isClient
            ? (provider ? ` ${providerName} will be asked to confirm the subsidy request.` : ' A coordinator reviews subsidy requests.')
            : ' Your client will be asked to confirm it.')}
        </p>
        {err && <p className="cfund__err">{err}</p>}
        <div className="cfund__actions">
          <button className="cfund__btn cfund__btn--go" onClick={save} disabled={busy}>Save</button>
          <button className="cfund__btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    );
  }

  if (cur.length === 0) {
    return (
      <div className="cfund">
        <button className="cfund__set" onClick={startEdit}>How is this paid? ›</button>
      </div>
    );
  }

  const reviewer = row.pay_set_by === row.patient_id ? provider : row.patient_id;
  const iReview = !!me && me === reviewer && row.subsidy_review === 'pending';
  const reviewLine = !cur.includes('subsidy') ? '' :
    row.subsidy_review === 'confirmed' ? 'Subsidy request confirmed ✓'
    : row.subsidy_review === 'questioned' ? 'A coordinator will talk this through'
    : reviewer ? `Waiting on ${who(reviewer)} to confirm`
    : 'Waiting on a coordinator';

  return (
    <div className="cfund">
      <p className="cfund__line">
        {PARTS.filter((p) => cur.includes(p.key)).map((p, i) => (
          <span key={p.key} className={'cfund__part cfund__part--' + p.key}>
            {i > 0 && ' · '}{dollars(centsOf(row, p.key))}{dollars(centsOf(row, p.key)) ? ' ' : ''}{p.short}
          </span>
        ))}
        {canEdit && <button className="cfund__edit" onClick={startEdit}>Change</button>}
      </p>
      {reviewLine && <p className="cfund__review">{reviewLine}</p>}
      {iReview && (
        <div className="cfund__actions">
          <button className="cfund__btn cfund__btn--go" onClick={() => review(true)} disabled={busy}>Confirm</button>
          <button className="cfund__btn" onClick={() => review(false)} disabled={busy}>Question it</button>
        </div>
      )}
      {err && <p className="cfund__err">{err}</p>}
    </div>
  );
}
