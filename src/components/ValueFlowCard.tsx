import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { numericAmount } from '../lib/ledgerApi';
import {
  addManualTrueValue, deleteTrueValue, listTrueValues, saveTrueValueFor, searchBeings, type TrueValue,
} from '../lib/trueValueApi';
import './BudgetCard.css';

// THE VALUE RECORD + THE TRUE VALUE LAYER (founder 2026-11-16: "We track
// value delivered and received across the board… what is valued and how
// value is exchanged today, versus the true value that should be exchanged
// in a fully reciprocal and inclusive economy (that includes land, animals,
// plants and elements)"). Private — only you see it — and a RECORD, never a
// balance: "Gifts flow to need. Giving earns no claim on receiving."

type Row = { at: string; direction: 'given' | 'received'; manner: 'gift' | 'trade' | 'lend' | 'sale';
  title: string; other_name: string | null; value_cents: number | null; source: 'exchange' | 'session' | 'order'; source_id: string };

const MANNER: Record<Row['manner'], string> = { gift: 'Gifts', trade: 'Trades', lend: 'Lending', sale: 'Sales' };
const dollars = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : (c / 100).toLocaleString());
const cents = (s: string) => (s ? Math.round(parseFloat(s) * 100) : null);
const when = (at: string) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type Item =
  | { k: 'flow'; at: string; row: Row; tv: TrueValue | undefined }
  | { k: 'manual'; at: string; tv: TrueValue };

