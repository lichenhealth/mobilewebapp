import { supabase } from './supabase';

/** Practice payments + superbills (founder 2026-11-12). A provider imports
 *  their processor's activity export (Ivy Pay), keys each client id to a
 *  person once, and generates superbills. Owner-only by RLS; diagnosis
 *  codes are never stored — typed at generation time. */

export type PracticeInfo = {
  name?: string; credentials?: string; licenses?: string; npi?: string; ein?: string;
  pos?: string; address?: string; phone?: string; website?: string;
};
export type PracticeClient = {
  id: string; source: string; external_id: string; label: string | null;
  cpt: string | null; service: string | null; rate_cents: number | null; notes: string | null;
};
export type PracticePayment = {
  id: string; ref_no: string; external_client_id: string; charged_on: string | null;
  session_on: string; session_time: string | null; amount_cents: number; fee_cents: number;
  net_cents: number; transfer_on: string | null; cpt: string | null; service: string | null;
};
export type ParsedImport = {
  payments: Omit<PracticePayment, 'id' | 'cpt' | 'service'>[];
  transfers: { ref: string; sent_at: string; sent_on: string | null; amount_cents: number }[];
};

const cents = (v: unknown) => Math.round((typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))) * 100);
/** "11/06/2026" → "2026-11-06" */
function isoDate(v: unknown): string | null {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Reads an Ivy Pay activity workbook (.xls/.xlsx). Throws plain words when
 *  the file isn't one. The parser loads only when a file arrives. */
export async function parseIvyWorkbook(file: File): Promise<ParsedImport> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const tx = wb.Sheets['Transactions'] ?? wb.Sheets[wb.SheetNames[0]];
  if (!tx) throw new Error('That file has no sheets.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(tx, { header: 1, raw: true, defval: '' });
  const head = (rows[0] ?? []).map(norm);
  const col = (needle: string) => head.findIndex((h) => h.includes(needle));
  const c = {
    charged: col('charged date'), ref: col('payment ref'), id: col('ivy pay id'),
    sdate: col('session date'), stime: col('session time'), amt: col('ivy pay charge'),
    fee: head.findIndex((h) => h === 'fee'), net: head.findIndex((h) => h === 'net'), transfer: col('transfer'),
  };
  if (c.ref < 0 || c.id < 0 || c.sdate < 0 || c.amt < 0) {
    throw new Error('This doesn’t look like an Ivy Pay activity spreadsheet — it needs the Payment Ref, Ivy Pay ID, Session Date and Charge columns.');
  }
  const payments: ParsedImport['payments'] = [];
  for (const r of rows.slice(1)) {
    const ref = String(r[c.ref] ?? '').trim();
    const session_on = isoDate(r[c.sdate]);
    if (!ref.startsWith('#') || !session_on) continue; // subtotal / blank rows
    const ext = String(r[c.id] ?? '').trim().replace(/\.0$/, '');
    payments.push({
      ref_no: ref, external_client_id: ext, charged_on: c.charged >= 0 ? isoDate(r[c.charged]) : null,
      session_on, session_time: c.stime >= 0 ? String(r[c.stime] ?? '').trim() || null : null,
      amount_cents: cents(r[c.amt]), fee_cents: c.fee >= 0 ? cents(r[c.fee] || 0) : 0,
      net_cents: c.net >= 0 ? cents(r[c.net] || 0) : cents(r[c.amt]),
      transfer_on: c.transfer >= 0 ? isoDate(r[c.transfer]) : null,
    });
  }
  const transfers: ParsedImport['transfers'] = [];
  const ts = wb.Sheets['Transfers'];
  if (ts) {
    const trows = XLSX.utils.sheet_to_json<unknown[]>(ts, { header: 1, raw: true, defval: '' });
    const th = (trows[0] ?? []).map(norm);
    const sent = th.findIndex((h) => h.includes('sent')), amt = th.findIndex((h) => h.includes('amount')), prn = th.findIndex((h) => h === 'prn');
    if (sent >= 0 && amt >= 0 && prn >= 0) {
      for (const r of trows.slice(1)) {
        const ref = String(r[prn] ?? '').trim();
        if (!ref) continue;
        transfers.push({ ref, sent_at: String(r[sent] ?? '').trim(), sent_on: isoDate(r[sent]), amount_cents: cents(r[amt]) });
      }
    }
  }
  if (!payments.length) throw new Error('No payments found in that spreadsheet.');
  return { payments, transfers };
}

/** Adds what's new; rows already imported (same payment ref) are left alone. */
export async function importPracticePayments(me: string, parsed: ParsedImport): Promise<{ added: number; seen: number; newClients: number }> {
  const { data: have } = await supabase.from('practice_payments').select('ref_no').eq('owner_id', me).eq('source', 'ivy');
  const known = new Set((have ?? []).map((r: { ref_no: string }) => r.ref_no));
  const fresh = parsed.payments.filter((p) => !known.has(p.ref_no));
  if (fresh.length) {
    const { error } = await supabase.from('practice_payments')
      .upsert(fresh.map((p) => ({ ...p, owner_id: me, source: 'ivy' })), { onConflict: 'owner_id,source,ref_no', ignoreDuplicates: true });
    if (error) throw new Error('The payments didn’t save — try again in a moment.');
  }
  if (parsed.transfers.length) {
    await supabase.from('practice_transfers')
      .upsert(parsed.transfers.map((t) => ({ ...t, owner_id: me, source: 'ivy' })), { onConflict: 'owner_id,source,ref', ignoreDuplicates: true });
  }
  const { data: clients } = await supabase.from('practice_clients').select('external_id').eq('owner_id', me).eq('source', 'ivy');
  const haveC = new Set((clients ?? []).map((r: { external_id: string }) => r.external_id));
  const newIds = [...new Set(parsed.payments.map((p) => p.external_client_id))].filter((x) => x && !haveC.has(x));
  if (newIds.length) {
    await supabase.from('practice_clients')
      .upsert(newIds.map((x) => ({ owner_id: me, source: 'ivy', external_id: x })), { onConflict: 'owner_id,source,external_id', ignoreDuplicates: true });
  }
  return { added: fresh.length, seen: parsed.payments.length - fresh.length, newClients: newIds.length };
}

export async function loadPractice(me: string) {
  const [s, c, p] = await Promise.all([
    supabase.from('practice_settings').select('info').eq('owner_id', me).maybeSingle(),
    supabase.from('practice_clients').select('id, source, external_id, label, cpt, service, rate_cents, notes').eq('owner_id', me).order('created_at'),
    supabase.from('practice_payments').select('id, ref_no, external_client_id, charged_on, session_on, session_time, amount_cents, fee_cents, net_cents, transfer_on, cpt, service').eq('owner_id', me).order('session_on', { ascending: false }).limit(5000),
  ]);
  return {
    info: ((s.data as { info?: PracticeInfo } | null)?.info ?? {}) as PracticeInfo,
    clients: (c.data ?? []) as PracticeClient[],
    payments: (p.data ?? []) as PracticePayment[],
  };
}

export async function savePracticeInfo(me: string, info: PracticeInfo) {
  const { error } = await supabase.from('practice_settings').upsert({ owner_id: me, info, updated_at: new Date().toISOString() });
  if (error) throw new Error('Your practice details didn’t save.');
}

export async function savePracticeClient(id: string, patch: Partial<Pick<PracticeClient, 'label' | 'cpt' | 'service' | 'rate_cents' | 'notes'>>) {
  const { error } = await supabase.from('practice_clients').update(patch).eq('id', id);
  if (error) throw new Error('That client didn’t save.');
}

/** Session defaults: the client's own CPT/service, or 30-minute half sessions. */
export function lineFor(p: PracticePayment, c: PracticeClient | undefined): { cpt: string; service: string } {
  if (p.cpt || p.service) return { cpt: p.cpt ?? c?.cpt ?? '', service: p.service ?? c?.service ?? '' };
  const half = c?.rate_cents && p.amount_cents * 2 === c.rate_cents;
  if (half) return { cpt: '90832', service: '1:1 talk therapy session (30 min)' };
  return { cpt: c?.cpt ?? '90837', service: c?.service ?? '1:1 talk therapy session (60 min)' };
}

export const money = (c: number) => '$' + (c / 100).toFixed(2);

export function paymentsCsv(rows: PracticePayment[], clients: Map<string, PracticeClient>): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [['Session date', 'Client', 'Ivy Pay ID', 'Payment ref', 'Charged', 'Amount', 'Fee', 'Net', 'Deposited', 'CPT', 'Service'].join(',')];
  for (const p of rows) {
    const c = clients.get(p.external_client_id);
    const l = lineFor(p, c);
    out.push([p.session_on, c?.label ?? '', p.external_client_id, p.ref_no, p.charged_on ?? '', (p.amount_cents / 100).toFixed(2),
      (p.fee_cents / 100).toFixed(2), (p.net_cents / 100).toFixed(2), p.transfer_on ?? '', l.cpt, l.service].map(esc).join(','));
  }
  return out.join('\n');
}
