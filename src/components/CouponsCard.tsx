import { useEffect, useRef, useState } from 'react';
import {
  listCoupons, saveCoupon, deleteCoupon, scanCouponPhoto, signCouponPhotos, discardCouponPhoto,
  type Coupon, type CouponDraft, type ScannedCoupon,
} from '../lib/couponsApi';
import { numericAmount } from '../lib/ledgerApi';
import './BudgetCard.css';
import './SubscriptionsCard.css';
import './CouponsCard.css';

/** COUPONS (founder 2026-11-25: "take pics of things and organize them for
 *  me to coupons! And then when they expire, delete them… so we don't have to
 *  keep paper"). Snap a photo → Lichen reads it → you check it → saved. A bell
 *  three days before a coupon expires; once it has, it's gone. */
const dayOf = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const daysUntil = (iso: string) => Math.round((new Date(iso + 'T12:00:00').getTime() - Date.now()) / 864e5);
const WHERE: Record<string, string> = { online: 'online', in_store: 'in store', both: 'online or in store' };

type Form = { id?: string; merchant: string; offer: string; code: string; min: string; expires_on: string; url: string; where_valid: string; category: string; terms: string; photo_path: string | null };
const blank: Form = { merchant: '', offer: '', code: '', min: '', expires_on: '', url: '', where_valid: '', category: '', terms: '', photo_path: null };
const fromScan = (s: ScannedCoupon, photo: string | null): Form => ({
  merchant: s.merchant, offer: s.offer, code: s.code ?? '', min: s.min_spend ? String(s.min_spend) : '',
  expires_on: s.expires_on ?? '', url: s.url ?? '', where_valid: s.where_valid ?? '', category: s.category ?? '', terms: s.terms ?? '', photo_path: photo,
});
const fromRow = (c: Coupon): Form => ({
  id: c.id, merchant: c.merchant, offer: c.offer, code: c.code ?? '', min: c.min_spend_cents ? String(c.min_spend_cents / 100) : '',
  expires_on: c.expires_on ?? '', url: c.url ?? '', where_valid: c.where_valid ?? '', category: c.category ?? '', terms: c.terms ?? '', photo_path: c.photo_path,
});

