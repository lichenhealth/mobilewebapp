import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './BudgetCard.css';

// THE VALUE RECORD (founder 2026-11-16: "We track value delivered and
// received across the board: whether you're gifting apples or asking for an
// exchange (trade) or selling them for dollars"). Private — only you see it —
// and a RECORD, never a balance: "Gifts flow to need. Giving earns no claim
// on receiving." Read live from what already happened (my_value_flow).

type Row = { at: string; direction: 'given' | 'received'; manner: 'gift' | 'trade' | 'lend' | 'sale';
  title: string; other_name: string | null; value_cents: number | null; source: string };

const MANNER: Record<Row['manner'], string> = { gift: 'Gifts', trade: 'Trades', lend: 'Lending', sale: 'Sales' };
const dollars = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : (c / 100).toLocaleString());

export default function ValueFlowCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    void supabase.rpc('my_value_flow').then(({ data, error }) => {
      if (live) setRows(error ? [] : ((data as Row[] | null) ?? []));
    });
    return () => { live = false; };
  }, []);

  const sums = useMemo(() => {
    const out: Record<string, { given: number; received: number; givenN: number; receivedN: number }> = {};
    for (const r of rows ?? []) {
      const s = (out[r.manner] ??= { given: 0, received: 0, givenN: 0, receivedN: 0 });
      if (r.direction === 'given') { s.given += r.value_cents ?? 0; s.givenN++; }
      else { s.received += r.value_cents ?? 0; s.receivedN++; }
    }
    return out;
  }, [rows]);

  if (rows === null) return null;
  const shown = all ? rows : rows.slice(0, 6);

  return (
    <section className="budg vflow">
      <h2 className="budg__h2">Value you&rsquo;ve given and received</h2>
      <p className="budg__empty vflow__lead">
        Every exchange — gift, trade or sale — with the value it carried. Only you
        see this. It&rsquo;s a record of your part in the rebalancing, never a balance
        owed: gifts flow to need, and giving earns no claim on receiving.
      </p>
      {rows.length === 0 ? (
        <p className="budg__empty">Nothing yet. Completed gifts, trades and paid sessions or sales land here on their own.</p>
      ) : (<>
        <div className="vflow__sums">
          {(Object.keys(MANNER) as Row['manner'][]).filter((m) => sums[m]).map((m) => (
            <div key={m} className="vflow__sum">
              <span className="vflow__sum-k">{MANNER[m]}</span>
              <span>Given {sums[m].givenN}{sums[m].given ? ` · ${dollars(sums[m].given)}` : ''}</span>
              <span>Received {sums[m].receivedN}{sums[m].received ? ` · ${dollars(sums[m].received)}` : ''}</span>
            </div>
          ))}
        </div>
        {shown.map((r, i) => (
          <div key={i} className="budg__row vflow__row">
            <span className="budg__name">{r.title}</span>
            <span className="budg__tags">
              <em>{r.direction === 'given' ? 'to' : 'from'} {r.other_name ?? 'someone'}</em>
              <em>{MANNER[r.manner].replace(/s$/, '').replace('Lending', 'Lend').toLowerCase()}</em>
              <em>{new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</em>
            </span>
            <span className="budg__amt">{r.value_cents ? dollars(r.value_cents) : 'unvalued'}</span>
          </div>
        ))}
        {rows.length > 6 && (
          <button className="budg__ask vflow__more" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${rows.length}`}</button>
        )}
      </>)}
    </section>
  );
}
