import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import CollapsibleSection from '../components/CollapsibleSection';
import { useAuth } from '../auth/AuthProvider';
import {
  importPracticePayments, lineFor, loadPractice, money, parseIvyWorkbook, paymentsCsv,
  savePracticeClient, savePracticeInfo, type PracticeClient, type PracticeInfo, type PracticePayment,
} from '../lib/practiceApi';
import RevenueStreams from '../components/RevenueStreams';
import './Practice.css';

/** /practice — a provider's own payments ledger + superbills (founder
 *  2026-11-12). Owner-only; diagnosis codes are typed per superbill and
 *  never stored. */
export default function Practice() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const [info, setInfo] = useState<PracticeInfo>({});
  const [clients, setClients] = useState<PracticeClient[]>([]);
  const [payments, setPayments] = useState<PracticePayment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set([typeof window !== 'undefined' && window.location.hash === '#streams' ? 'streams' : 'import']));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    if (!me) return;
    const d = await loadPractice(me);
    setInfo(d.info); setClients(d.clients); setPayments(d.payments); setLoaded(true);
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me]);

  const byId = useMemo(() => new Map(clients.map((c) => [c.external_id, c])), [clients]);
  const years = useMemo(() => [...new Set(payments.map((p) => p.session_on.slice(0, 4)))].sort().reverse(), [payments]);
  const yearRows = useMemo(() => payments.filter((p) => p.session_on.startsWith(year)), [payments, year]);
  const months = useMemo(() => {
    const m = new Map<string, { n: number; gross: number; fee: number; net: number }>();
    for (const p of yearRows) {
      const k = p.session_on.slice(0, 7);
      const v = m.get(k) ?? { n: 0, gross: 0, fee: 0, net: 0 };
      v.n++; v.gross += p.amount_cents; v.fee += p.fee_cents; v.net += p.net_cents; m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [yearRows]);
  const tot = months.reduce((a, [, v]) => ({ n: a.n + v.n, gross: a.gross + v.gross, fee: a.fee + v.fee, net: a.net + v.net }), { n: 0, gross: 0, fee: 0, net: 0 });

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onFile = async (f: File | undefined) => {
    if (!f || !me) return;
    setBusy(true); setMsg(null);
    try {
      const parsed = await parseIvyWorkbook(f);
      const r = await importPracticePayments(me, parsed);
      await reload();
      setMsg(`Imported ✓ — ${r.added} new payment${r.added === 1 ? '' : 's'}${r.seen ? `, ${r.seen} already here` : ''}${r.newClients ? `, ${r.newClients} new client${r.newClients === 1 ? '' : 's'} to name below` : ''}.`);
      if (r.newClients) setOpen((s) => new Set([...s, 'clients']));
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadCsv = () => {
    const blob = new Blob([paymentsCsv(yearRows, byId)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `practice-payments-${year}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="prac">
      <PageHead onBack={() => navigate('/profile#offer')} />
      <header className="myc__head">
        <h1 className="myc__title">Practice payments</h1>
        <p className="myc__sub">Your processor’s payments, your clients, superbills, and who pays for what — private to you.</p>
      </header>

      <CollapsibleSection id="import" title="Import payments" meta="Ivy Pay activity spreadsheet" open={open.has('import')} onToggle={() => toggle('import')}>
        <p className="prac__hint">Drop in the weekly “Your Ivy Pay activity” spreadsheet (.xls). Each one carries the whole year, and importing again only adds what’s new.</p>
        <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv" className="prac__file" disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])} />
        {busy && <p className="prac__hint">Reading…</p>}
        {msg && <p className="prac__msg">{msg}</p>}
      </CollapsibleSection>

      <CollapsibleSection id="clients" title="Clients" meta={loaded ? `${clients.filter((c) => !c.label).length} to name · ${clients.length} total` : undefined} open={open.has('clients')} onToggle={() => toggle('clients')}>
        <p className="prac__hint">Each Ivy Pay ID is one client. Name them once — superbills use the name, session type, CPT code and rate you set here.</p>
        {clients.length === 0 && <p className="prac__hint">Import a spreadsheet and your clients appear here.</p>}
        {[...clients].sort((a, b) => Number(!!a.label) - Number(!!b.label) || (a.label ?? '').localeCompare(b.label ?? '')).map((c) => (
          <ClientRow key={c.id} c={c} payments={payments.filter((p) => p.external_client_id === c.external_id)}
            onSaved={(patch) => setClients((all) => all.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection id="superbill" title="Superbills" open={open.has('superbill')} onToggle={() => toggle('superbill')}>
        <SuperbillMaker info={info} clients={clients} payments={payments} />
      </CollapsibleSection>

      <CollapsibleSection id="totals" title="Totals for taxes" meta={loaded && years.length ? `${year}: ${money(tot.gross)} collected` : undefined} open={open.has('totals')} onToggle={() => toggle('totals')}>
        {years.length > 0 && (
          <div className="prac__row">
            <select className="prac__input prac__input--sm" value={year} onChange={(e) => setYear(e.target.value)}>
              {(years.includes(year) ? years : [year, ...years]).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn" onClick={downloadCsv} disabled={!yearRows.length}>Export CSV</button>
          </div>
        )}
        {yearRows.length === 0 ? <p className="prac__hint">No payments for {year} yet.</p> : (
          <table className="prac__table">
            <thead><tr><th>Month</th><th>Sessions</th><th>Collected</th><th>Fees</th><th>Net</th></tr></thead>
            <tbody>
              {months.map(([k, v]) => (
                <tr key={k}><td>{new Date(k + '-15').toLocaleString(undefined, { month: 'short' })}</td><td>{v.n}</td><td>{money(v.gross)}</td><td>{money(v.fee)}</td><td>{money(v.net)}</td></tr>
              ))}
              <tr className="prac__total"><td>{year}</td><td>{tot.n}</td><td>{money(tot.gross)}</td><td>{money(tot.fee)}</td><td>{money(tot.net)}</td></tr>
            </tbody>
          </table>
        )}
        <p className="prac__hint">Totals follow the session date. Ask your tax person how they want income and processing fees reported.</p>
      </CollapsibleSection>

      <CollapsibleSection id="streams" title="Your services & who pays" meta="revenue streams · the gap subsidies can fill" open={open.has('streams')} onToggle={() => toggle('streams')}>
        <RevenueStreams me={me} />
      </CollapsibleSection>

      <CollapsibleSection id="details" title="Your practice details" meta="shown on every superbill" open={open.has('details')} onToggle={() => toggle('details')}>
        <PracticeDetails me={me} info={info} onSaved={setInfo} />
      </CollapsibleSection>
    </div>
  );
}

function ClientRow({ c, payments, onSaved }: { c: PracticeClient; payments: PracticePayment[]; onSaved: (p: Partial<PracticeClient>) => void }) {
  const [label, setLabel] = useState(c.label ?? '');
  const [rate, setRate] = useState(c.rate_cents != null ? String(c.rate_cents / 100) : '');
  const [cpt, setCpt] = useState(c.cpt ?? '');
  const [service, setService] = useState(c.service ?? '');
  const [state, setState] = useState('');
  const last = payments[0]?.session_on;
  const commonRate = useMemo(() => {
    const n = new Map<number, number>();
    payments.forEach((p) => n.set(p.amount_cents, (n.get(p.amount_cents) ?? 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [payments]);
  const save = async () => {
    const patch = {
      label: label.trim() || null, cpt: cpt.trim() || null, service: service.trim() || null,
      rate_cents: rate.trim() ? Math.round(parseFloat(rate) * 100) : null,
    };
    try { await savePracticeClient(c.id, patch); onSaved(patch); setState('Saved ✓'); } catch (e) { setState((e as Error).message); }
  };
  return (
    <div className={'prac__client' + (c.label ? '' : ' is-new')}>
      <div className="prac__client-meta">
        <span className="prac__id">Ivy ID {c.external_id}</span>
        <span>{payments.length} session{payments.length === 1 ? '' : 's'}{last ? ` · last ${last}` : ''}{commonRate ? ` · usually ${money(commonRate)}` : ''}</span>
      </div>
      <div className="prac__grid">
        <input className="prac__input" placeholder="Client name (as on the superbill)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="prac__input prac__input--sm" placeholder="Rate $" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} />
        <input className="prac__input prac__input--sm" placeholder="CPT (90837)" value={cpt} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setCpt(e.target.value)} />
        <input className="prac__input" placeholder="Service (1:1 talk therapy session, 60 min)" value={service} onChange={(e) => setService(e.target.value)} />
      </div>
      <div className="prac__row"><button className="btn" onClick={() => void save()}>Save</button>{state && <span className="prac__hint">{state}</span>}</div>
    </div>
  );
}

function SuperbillMaker({ info, clients, payments }: { info: PracticeInfo; clients: PracticeClient[]; payments: PracticePayment[] }) {
  const named = clients.filter((c) => c.label);
  const [clientId, setClientId] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [dx, setDx] = useState('');
  const client = named.find((c) => c.id === clientId);
  const lines = client ? payments.filter((p) => p.external_client_id === client.external_id && p.session_on >= from && p.session_on <= to)
    .sort((a, b) => a.session_on.localeCompare(b.session_on)) : [];
  const open = () => {
    if (!client) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(superbillHtml(info, client, lines, dx.trim()));
    w.document.close();
    setTimeout(() => w.print(), 400);
  };
  if (!named.length) return <p className="prac__hint">Name at least one client above, then make superbills here.</p>;
  return (
    <div className="prac__sb">
      <select className="prac__input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Choose a client…</option>
        {named.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <div className="prac__row">
        <label className="prac__lbl">From <input type="date" className="prac__input prac__input--sm" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="prac__lbl">To <input type="date" className="prac__input prac__input--sm" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <input className="prac__input" placeholder="Diagnosis code (ICD-10) — used for this superbill only, never saved" value={dx}
        autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={(e) => setDx(e.target.value)} />
      {client && (
        <p className="prac__hint">{lines.length ? `${lines.length} session${lines.length === 1 ? '' : 's'} · ${money(lines.reduce((a, p) => a + p.amount_cents, 0))}` : 'No sessions in those dates.'}</p>
      )}
      <button className="btn btn-primary" disabled={!client || !lines.length} onClick={open}>Open superbill — print or save as PDF</button>
      {!info.npi && <p className="prac__hint">Add your NPI and licenses under “Your practice details” so they appear on the superbill.</p>}
    </div>
  );
}

function PracticeDetails({ me, info, onSaved }: { me: string; info: PracticeInfo; onSaved: (i: PracticeInfo) => void }) {
  const [f, setF] = useState<PracticeInfo>(info);
  const [state, setState] = useState('');
  useEffect(() => setF(info), [info]);
  const set = (k: keyof PracticeInfo) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await savePracticeInfo(me, f); onSaved(f); setState('Saved ✓'); } catch (e) { setState((e as Error).message); }
  };
  return (
    <div className="prac__sb">
      <input className="prac__input" placeholder="Name on superbills (Galyn Burke)" value={f.name ?? ''} onChange={set('name')} />
      <input className="prac__input" placeholder="Credentials (LMFT, LMHC)" value={f.credentials ?? ''} onChange={set('credentials')} />
      <textarea className="prac__input" rows={3} placeholder={'Licenses, one per line\nCA LMFT #…'} value={f.licenses ?? ''} onChange={set('licenses')} />
      <div className="prac__grid2">
        <input className="prac__input" placeholder="NPI" value={f.npi ?? ''} autoCorrect="off" spellCheck={false} onChange={set('npi')} />
        <input className="prac__input" placeholder="EIN" value={f.ein ?? ''} autoCorrect="off" spellCheck={false} onChange={set('ein')} />
      </div>
      <input className="prac__input" placeholder="Place of service (02 — Telehealth)" value={f.pos ?? ''} onChange={set('pos')} />
      <input className="prac__input" placeholder="Website (www.galynburke.com)" value={f.website ?? ''} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={set('website')} />
      <input className="prac__input" placeholder="Phone (optional)" value={f.phone ?? ''} onChange={set('phone')} />
      <input className="prac__input" placeholder="Address (optional)" value={f.address ?? ''} onChange={set('address')} />
      <div className="prac__row"><button className="btn btn-primary" onClick={() => void save()}>Save details</button>{state && <span className="prac__hint">{state}</span>}</div>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const usDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y.slice(2)}`; };

function superbillHtml(info: PracticeInfo, c: PracticeClient, lines: PracticePayment[], dx: string): string {
  const who = [info.name, info.credentials].filter(Boolean).join(', ');
  const lic = (info.licenses ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const total = lines.reduce((a, p) => a + p.amount_cents, 0);
  const rows = lines.map((p) => {
    const l = lineFor(p, c);
    return `<tr><td>${usDate(p.session_on)}</td><td>${esc(l.service)}</td><td>${esc(dx)}</td><td>${esc(l.cpt)}</td><td class="r">${money(p.amount_cents)}</td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Superbill — ${esc(c.label ?? '')}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;color:#222;max-width:760px;margin:32px auto;padding:0 24px}
h1{font-size:22px;margin:0}.site{color:#666;margin:2px 0 18px}h2{font-size:15px;letter-spacing:.08em;margin:22px 0 6px}
.cols{display:flex;gap:40px;margin:14px 0}.cols div{flex:1}.lab{font-size:11px;letter-spacing:.08em;color:#777;text-transform:uppercase;margin-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px}th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}th{font-size:11px;letter-spacing:.06em;color:#666;text-transform:uppercase}
.r{text-align:right}.tot td{font-weight:bold;border-top:2px solid #222}p.note{color:#555;font-size:13px}
@media print{body{margin:12px auto}}
</style></head><body>
<h1>${esc(who || 'Provider')}</h1>${info.website ? `<p class="site">${esc(info.website)}</p>` : ''}
<h2>ITEMIZED RECEIPT</h2>
<p class="note">Attached is the notice of payment for the services rendered by the therapist and collected by ${esc(who || 'the provider')}.</p>
<div class="cols">
<div><div class="lab">Services provided to (client)</div>${esc(c.label ?? '')}</div>
<div><div class="lab">Rendered by (provider)</div>${esc(info.name ?? '')}<br>${lic.map(esc).join('<br>')}
${info.ein ? `<br>Provider EIN # ${esc(info.ein)}` : ''}${info.npi ? `<br>Provider NPI #${esc(info.npi)}` : ''}
${info.pos ? `<br>Place of Service: ${esc(info.pos)}` : ''}${info.phone ? `<br>${esc(info.phone)}` : ''}${info.address ? `<br>${esc(info.address)}` : ''}</div>
</div>
<table><thead><tr><th>Date</th><th>Description</th><th>ICD-10 code</th><th>CPT code</th><th class="r">Amount</th></tr></thead>
<tbody>${rows}<tr class="tot"><td colspan="4">Total</td><td class="r">${money(total)}</td></tr>
<tr><td colspan="4">Paid by client</td><td class="r">${money(total)}</td></tr></tbody></table>
</body></html>`;
}
