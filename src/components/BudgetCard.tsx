import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { myBalance, fmtCurrentNum, numericAmount } from '../lib/ledgerApi';
import {
  BudgetItem, BudgetBucket, BudgetCadence,
  listBudget, addBudgetManual, removeBudgetItem, ledgerFlows,
} from '../lib/budgetApi';
import { Bolt } from './CurrentcyCard';
import './BudgetCard.css';

/** BUDGET (founder 2026-10-02: "like a bank account, but also like
 *  budgeting software… balance, energy in and energy out for each month or
 *  year"). FOUR SECTIONS since the same day's second pass (founder:
 *  "change energy needed to Expenses and Energy provided to Income and
 *  have two more sections, one for excess stuff you have to give… no need
 *  for reciprocal compensation, and one for 'need' — since melanie isn't
 *  making enough money, she doesn't get acupuncture she needs… that
 *  wouldn't be an expense because she doesn't have the funds"):
 *  - EXPENSES: what life asks and you pay — regular lines normalized to
 *    the period + the one-time procure list totalled against the balance;
 *  - INCOME: what you provide expecting Current back;
 *  - OFFERED FREELY: given to the network, no reciprocal compensation;
 *  - NEEDS: what you need but can't fund — each wears "Ask the network",
 *    which is what plugs it into the existing gift/ISO matcher (a budget
 *    list is private; a public ask is a deliberate act).
 *  Plus the period's REAL in/out summed from the ledger itself. Private to
 *  the member, planning only — nothing here ever moves a Current. */
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
  const [bucket, setBucket] = useState<BudgetBucket>('expense');
  const [cad, setCad] = useState<BudgetCadence>('monthly');
  // A one-time line may carry its date (founder 2026-10-02: "so it gets
  // nested into that month and that year") — defaults to today.
  const [onDate, setOnDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  // A DATED one-time line belongs to the Month/Year holding its date;
  // undated one-time lines (legacy + bolt-added listings) are standing and
  // show in every view. Lines dated outside the current period step out of
  // the lists and totals, counted honestly below.
  const today = new Date();
  const inPeriod = (i: BudgetItem) => {
    if (i.cadence !== 'once' || !i.on_date) return true;
    const d = new Date(i.on_date + 'T00:00');
    return view === 'month'
      ? d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
      : d.getFullYear() === today.getFullYear();
  };
  const visible = items.filter(inPeriod);
  const hiddenOnce = items.length - visible.length;

  const expenses = visible.filter((i) => i.bucket === 'expense');
  const expensesRegular = expenses.filter((i) => i.cadence !== 'once');
  const procure = expenses.filter((i) => i.cadence === 'once');
  const income = visible.filter((i) => i.bucket === 'income');
  const gifts = visible.filter((i) => i.bucket === 'gift');
  const needs = visible.filter((i) => i.bucket === 'need');

  const cents = (i: BudgetItem) => i.post_id ? (i.postPriceCents ?? null) : i.amount_cents;
  /** A recurring line's amount in the CHOSEN period's terms. */
  const perPeriod = (i: BudgetItem) => {
    const c = cents(i) ?? 0;
    if (i.cadence === 'once') return c;
    if (view === 'month') return i.cadence === 'monthly' ? c : c / 12;
    return i.cadence === 'monthly' ? c * 12 : c;
  };
  const expensesPeriod = expensesRegular.reduce((s, i) => s + perPeriod(i), 0);
  const incomePeriod = income.filter((i) => i.cadence !== 'once').reduce((s, i) => s + perPeriod(i), 0);
  const procureTotal = procure.reduce((s, i) => s + (cents(i) ?? 0), 0);
  const unpriced = procure.filter((i) => i.post_id && !i.postGone && i.postPriceCents == null).length;
  const gap = balance === null ? null : procureTotal / 100 - balance;
  // A need may carry what it would cost (⚡0 = no number yet — unlike a
  // gift, where 0 MEANS freely; the bucket disambiguates the same storage).
  const needsPriced = needs.filter((i) => (cents(i) ?? 0) > 0);
  const needsTotal = needsPriced.reduce((s, i) => s + (cents(i) ?? 0), 0);
  const needsUnpriced = needs.length - needsPriced.length;

  const amt = (c: number) => <><Bolt small />{fmtCurrentNum(Math.round(c) / 100)}</>;

  const add = async () => {
    const n = Number(amount);
    // Gifts never need a number; a need may not know its cost yet.
    const emptyOk = (bucket === 'gift' || bucket === 'need') && amount.trim() === '';
    if (!label.trim()) { setErr('Name the line — "Mortgage", "Acupuncture", "Apples"…'); return; }
    if (!emptyOk && (!Number.isFinite(n) || n < 0 || amount.trim() === '')) {
      setErr(bucket === 'expense' ? 'Enter what it costs.'
        : bucket === 'income' ? 'Enter the Current you’re asking — or file it under Offered freely.'
        : 'Enter an amount, or leave it empty.');
      return;
    }
    setBusy(true); setErr('');
    try {
      await addBudgetManual(me, {
        label: label.trim(), amountCents: emptyOk ? 0 : Math.round(n * 100),
        bucket, cadence: cad, onDate: cad === 'once' ? onDate : null,
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

  const row = (i: BudgetItem, normalized: boolean) => {
    const noNumber = i.bucket === 'gift' || ((cents(i) ?? 0) === 0 && i.bucket === 'need');
    return (
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
          {i.cadence === 'once' && i.on_date && (
            <em>{new Date(i.on_date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</em>
          )}
          {i.bucket === 'need' && noNumber && <em>cost unknown</em>}
          {i.post_id && !i.postGone && i.postPriceCents == null && <em>no price listed</em>}
        </span>
        {!noNumber && (
          <span className="budg__amt">{amt(normalized ? perPeriod(i) : (cents(i) ?? 0))}</span>
        )}
        {!i.post_id && (i.bucket === 'need' || (i.bucket === 'expense' && i.cadence === 'once')) && (
          <button
            className="budg__ask"
            title="Post it as an In-search-of — the network's gift matcher watches open asks"
            onClick={() => navigate(`/compose?area=marketplace&title=${encodeURIComponent(i.label ?? '')}&body=${encodeURIComponent('In search of: ' + (i.label ?? ''))}`)}
          >Ask the network ›</button>
        )}
        {!i.post_id && (i.bucket === 'income' || i.bucket === 'gift') && (
          <button
            className="budg__ask"
            title="List it in Marketplace — as a gift, a trade, or for Current-cy"
            onClick={() => navigate(`/compose?area=marketplace&title=${encodeURIComponent(i.label ?? '')}${i.bucket === 'gift' ? '&entrust=1' : ''}`)}
          >List it ›</button>
        )}
        <button className="budg__x" aria-label="Remove" onClick={() => void remove(i.id)}>×</button>
      </div>
    );
  };

  const BUCKETS: { id: BudgetBucket; label: string }[] = [
    { id: 'expense', label: 'Expense' },
    { id: 'income', label: 'Income' },
    { id: 'gift', label: 'Offered freely' },
    { id: 'need', label: 'Need' },
  ];

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

      {expenses.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Expenses</h3>
          {expensesRegular.map((i) => row(i, true))}
          {expensesRegular.length > 0 && (
            <p className="budg__total">Regular lines, this {view}: {amt(expensesPeriod)}</p>
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

      {income.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Income</h3>
          {income.map((i) => row(i, i.cadence !== 'once'))}
          <p className="budg__total">Asking Current, this {view}: {amt(incomePeriod)}</p>
        </div>
      )}

      {gifts.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Offered freely</h3>
          {gifts.map((i) => row(i, false))}
          <p className="budg__total">
            {gifts.length === 1 ? 'One offering' : `${gifts.length} offerings`} into the
            network, no compensation asked.
          </p>
        </div>
      )}

      {needs.length > 0 && (
        <div className="budg__group">
          <h3 className="budg__h3">Needs</h3>
          {needs.map((i) => row(i, false))}
          <p className="budg__total">
            {needsPriced.length > 0 && <>Meeting the priced needs would take {amt(needsTotal)}{needsUnpriced > 0 && <em> · {needsUnpriced} without a number yet</em>}. </>}
            The network can help — each line has an Ask door.
          </p>
        </div>
      )}

      {items.length === 0 && (
        <p className="budg__empty">
          Nothing budgeted yet. Add a listing from its page (the bolt beside
          Save), or add a line here — the mortgage as an expense, the lessons
          you give as income, the apples you share offered freely, the care
          you can&rsquo;t yet afford as a need.
        </p>
      )}

      {hiddenOnce > 0 && (
        <p className="budg__total">
          {hiddenOnce === 1 ? 'One one-time line sits' : `${hiddenOnce} one-time lines sit`} in
          {view === 'month' ? ' other months' : ' other years'} — switch the view to see
          {hiddenOnce === 1 ? ' it' : ' them'}.
        </p>
      )}

      <div className="budg__addform">
        <input className="budg__input" placeholder="What is it? e.g. Mortgage, or Acupuncture" value={label}
          onChange={(e) => setLabel(e.target.value)} />
        <input className="budg__input budg__input--amt"
          placeholder={bucket === 'gift' ? 'no $ needed' : bucket === 'need' ? '$ if known' : '$ amount'}
          inputMode="decimal"
          value={amount} onChange={(e) => setAmount(numericAmount(e.target.value))} />
        <div className="budg__chips">
          {BUCKETS.map((b) => (
            <button key={b.id} className={'budg__chip' + (bucket === b.id ? ' is-on' : '')} onClick={() => setBucket(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
        {/* One time sits LAST with its date BESIDE it (founder 2026-10-02
            markup: "move 1x over here, so when you click it, the date is
            next to it") — the chip and date share one inline-flex unit, so
            at phone width the PAIR wraps together and the date never lands
            on a row away from the chip that summoned it. */}
        <div className="budg__chips">
          {(['monthly', 'yearly'] as const).map((c) => (
            <button key={c} className={'budg__chip' + (cad === c ? ' is-on' : '')} onClick={() => setCad(c)}>
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
          <span className="budg__once">
            <button className={'budg__chip' + (cad === 'once' ? ' is-on' : '')} onClick={() => setCad('once')}>
              One time
            </button>
            {cad === 'once' && (
              <input
                className="budg__input budg__input--date" type="date" value={onDate}
                aria-label="When?"
                onChange={(e) => setOnDate(e.target.value)}
              />
            )}
          </span>
        </div>
        {err && <p className="budg__err">{err}</p>}
        <button className="btn" disabled={busy} onClick={() => void add()}>
          {busy ? 'Adding…' : 'Add to budget'}
        </button>
      </div>
    </section>
  );
}