export default function ValueFlowCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tvs, setTvs] = useState<TrueValue[]>([]);
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let live = true;
    void supabase.rpc('my_value_flow').then(({ data, error }) => {
      if (live) setRows(error ? [] : ((data as Row[] | null) ?? []));
    });
    listTrueValues().then((t) => { if (live) setTvs(t); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const tvBySource = useMemo(() => {
    const m = new Map<string, TrueValue>();
    for (const t of tvs) if (t.source_id) m.set(t.source + ':' + t.source_id, t);
    return m;
  }, [tvs]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = (rows ?? []).map((row) => ({ k: 'flow' as const, at: row.at, row, tv: tvBySource.get(row.source + ':' + row.source_id) }));
    for (const t of tvs) if (t.source === 'manual') out.push({ k: 'manual', at: t.at, tv: t });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [rows, tvs, tvBySource]);

  const sums = useMemo(() => {
    const out: Record<string, { given: number; received: number; givenN: number; receivedN: number }> = {};
    for (const r of rows ?? []) {
      const s = (out[r.manner] ??= { given: 0, received: 0, givenN: 0, receivedN: 0 });
      if (r.direction === 'given') { s.given += r.value_cents ?? 0; s.givenN++; }
      else { s.received += r.value_cents ?? 0; s.receivedN++; }
    }
    return out;
  }, [rows]);

  // Exchanged vs true, only across what you've valued — a fair comparison.
  const truth = useMemo(() => {
    const t = { given: { ex: 0, tr: 0, n: 0 }, received: { ex: 0, tr: 0, n: 0 } };
    for (const it of items) {
      if (!it.tv) continue;
      const side = t[it.tv.direction];
      side.tr += it.tv.true_cents;
      side.ex += it.k === 'flow' ? (it.row.value_cents ?? 0) : (it.tv.exchanged_cents ?? 0);
      side.n++;
    }
    return t;
  }, [items]);

  if (rows === null) return null;
  const shown = all ? items : items.slice(0, 6);
  const upsert = (t: TrueValue) => setTvs((cur) => [t, ...cur.filter((x) => x.id !== t.id)]);
  const drop = (id: string) => setTvs((cur) => cur.filter((x) => x.id !== id));

  return (
    <section className="budg vflow">
      <h2 className="budg__h2">Value you&rsquo;ve given and received</h2>
      <p className="budg__empty vflow__lead">
        Every exchange — gift, trade or sale — with what changed hands, and beside
        it what you feel it was truly worth. Your word counts the moment you
        set it; a Lichen steward takes a look after. Only you and the stewards see it. It&rsquo;s a record
        of your part in the rebalancing, never a balance owed: gifts flow to need,
        and giving earns no claim on receiving.
      </p>

      {items.length > 0 && Object.keys(sums).length > 0 && (
        <div className="vflow__sums">
          {(Object.keys(MANNER) as Row['manner'][]).filter((m) => sums[m]).map((m) => (
            <div key={m} className="vflow__sum">
              <span className="vflow__sum-k">{MANNER[m]}</span>
              <span>Given {sums[m].givenN}{sums[m].given ? ` · ${dollars(sums[m].given)}` : ''}</span>
              <span>Received {sums[m].receivedN}{sums[m].received ? ` · ${dollars(sums[m].received)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {(truth.given.n > 0 || truth.received.n > 0) && (
        <div className="vflow__truth">
          {(['received', 'given'] as const).filter((d) => truth[d].n > 0).map((d) => {
            const s = truth[d]; const gap = s.tr - s.ex;
            return (
              <p key={d}>
                <strong>{d === 'received' ? 'Received' : 'Given'}</strong>: {dollars(s.ex)} changed hands, truly worth {dollars(s.tr)}
                {gap > 0 && <em> — {dollars(gap)} more than was exchanged</em>}
                {gap < 0 && <em> — {dollars(-gap)} less than was exchanged</em>}
              </p>
            );
          })}
        </div>
      )}

      {items.length === 0 && !adding && (
        <p className="budg__empty">Nothing yet. Completed gifts, trades and paid sessions or sales land here on their own — or record a value yourself.</p>
      )}

      {shown.map((it) => {
        const key = it.k === 'flow' ? it.row.source + ':' + it.row.source_id : it.tv.id;
        const tv = it.tv;
        const title = it.k === 'flow' ? it.row.title : (tv?.title || 'A value');
        const dir = it.k === 'flow' ? it.row.direction : tv!.direction;
        const other = it.k === 'flow' ? it.row.other_name : (tv?.being?.full_name || tv?.counterparty);
        const exchanged = it.k === 'flow' ? it.row.value_cents : tv?.exchanged_cents ?? null;
        return (
          <div key={key} className="vflow__item">
            <div className="budg__row vflow__row">
              <span className="budg__name">{title}</span>
              <span className="budg__tags">
                <em>{dir === 'given' ? 'to' : 'from'} {other ?? 'someone'}</em>
                {it.k === 'flow'
                  ? <em>{MANNER[it.row.manner].replace(/s$/, '').replace('Lending', 'Lend').toLowerCase()}</em>
                  : <em>off Lichen</em>}
                <em>{when(it.at)}</em>
              </span>
              <span className="budg__amt">{exchanged ? dollars(exchanged) : it.k === 'flow' ? 'unvalued' : '—'}</span>
            </div>
            {editing === key ? (
              <TrueValueForm
                initial={tv}
                onCancel={() => setEditing(null)}
                onSave={async (tc, note) => {
                  if (it.k === 'flow') {
                    const r = it.row;
                    upsert(await saveTrueValueFor({ source: r.source, source_id: r.source_id, direction: r.direction, title: r.title, counterparty: r.other_name, exchanged_cents: r.value_cents, at: r.at }, tc, note));
                  } else {
                    const { data, error } = await supabase.from('true_values').update({ true_cents: tc, note }).eq('id', tv!.id).select('id').single();
                    if (error || !data) throw new Error(error?.message || 'Could not save.');
                    upsert({ ...tv!, true_cents: tc, note, review_status: 'pending', review_note: null });
                  }
                  setEditing(null);
                }}
                onRemove={tv ? async () => { await deleteTrueValue(tv.id); drop(tv.id); setEditing(null); } : undefined}
              />
            ) : (
              <p className="vflow__tv">
                {tv
                  ? <>Truly worth <strong>{dollars(tv.true_cents)}</strong>{tv.note ? ` — ${tv.note}` : ''}
                      {' · '}<span className={'vflow__rev vflow__rev--' + tv.review_status}>
                        {tv.review_status === 'reviewed' ? 'reviewed ✓' : tv.review_status === 'questioned' ? `a steward has a question${tv.review_note ? `: ${tv.review_note}` : ''}` : 'a steward will take a look'}
                      </span>{' · '}</>
                  : null}
                <button className="vflow__tvbtn" onClick={() => setEditing(key)}>{tv ? 'Edit' : 'What was it truly worth? ›'}</button>
              </p>
            )}
          </div>
        );
      })}
      {items.length > 6 && (
        <button className="budg__ask vflow__more" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${items.length}`}</button>
      )}

      {adding
        ? <ManualForm onCancel={() => setAdding(false)} onSaved={(t) => { upsert(t); setAdding(false); }} />
        : <button className="budg__ask vflow__add" onClick={() => setAdding(true)}>⊕ Record a value that didn&rsquo;t pass through Lichen</button>}
    </section>
  );
}

function TrueValueForm({ initial, onSave, onCancel, onRemove }: {
  initial: TrueValue | undefined; onSave: (tc: number, note: string | null) => Promise<void>;
  onCancel: () => void; onRemove?: () => Promise<void>;
}) {
  const [amt, setAmt] = useState(initial ? String(initial.true_cents / 100) : '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [err, setErr] = useState('');
  const go = async () => {
    const c = cents(amt);
    if (c == null) { setErr('Name an amount — your best sense of it.'); return; }
    try { await onSave(c, note.trim() || null); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="vflow__form">
      <input className="budg__offer-in vflow__amt" inputMode="decimal" placeholder="$ truly worth"
        value={amt} onChange={(e) => setAmt(numericAmount(e.target.value))} autoFocus />
      <input className="budg__offer-in" placeholder="Why — optional" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="vflow__formacts">
        <button className="btn btn-primary vflow__save" onClick={() => void go()}>Save</button>
        <button className="vflow__tvbtn" onClick={onCancel}>Cancel</button>
        {onRemove && <button className="vflow__tvbtn vflow__rm" onClick={() => void onRemove().catch((e) => setErr((e as Error).message))}>Remove</button>}
      </div>
      {err && <p className="budg__err">{err}</p>}
    </div>
  );
}

function ManualForm({ onSaved, onCancel }: { onSaved: (t: TrueValue) => void; onCancel: () => void }) {
  const [dir, setDir] = useState<'received' | 'given'>('received');
  const [title, setTitle] = useState('');
  const [who, setWho] = useState('');
  const [being, setBeing] = useState<{ id: string; full_name: string } | null>(null);
  const [hits, setHits] = useState<{ id: string; full_name: string; kind: string }[]>([]);
  const [ex, setEx] = useState('');
  const [tr, setTr] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (being || who.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { void searchBeings(who).then(setHits); }, 250);
    return () => clearTimeout(t);
  }, [who, being]);
  const go = async () => {
    setErr('');
    const tc = cents(tr);
    if (!title.trim()) { setErr('Say what it was.'); return; }
    if (tc == null) { setErr('Name what it was truly worth — your best sense of it.'); return; }
    try {
      onSaved(await addManualTrueValue({ direction: dir, title: title.trim(), counterparty: being ? null : (who.trim() || null), being_id: being?.id ?? null, exchanged_cents: cents(ex), true_cents: tc, note: note.trim() || null }));
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="vflow__form vflow__form--manual">
      <div className="budg__offer budg__offer-row">
        {(['received', 'given'] as const).map((d) => (
          <button key={d} type="button" className={'budg__chip' + (dir === d ? ' is-on' : '')} onClick={() => setDir(d)}>
            {d === 'received' ? 'I received' : 'I gave'}
          </button>
        ))}
      </div>
      <input className="budg__offer-in" placeholder="What — e.g. Huachuma's medicine in the October ceremony" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      {being ? (
        <p className="vflow__tv">{dir === 'received' ? 'From' : 'To'} <strong>{being.full_name}</strong> · <button className="vflow__tvbtn" onClick={() => { setBeing(null); setWho(''); }}>change</button></p>
      ) : (
        <div className="vflow__who">
          <input className="budg__offer-in" placeholder={dir === 'received' ? 'From whom — a person, or a being on Lichen' : 'To whom'} maxLength={120} value={who} onChange={(e) => setWho(e.target.value)} />
          {hits.map((h) => (
            <button key={h.id} className="vflow__hit" onClick={() => { setBeing(h); setHits([]); }}>{h.full_name} <em>· {h.kind}</em></button>
          ))}
        </div>
      )}
      <div className="vflow__pair">
        <input className="budg__offer-in vflow__amt" inputMode="decimal" placeholder="$ exchanged (if any)" value={ex} onChange={(e) => setEx(numericAmount(e.target.value))} />
        <input className="budg__offer-in vflow__amt" inputMode="decimal" placeholder="$ truly worth" value={tr} onChange={(e) => setTr(numericAmount(e.target.value))} />
      </div>
      <input className="budg__offer-in" placeholder="Why — optional" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {being && <p className="budg__empty vflow__fine">Naming {being.full_name} adds to the totals Lichen&rsquo;s stewards use to see where a being has given more than it&rsquo;s received, so donations can go toward restoring it.</p>}
      <div className="vflow__formacts">
        <button className="btn btn-primary vflow__save" onClick={() => void go()}>Record it</button>
        <button className="vflow__tvbtn" onClick={onCancel}>Cancel</button>
      </div>
      {err && <p className="budg__err">{err}</p>}
    </div>
  );
}
