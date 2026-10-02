import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { myBalance, fmtCurrentNum } from '../lib/ledgerApi';
import {
  BudgetItem, BudgetCadence, BudgetDirection,
  listBudget, addBudgetManual, removeBudgetItem, ledgerFlows,
} from '../lib/budgetApi';
import { Bolt } from './CurrentcyCard';
import './BudgetCard.css';

/** BUDGET (founder 2026-10-02: "like a bank account, but also like
 *  budgeting software… balance, energy in and energy out for each month or
 *  year"; second pass same hour: "energy needed and energy provided maybe?
 *  …some stuff you'll want current-cy for, other stuff you'll be donating
 *  because you can"). Private to the member, planning only — nothing here
 *  ever moves a Current. Three readings:
 *  - the period's REAL energy in / out, summed from the ledger itself;
 *  - ENERGY NEEDED: regular lines (the mortgage — monthly or yearly,
 *    normalized to the chosen period) and the one-time procure list, whose
 *    platform items pull their price LIVE from the listing, totalled
 *    against the balance;
 *  - ENERGY PROVIDED: the ways you give into the network — a line can ask
 *    Current (planned income) or carry ⚡0, offered freely.
 *  A manual need wears an "Ask the network" door into Compose — posting it
 *  as an In-search-of is what plugs it into the existing gift/ISO matcher
 *  (a budget list is private; a public ask is a deliberate act). */
