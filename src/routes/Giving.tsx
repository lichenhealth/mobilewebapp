import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './Donate.css';

/** MY GIVING — the private dashboard (founder, 2026-07-21): every member's
 *  own record of what they've given through Lichen. Strictly owner-only by
 *  RLS (donations donor-read policy + inkind own-read) — no counts shown to
 *  anyone else, ever, same doctrine as trust. Money donations + personal
 *  gifts + in-kind donated goods, with receipt numbers and the year's
 *  deductible total for tax season. */

interface MoneyRow {
  id: string; amount_cents: number; designation: string; frequency: string;
  kind: string; status: string; created_at: string; stripe_session_id: string;
}
interface InkindRow {
  id: string; description: string; status: string;
  accepted_at: string | null; created_at: string;
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const refNo = (r: MoneyRow) =>
  `LCH-${r.created_at.slice(0, 10).replace(/-/g, '')}-${r.stripe_session_id.slice(-6).toUpperCase()}`;
const ikRefNo = (r: InkindRow) =>
  `LCH-IK-${(r.accepted_at ?? '').slice(0, 10).replace(/-/g, '')}-${r.id.slice(0, 6).toUpperCase()}`;

export default function Giving() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [money, setMoney] = useState<MoneyRow[]>([]);
  const [inkind, setInkind] = useState<InkindRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      const [m, ik] = await Promise.all([
        supabase.from('donations')
          .select('id, amount_cents, designation, frequency, kind, status, created_at, stripe_session_id')
          .eq('donor_profile_id', user.id)
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('inkind_donations')
          .select('id, description, status, accepted_at, created_at')
          .eq('donor_profile_id', user.id)
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (!live) return;
      setMoney((m.data as MoneyRow[] | null) ?? []);
      setInkind((ik.data as InkindRow[] | null) ?? []);
      setReady(true);
    })();
    return () => { live = false; };
  }, [user]);

  if (loading || !ready) {
    return <div className="donate"><p className="donate__give-sub">Loading…</p></div>;
  }

  const year = new Date().getFullYear();
  const deductibleCents = money
    .filter((r) => r.kind === 'donation' && r.created_at.startsWith(String(year)))
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const acceptedInkind = inkind.filter((r) => r.status === 'accepted');

  return (
    <div className="donate">
      <button className="cmp__back" onClick={() => navigate('/donate')}>
        <Icon name="arrow-left" size={14} /> Giving
      </button>

      <header className="donate__head">
        <p className="eyebrow">Only you can see this</p>
        <h1 className="donate__title">
          My <span className="display-italic">giving.</span>
        </h1>
        <p className="donate__sub">
          Your private record of everything given through Lichen — donations,
          gifts, and donated goods.
        </p>
      </header>

      <div className="giving__total">
        <strong>{usd(deductibleCents)}</strong> tax-deductible donations in {year}
        {acceptedInkind.length > 0 && (
          <span> · {acceptedInkind.length} donated {acceptedInkind.length === 1 ? 'item' : 'items'} (value yours to determine)</span>
        )}
      </div>

      <section className="donate__give">
        <h2 className="donate__give-title">Money</h2>
        {money.length === 0 && (
          <p className="donate__give-sub">Nothing yet — your donations and gifts will gather here.</p>
        )}
        {money.map((r) => (
          <div className="giving__row" key={r.id}>
            <div className="giving__row-head">
              <strong>{usd(r.amount_cents)}</strong>
              <span className={'giving__kind' + (r.kind === 'sponsorship' ? ' is-gift' : '')}>
                {r.kind === 'sponsorship' ? 'Gift — not deductible' : 'Donation — deductible'}
              </span>
              <em>{new Date(r.created_at).toLocaleDateString()}</em>
            </div>
            {r.designation && <p className="giving__say">&ldquo;{r.designation}&rdquo;</p>}
            <p className="giving__ref">
              Receipt {refNo(r)}{r.frequency !== 'one-time' ? ` · ${r.frequency}` : ''}
            </p>
          </div>
        ))}
      </section>

      <section className="donate__give">
        <h2 className="donate__give-title">Donated goods</h2>
        {inkind.length === 0 && (
          <p className="donate__give-sub">
            Nothing yet — list a gift, choose &ldquo;Let Lichen route this,&rdquo;
            and &ldquo;Donate it to Lichen&rdquo; to give goods with a receipt.
          </p>
        )}
        {inkind.map((r) => (
          <div className="giving__row" key={r.id}>
            <div className="giving__row-head">
              <strong>{r.description}</strong>
              <em>{new Date(r.created_at).toLocaleDateString()}</em>
            </div>
            <p className="giving__ref">
              {r.status === 'accepted'
                ? `Accepted ${r.accepted_at ? new Date(r.accepted_at).toLocaleDateString() : ''} · Receipt ${ikRefNo(r)} · value is yours to determine`
                : r.status === 'declined' ? 'Not accepted'
                : 'Offered — awaiting steward acceptance'}
            </p>
          </div>
        ))}
      </section>

      <p className="donate__tax">
        Keep these records with your tax documents. Lichen never assigns a
        value to donated goods — fair market value is the donor&rsquo;s to
        determine. This page isn&rsquo;t tax advice.
      </p>
    </div>
  );
}