export default function CouponsCard() {
  const [rows, setRows] = useState<Coupon[] | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [forms, setForms] = useState<Form[]>([]);      // new coupons waiting for a check
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [arm, setArm] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const load = async () => {
    const list = await listCoupons();
    setRows(list);
    setPhotos(await signCouponPhotos(list.map((c) => c.photo_path ?? '')));
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (rows && window.location.hash === '#coupons') document.getElementById('coupons')?.scrollIntoView({ block: 'start' });
  }, [rows]);

  if (rows === null) return null;

  async function snap(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await scanCouponPhoto(file);
      if (r.coupons.length) setForms(r.coupons.map((c, i) => fromScan(c, i === 0 ? r.photoPath : null)));
      else { setForms([{ ...blank, photo_path: r.photoPath }]); }
      setNote(r.note || (r.coupons.length ? '' : 'I didn’t find a coupon in that photo — fill it in below.'));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); if (pick.current) pick.current.value = ''; }
  }

  const toDraft = (f: Form): CouponDraft => ({
    id: f.id, merchant: f.merchant, offer: f.offer, code: f.code || null,
    min_spend_cents: f.min ? Math.round(Number(f.min) * 100) : null, expires_on: f.expires_on || null,
    terms: f.terms || null, url: f.url || null, where_valid: (f.where_valid || null) as Coupon['where_valid'],
    category: f.category || null, photo_path: f.photo_path,
  });
  async function saveNew(i: number) {
    setErr('');
    try { await saveCoupon(toDraft(forms[i])); setForms(forms.filter((_, j) => j !== i)); setNote(''); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function dropNew(i: number) {
    const f = forms[i];
    if (f.photo_path && !forms.some((g, j) => j !== i && g.photo_path === f.photo_path)) await discardCouponPhoto(f.photo_path);
    setForms(forms.filter((_, j) => j !== i)); setNote('');
  }
  async function saveEdit() {
    if (!editing) return;
    setErr('');
    try { await saveCoupon(toDraft(editing)); setEditing(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function remove(c: Coupon) {
    if (arm !== c.id) { setArm(c.id); return; }
    await deleteCoupon(c); setArm(null); await load();
  }
  function copy(c: Coupon) {
    if (!c.code) return;
    void navigator.clipboard?.writeText(c.code).then(() => { setCopied(c.id); setTimeout(() => setCopied(null), 2500); })
      .catch(() => window.prompt('Copy the code:', c.code ?? ''));
  }

  const formView = (f: Form, set: (f: Form) => void, onSave: () => void, onCancel: () => void, key?: string | number) => (
    <div className="subs__form" key={key}>
      <input className="subs__in" placeholder="Store (e.g. Chewy)" value={f.merchant} onChange={(e) => set({ ...f, merchant: e.target.value })} />
      <input className="subs__in" placeholder="The deal (e.g. $20 off an order of $49+)" value={f.offer} onChange={(e) => set({ ...f, offer: e.target.value })} />
      <div className="subs__line">
        <input className="subs__in coup__in--code" placeholder="Code" value={f.code}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => set({ ...f, code: e.target.value })} />
        <input className="subs__in subs__in--amt" inputMode="decimal" placeholder="$ minimum" value={f.min} onChange={(e) => set({ ...f, min: numericAmount(e.target.value) })} />
        <label className="subs__lab">Expires <input className="subs__in" type="date" value={f.expires_on} onChange={(e) => set({ ...f, expires_on: e.target.value })} /></label>
      </div>
      <div className="subs__line">
        <select className="subs__in" value={f.where_valid} onChange={(e) => set({ ...f, where_valid: e.target.value })}>
          <option value="">Where it works…</option><option value="online">Online</option><option value="in_store">In store</option><option value="both">Online or in store</option>
        </select>
        <input className="subs__in coup__in--grow" placeholder="Website (https://…)" value={f.url}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => set({ ...f, url: e.target.value })} />
      </div>
      <textarea className="subs__in" rows={2} placeholder="Fine print (new customers only, one per household…)" value={f.terms} onChange={(e) => set({ ...f, terms: e.target.value })} />
      <div className="subs__acts">
        <button className="subs__btn subs__btn--quiet" onClick={onCancel}>Never mind</button>
        <button className="subs__btn" onClick={onSave}>{f.id ? 'Save' : 'Keep it'}</button>
      </div>
    </div>
  );

  return (
    <section className="budg subs coup" id="coupons">
      <div className="budg__head">
        <h2 className="budg__h2">Coupons</h2>
        {rows.length > 0 && <span className="subs__total">{rows.length} saved</span>}
      </div>
      <p className="subs__lead">
        Snap a photo and Lichen keeps the code, the deal and the fine print — no paper. A bell rings three days before one expires, and it disappears once it has.
      </p>

      <input ref={pick} type="file" accept="image/*,.heic,.heif" capture="environment" hidden onChange={(e) => void snap(e.target.files?.[0])} />
      <div className="coup__doors">
        <button className="subs__btn" disabled={busy} onClick={() => pick.current?.click()}>{busy ? 'Reading the photo…' : '📷 Snap a coupon'}</button>
        <button className="subs__add" disabled={busy} onClick={() => { setForms([{ ...blank }]); setNote(''); }}>⊕ Type one in</button>
      </div>
      {note && <p className="coup__note">{note}</p>}
      {forms.map((f, i) => (
        <div className="subs__row is-editing" key={'new' + i}>
          <span className="coup__check">{f.merchant ? 'Check what I read, then keep it' : 'New coupon'}</span>
          {formView(f, (g) => setForms(forms.map((x, j) => (j === i ? g : x))), () => void saveNew(i), () => void dropNew(i))}
        </div>
      ))}

      {rows.length === 0 && forms.length === 0 && <p className="subs__empty">No coupons yet.</p>}
      <ul className="subs__list">
        {rows.map((c) => {
          if (editing?.id === c.id) return <li key={c.id} className="subs__row is-editing">{formView(editing, setEditing, () => void saveEdit(), () => setEditing(null))}</li>;
          const d = c.expires_on ? daysUntil(c.expires_on) : null;
          const pic = c.photo_path ? photos[c.photo_path] : undefined;
          return (
            <li key={c.id} className={'subs__row' + (d != null && d <= 7 ? ' is-soon' : '')}>
              <div className="coup__top">
                {pic && <a href={pic} target="_blank" rel="noopener noreferrer" className="coup__thumb"><img src={pic} alt={`${c.merchant} coupon`} /></a>}
                <div className="subs__main">
                  <span className="subs__name">{c.merchant}</span>
                  <span className="coup__offer">{c.offer}</span>
                  <span className="subs__meta">
                    {c.expires_on ? (d! < 0 ? 'expired' : d === 0 ? 'expires today' : d === 1 ? 'expires tomorrow' : `expires ${dayOf(c.expires_on)}`) : 'no expiry date'}
                    {c.min_spend_cents ? <> · ${(c.min_spend_cents / 100).toFixed(0)} minimum</> : null}
                    {c.where_valid && <> · {WHERE[c.where_valid]}</>}
                  </span>
                </div>
              </div>
              {c.code && (
                <button className="coup__code" onClick={() => copy(c)} aria-label={`Copy code ${c.code}`}>
                  <span>{c.code}</span><span className="coup__copy">{copied === c.id ? 'Copied ✓' : 'Copy'}</span>
                </button>
              )}
              {c.terms && (open === c.id
                ? <p className="coup__terms">{c.terms} <button className="coup__fold" onClick={() => setOpen(null)}>Hide</button></p>
                : <button className="coup__fold" onClick={() => setOpen(c.id)}>Fine print ›</button>)}
              <div className="subs__acts">
                {c.url && <a className="subs__btn" href={c.url} target="_blank" rel="noopener noreferrer">Use it ↗</a>}
                <button className="subs__btn subs__btn--quiet" onClick={() => setEditing(fromRow(c))}>Edit</button>
                <button className={'subs__btn subs__btn--quiet' + (arm === c.id ? ' is-armed' : '')} onClick={() => void remove(c)}>
                  {arm === c.id ? 'Remove it?' : 'Used it'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {err && <p className="subs__err">{err}</p>}
    </section>
  );
}
