import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { operatingRate, setOperatingRate } from '../lib/ledgerApi';
import './CurrentcyCard.css';

interface DonationRow {
  id: string;
  amount_cents: number;
  donor_email: string | null;
  designation: string;
  frequency: string;
  status: string;
  kind: string;
  central_cents: number | null;
  translated_at: string | null;
  created_at: string;
}
interface MemberLite { id: string; full_name: string | null }
interface FloatSummary { circulation: number; operating_cents: number }

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const cur = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0 });

/** Admin translation desk: received donations wait here; the admin resolves
 *  the donor's designation to a member and translates — 95% minted as
 *  Current, 5% recorded as operating dollars. Sponsorships (donor chose who
 *  benefits — not tax-deductible) wear a badge; general donations can be
 *  kept whole for operations instead. Hidden until the migrations run. */
export default function DonationsDesk() {
  const [rows, setRows] = useState<DonationRow[] | null>(null);
  const [float, setFloat] = useState<FloatSummary | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);   // donation id being resolved
  const [who, setWho] = useState('');
  const [hits, setHits] = useState<MemberLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // The operating-rate dial (founder 2026-10-01: 5–15%; changing it rewrites
  // the public /donate copy live). Null = money-in migration not applied yet.
  const [rate, setRate] = useState<number | null>(null);
  const [rateDraft, setRateDraft] = useState<number>(15);
  const [rateBusy, setRateBusy] = useState(false);
  // Dollars waiting per bucket + each row's frozen rate — both ride the
  // post-migration columns, so this read is guarded and the desk renders
  // without them until the migration lands.
  const [wells, setWells] = useState<Record<string, number> | null>(null);
  const [frozen, setFrozen] = useState<Map<string, number>>(new Map());

  const load = async () => {
    const { data, error } = await supabase.from('donations')
      .select('id, amount_cents, donor_email, designation, frequency, status, kind, central_cents, translated_at, created_at')
      .order('created_at', { ascending: false }).limit(30);
    if (error) { setRows(null); return; }   // table not live yet → stay hidden
    setRows((data as DonationRow[] | null) ?? []);
    const { data: fs } = await supabase.rpc('currentcy_float_summary');
    setFloat((fs as FloatSummary | null) ?? null);

    const r = await operatingRate();
    setRate(r);
    if (r !== null) {
      setRateDraft(r);
      const { data: fd, error: fe } = await supabase.from('donations')
        .select('id, fund, operating_rate_pct, amount_cents, status');
      if (!fe && fd) {
        const sums: Record<string, number> = {};
        const fr = new Map<string, number>();
        for (const d of fd as { id: string; fund: string | null; operating_rate_pct: number | null; amount_cents: number; status: string }[]) {
          if (d.operating_rate_pct !== null) fr.set(d.id, d.operating_rate_pct);
          if (d.status === 'received') {
            const k = d.fund ?? 'unspecified';
            sums[k] = (sums[k] ?? 0) + d.amount_cents;
          }
        }
        setWells(sums);
        setFrozen(fr);
      }
    }
  };
  useEffect(() => { void load(); }, []);

  const saveRate = async () => {
    setRateBusy(true); setNote('');
    try {
      await setOperatingRate(rateDraft);
      setRate(rateDraft);
      setNote(`Operating share set to ${rateDraft}% — the /donate page says so now.`);
    } catch (e) {
      setNote((e as { message?: string } | null)?.message || 'Could not set the rate.');
    }
    setRateBusy(false);
  };

  useEffect(() => {
    const n = who.trim();
    if (n.length < 2) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${n}%`).limit(5);
      setHits((data as MemberLite[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [who]);

  if (rows === null) return null;

  const translate = async (donationId: string, member: MemberLite) => {
    setBusy(true); setNote('');
    try {
      const { error } = await supabase.rpc('translate_donation', {
        p_donation: donationId, p_to_type: 'profile', p_to_id: member.id,
      });
      if (error) throw error;
      setNote(`Translated — Current granted to ${member.full_name ?? 'member'}.`);
      setPickFor(null); setWho(''); setHits([]);
      await load();
    } catch (e) {
      setNote((e as { message?: string } | null)?.message || 'Could not translate.');
    }
    setBusy(false);
  };

  const keepForOperations = async (donationId: string) => {
    setBusy(true); setNote('');
    try {
      const { error } = await supabase.rpc('keep_donation_for_operations', { p_donation: donationId });
      if (error) throw error;
      setNote('Kept as operating dollars — nothing minted.');
      await load();
    } catch (e) {
      setNote((e as { message?: string } | null)?.message || 'Could not resolve.');
    }
    setBusy(false);
  };

  const received = rows.filter((r) => r.status === 'received');
  const resolved = rows.filter((r) => r.status !== 'received').slice(0, 8);

  return (
    <div className="adminc__gift curc__mint">
      <h2 className="adminc__h2">Donations</h2>
      <p className="adminc__sub">
        Gifts received in dollars, waiting to become Current — {rate === null ? 95 : 100 - rate}% minted to
        the recipient the donor named, {rate === null ? 5 : rate}% kept as operating dollars.
      </p>

      {rate !== null && (
        <div className="curc__ratectl">
          <label>
            Operating share{' '}
            <select value={rateDraft} onChange={(e) => setRateDraft(Number(e.target.value))}>
              {Array.from({ length: 11 }, (_, i) => i + 5).map((p) => (
                <option key={p} value={p}>{p}%</option>
              ))}
            </select>
          </label>
          {rateDraft !== rate && (
            <button className="btn" disabled={rateBusy} onClick={saveRate}>
              {rateBusy ? 'Setting…' : `Set to ${rateDraft}%`}
            </button>
          )}
          <span className="curc__ratehint">
            Changes the /donate page&rsquo;s copy immediately; each gift keeps the
            rate its donor was shown.
          </span>
        </div>
      )}

      {wells && (
        <p className="curc__wells">
          Waiting in the wells:{' '}
          {(['concierge', 'community', 'operations', 'general', 'unspecified'] as const)
            .filter((k) => (wells[k] ?? 0) > 0)
            .map((k) => `${k} ${usd(wells[k])}`)
            .join(' · ') || 'nothing yet'}
        </p>
      )}

      {float && (
        <div className="curc__float">
          <p><strong>{cur(float.circulation)} Current in circulation</strong> — the Float
          account must hold at least ${cur(float.circulation)}.</p>
          <p>{usd(float.operating_cents)} collected as operating dollars — spendable.</p>
        </div>
      )}
      {note && <p className="curc__error">{note}</p>}

      {received.length === 0 && <p className="curc__empty">No donations waiting.</p>}
      {received.map((d) => (
        <div className="curc__donation" key={d.id}>
          <div className="curc__donation-head">
            <strong>{usd(d.amount_cents)}</strong>
            <span>{d.donor_email ?? 'anonymous'}{d.frequency !== 'one-time' ? ` · ${d.frequency}` : ''}</span>
            <em>{new Date(d.created_at).toLocaleDateString()}</em>
          </div>
          {d.kind === 'sponsorship' && (
            <p className="curc__donation-kind">Personal gift — donor chooses who benefits · not tax-deductible</p>
          )}
          {d.designation && <p className="curc__donation-say">&ldquo;{d.designation}&rdquo;</p>}
          {pickFor === d.id ? (
            <div className="curc__send">
              <input
                className="curc__input" placeholder="Grant to which member?"
                value={who} onChange={(e) => setWho(e.target.value)} autoFocus
              />
              {hits.map((h) => (
                <button className="curc__hit" key={h.id} disabled={busy} onClick={() => translate(d.id, h)}>
                  {h.full_name ?? 'Member'} — mint {usd(d.amount_cents - Math.round(d.amount_cents * (frozen.get(d.id) ?? rate ?? 5) / 100))} as Current
                </button>
              ))}
            </div>
          ) : (
            <div className="curc__donation-acts">
              <button className="btn btn-primary curc__go" onClick={() => { setPickFor(d.id); setWho(''); }}>
                Translate to Current
              </button>
              {d.kind !== 'sponsorship' && (
                <button className="btn curc__keep" disabled={busy} onClick={() => keepForOperations(d.id)}>
                  Keep for operations
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {resolved.length > 0 && (
        <>
          <p className="curc__hist-head">Resolved</p>
          {resolved.map((d) => (
            <p className="curc__hist" key={d.id}>
              {usd(d.amount_cents)} · {d.donor_email ?? 'anonymous'}
              {d.kind === 'sponsorship' && ' · personal gift'}
              {d.designation && ` · "${d.designation}"`}
              {d.status === 'operations'
                ? ' · kept for operations'
                : d.central_cents != null && ` · ${usd(d.central_cents)} to operations`}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