export default function BudgetCard() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [view, setView] = useState<'month' | 'year'>('month');
  const [items, setItems] = useState<BudgetItem[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [flows, setFlows] = useState<{ inAmt: number; outAmt: number } | null>(null);

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<BudgetDirection>('out');
  const [cad, setCad] = useState<BudgetCadence>('monthly');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const periodStart = useMemo(() => {
    const now = new Date();
    return view === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      : new Date(now.getFullYear(), 0, 1).toISOString();
  }, [view]);
  const periodName = view === 'month'
    ? new Date().toLocaleString(undefined, { month: 'long' })
    : String(new Date().getFullYear());

  const load = async () => {
    const [its, bal] = await Promise.all([listBudget(me), myBalance(me)]);
    setItems(its); setBalance(bal);
  };
  useEffect(() => { if (me) void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [me]);
  useEffect(() => {
    if (me) void ledgerFlows(me, periodStart).then(setFlows);
  }, [me, periodStart]);

  if (!me || items === null) return null;

  // Her grammar, not accounting's: NEEDED is what life asks of you (out),
  // PROVIDED is what you give into the network (in — for Current or freely).
  const needed = items.filter((i) => i.direction === 'out');
  const neededRegular = needed.filter((i) => i.cadence !== 'once');
  const procure = needed.filter((i) => i.cadence === 'once');
  const provided = items.filter((i) => i.direction === 'in');

  const cents = (i: BudgetItem) => i.post_id ? (i.postPriceCents ?? null) : i.amount_cents;
  /** A recurring line's amount in the CHOSEN period's terms. */
  const perPeriod = (i: BudgetItem) => {
    const c = cents(i) ?? 0;
    if (i.cadence === 'once') return c;
    if (view === 'month') return i.cadence === 'monthly' ? c : c / 12;
    return i.cadence === 'monthly' ? c * 12 : c;
  };
  const neededPeriod = neededRegular.reduce((s, i) => s + perPeriod(i), 0);
  const providedPeriod = provided.filter((i) => i.cadence !== 'once').reduce((s, i) => s + perPeriod(i), 0);
  const gifted = provided.filter((i) => (cents(i) ?? 0) === 0).length;
  const procureTotal = procure.reduce((s, i) => s + (cents(i) ?? 0), 0);
  const unpriced = procure.filter((i) => i.post_id && !i.postGone && i.postPriceCents == null).length;
  const gap = balance === null ? null : procureTotal / 100 - balance;

  const amt = (c: number) => <><Bolt small />{fmtCurrentNum(Math.round(c) / 100)}</>;

  const add = async () => {
    const n = Number(amount);
    // A provided line may carry ⚡0 — "donating because you can".
    const zeroOk = dir === 'in' && amount.trim() === '';
    if (!label.trim()) { setErr('Name the line — "Mortgage", "Riding lessons", "Apples"…'); return; }
    if (!zeroOk && (!Number.isFinite(n) || n < 0)) { setErr('Enter an amount — or leave it empty on a provided line to offer it freely.'); return; }
    setBusy(true); setErr('');
    try {
      await addBudgetManual(me, {
        label: label.trim(), amountCents: zeroOk ? 0 : Math.round(n * 100),
        direction: dir, cadence: cad,
      });
      setLabel(''); setAmount('');
      await load();
    } catch (e) {
      setErr((e as { message?: string } | null)?.message || 'Could not add it.');
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
    await removeBudgetItem(id).catch(() => load());
  };

  const row = (i: BudgetItem, normalized: boolean) => (
    <div className="budg__row" key={i.id}>
      {i.post_id && !i.postGone ? (
        <Link className="budg__name link-cue" to={`/posts/${i.post_id}`}>{i.postTitle}</Link>
      ) : i.postGone ? (
        <span className="budg__name budg__name--gone">A listing that's no longer available</span>
      ) : (
        <span className="budg__name">{i.label}</span>
      )}
      <span className="budg__tags">
        {i.cadence !== 'once' && <em>{i.cadence === 'monthly' ? (view === 'month' ? '/mo' : '×12') : (view === 'month' ? '/12' : '/yr')}</em>}
        {i.direction === 'in' && (cents(i) ?? 0) === 0 && <em className="budg__gift-tag">offered freely</em>}
        {i.post_id && !i.postGone && i.postPriceCents == null && <em>no price listed</em>}
      </span>
      {!(i.direction === 'in' && (cents(i) ?? 0) === 0) && (
        <span className="budg__amt">{amt(normalized ? perPeriod(i) : (cents(i) ?? 0))}</span>
      )}
      {!i.post_id && i.direction === 'out' && i.cadence === 'once' && (
        <button
          className="budg__ask"
          title="Post it as an In-search-of — the network's gift matcher watches open asks"
          onClick={() => navigate(`/compose?area=marketplace&title=${encodeURIComponent(i.label ?? '')}&body=${encodeURIComponent('In search of: ' + (i.label ?? ''))}`)}
        >Ask the network ›</button>
      )}
      {!i.post_id && i.direction === 'in' && (
        <button
          className="budg__ask"
          title="List it in Marketplace — as a gift, a trade, or for Current-cy"
          onClick={() => navigate(`/compose?area=marketplace&title=${encodeURIComponent(i.label ?? '')}`)}
        >List it ›</button>
      )}
      <button className="budg__x" aria-label="Remove" onClick={() => void remove(i.id)}>×</button>
    </div>
  );

  return (
    <section className="budg">
      <div className="budg__head">
        <h2 className="budg__h2">Budget</h2>
        <div className="budg__view" role="tablist">
          <button className={view === 'month' ? 'is-on' : ''} onClick={() => setView('month')}>Month</button>
          <button className={view === 'year' ? 'is-on' : ''} onClick={() => setView('year')}>Year</button>
        </div>
      </div>

      {flows && (
        <p className="budg__flows">
          {periodName} so far: <strong className="budg__pos">{amt(flows.inAmt * 100)} in</strong>
          {' · '}<strong>{amt(flows.outAmt * 100)} out</strong>
          {' · '}net {flows.inAmt - flows.outAmt < 0 ? '−' : '+'}{amt(Math.abs(flows.inAmt - flows.outAmt) * 100)}
          <em> — from your real statement</em>
        </p>
      )}

      {needed.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Energy needed</h3>
          {neededRegular.map((i) => row(i, true))}
          {neededRegular.length > 0 && (
            <p className="budg__total">Regular lines, this {view}: {amt(neededPeriod)}</p>
          )}
          {procure.map((i) => row(i, false))}
          {procure.length > 0 && (
            <p className="budg__total">
              To procure: {amt(procureTotal)}
              {unpriced > 0 && <em> + {unpriced} unpriced</em>}
              {balance !== null && (gap !== null && gap > 0
                ? <> — you hold {amt(balance * 100)}, so {amt(gap * 100)} more would cover it</>
                : <> — your {amt((balance ?? 0) * 100)} covers it ✓</>)}
            </p>
          )}
        </div>
      )}

      {provided.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Energy provided</h3>
          {provided.map((i) => row(i, i.cadence !== 'once'))}
          <p className="budg__total">
            Asking Current, this {view}: {amt(providedPeriod)}
            {gifted > 0 && <em> · {gifted} offered freely</em>}
          </p>
        </div>
      )}

      {items.length === 0 && (
        <p className="budg__empty">
          Nothing budgeted yet. Add a listing from its page (the bolt beside
          Save), or add a line here — the mortgage, firewood for winter, the
          lessons you give, the apples you share. On or off Lichen.
        </p>
      )}

      <div className="budg__addform">
        <input className="budg__input" placeholder="What is it? e.g. Mortgage, or Riding lessons" value={label}
          onChange={(e) => setLabel(e.target.value)} />
        <input className="budg__input budg__input--amt"
          placeholder={dir === 'in' ? '$ asked (empty = freely)' : '$ amount'} inputMode="decimal"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="budg__chips">
          {(['out', 'in'] as const).map((d) => (
            <button key={d} className={'budg__chip' + (dir === d ? ' is-on' : '')} onClick={() => setDir(d)}>
              {d === 'out' ? 'Energy needed' : 'Energy provided'}
            </button>
          ))}
          {(['once', 'monthly', 'yearly'] as const).map((c) => (
            <button key={c} className={'budg__chip' + (cad === c ? ' is-on' : '')} onClick={() => setCad(c)}>
              {c === 'once' ? 'One time' : c === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
        {err && <p className="budg__err">{err}</p>}
        <button className="btn" disabled={busy} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add to budget'}
        </button>
      </div>
    </section>
  );
}
