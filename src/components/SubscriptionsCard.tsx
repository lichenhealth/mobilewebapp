import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { listSubscriptions, saveSubscription, removeBudgetItem, type Subscription } from '../lib/budgetApi';
import { numericAmount } from '../lib/ledgerApi';
import './BudgetCard.css';
import './SubscriptionsCard.css';

/** SUBSCRIPTIONS (founder 2026-11-24: "I want to be able to manage
 *  subscriptions better than I am right now and there is a lot of wasted
 *  money with auto renews"). The same rows as the Budget's expense lines —
 *  each also knows its next renewal and where to cancel. Lichen bells three
 *  days before a renewal; the Brain finds them in your receipts. */
const money = (c: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`);
const dayOf = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const daysUntil = (iso: string) => Math.round((new Date(iso + 'T12:00:00').getTime() - Date.now()) / 864e5);

type Draft = { id?: string; label: string; amount: string; cadence: 'monthly' | 'yearly'; renews_on: string; billed_via: string; manage_url: string };
const EMPTY: Draft = { label: '', amount: '', cadence: 'monthly', renews_on: '', billed_via: '', manage_url: '' };

export default function SubscriptionsCard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const me = user?.id ?? '';
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = () => { if (me) void listSubscriptions(me).then(setSubs); };
  useEffect(load, [me]);
  useEffect(() => {
    if (subs && window.location.hash === '#subscriptions') document.getElementById('subscriptions')?.scrollIntoView({ block: 'start' });
  }, [subs]);

  if (!me || subs === null) return null;
  const monthly = subs.reduce((t, s) => t + (s.amount_cents ?? 0) / (s.cadence === 'yearly' ? 12 : 1), 0);

  async function save() {
    if (!draft) return;
    if (!draft.label.trim()) { setErr('Name the subscription.'); return; }
    setErr('');
    try {
      await saveSubscription(me, {
        id: draft.id, label: draft.label, amount_cents: draft.amount ? Math.round(Number(draft.amount) * 100) : null,
        cadence: draft.cadence, renews_on: draft.renews_on || null, billed_via: draft.billed_via || null, manage_url: draft.manage_url || null,
      });
      setDraft(null); load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function cancelled(id: string) {
    if (arm !== id) { setArm(id); return; }
    await removeBudgetItem(id); setArm(null); load();
  }
  const edit = (s: Subscription) => setDraft({
    id: s.id, label: s.label, amount: s.amount_cents == null ? '' : String(s.amount_cents / 100), cadence: s.cadence,
    renews_on: s.renews_on ?? '', billed_via: s.billed_via ?? '', manage_url: s.manage_url ?? '',
  });
  const ask = () => nav('/assistant/feed?thread=currentcy&convo=new&ask=' + encodeURIComponent(
    'Find my paid subscriptions in my email receipts across all my inboxes and add them to my subscriptions, with prices and next renewal dates.'));

  const form = draft && (
    <div className="subs__form">
      <input className="subs__in" placeholder="Service (e.g. Netflix)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      <div className="subs__line">
        <input className="subs__in subs__in--amt" inputMode="decimal" placeholder="$ per renewal" value={draft.amount}
          onChange={(e) => setDraft({ ...draft, amount: numericAmount(e.target.value) })} />
        <select className="subs__in" value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as 'monthly' | 'yearly' })}>
          <option value="monthly">monthly</option><option value="yearly">yearly</option>
        </select>
        <label className="subs__lab">Next renewal <input className="subs__in" type="date" value={draft.renews_on} onChange={(e) => setDraft({ ...draft, renews_on: e.target.value })} /></label>
      </div>
      <input className="subs__in" placeholder="Billed through (Apple, Google Play, PayPal, a card…)" value={draft.billed_via} onChange={(e) => setDraft({ ...draft, billed_via: e.target.value })} />
      <input className="subs__in" placeholder="Manage / cancel link (https://…)" value={draft.manage_url}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setDraft({ ...draft, manage_url: e.target.value })} />
      <div className="subs__acts">
        <button className="subs__btn subs__btn--quiet" onClick={() => { setDraft(null); setErr(''); }}>Never mind</button>
        <button className="subs__btn" onClick={() => void save()}>{draft.id ? 'Save' : 'Add'}</button>
      </div>
    </div>
  );

  return (
    <section className="budg subs" id="subscriptions">
      <div className="budg__head">
        <h2 className="budg__h2">Subscriptions</h2>
        {subs.length > 0 && <span className="subs__total">{money(Math.round(monthly))} a month</span>}
      </div>
      <p className="subs__lead">
        What auto-renews, when, and where to cancel. A bell rings three days before each renewal.
      </p>
      <button className="subs__ask" onClick={ask}>✨ Ask your Brain to find them in your email receipts ›</button>
      {subs.length === 0 && !draft && <p className="subs__empty">Nothing here yet.</p>}
      <ul className="subs__list">
        {subs.map((s) => {
          const d = s.renews_on ? daysUntil(s.renews_on) : null;
          return draft?.id === s.id ? <li key={s.id} className="subs__row is-editing">{form}</li> : (
            <li key={s.id} className={'subs__row' + (d != null && d <= 3 ? ' is-soon' : '')}>
              <div className="subs__main">
                <span className="subs__name">{s.label}</span>
                <span className="subs__meta">
                  {money(s.amount_cents)} {s.cadence === 'yearly' ? 'a year' : 'a month'}
                  {s.renews_on && <> · renews {d === 0 ? 'today' : d === 1 ? 'tomorrow' : dayOf(s.renews_on)}</>}
                  {s.billed_via && <> · via {s.billed_via}</>}
                </span>
              </div>
              <div className="subs__acts">
                {s.manage_url && <a className="subs__btn" href={s.manage_url} target="_blank" rel="noopener noreferrer">Manage / cancel ↗</a>}
                <button className="subs__btn subs__btn--quiet" onClick={() => edit(s)}>Edit</button>
                <button className={'subs__btn subs__btn--quiet' + (arm === s.id ? ' is-armed' : '')} onClick={() => void cancelled(s.id)}>
                  {arm === s.id ? 'Take it off?' : 'I cancelled it'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {draft && !draft.id && form}
      {!draft && <button className="subs__add" onClick={() => setDraft({ ...EMPTY })}>⊕ Add a subscription</button>}
      {err && <p className="subs__err">{err}</p>}
    </section>
  );
}
