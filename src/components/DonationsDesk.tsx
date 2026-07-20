import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import './CurrentcyCard.css';

interface DonationRow {
  id: string;
  amount_cents: number;
  donor_email: string | null;
  designation: string;
  frequency: string;
  status: string;
  central_cents: number | null;
  translated_at: string | null;
  created_at: string;
}
interface MemberLite { id: string; full_name: string | null }

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** Admin translation desk: received donations wait here; the admin resolves
 *  the donor's designation to a member and translates — 95% minted as
 *  Current, 5% recorded as operating dollars. Hidden until the donations
 *  migration runs. */
export default function DonationsDesk() {
  const [rows, setRows] = useState<DonationRow[] | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);   // donation id being resolved
  const [who, setWho] = useState('');
  const [hits, setHits] = useState<MemberLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('donations')
      .select('id, amount_cents, donor_email, designation, frequency, status, central_cents, translated_at, created_at')
      .order('created_at', { ascending: false }).limit(30);
    if (error) { setRows(null); return; }   // table not live yet → stay hidden
    setRows((data as DonationRow[] | null) ?? []);
  };
  useEffect(() => { void load(); }, []);

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

  const received = rows.filter((r) => r.status === 'received');
  const translated = rows.filter((r) => r.status === 'translated').slice(0, 8);

  return (
    <div className="adminc__gift curc__mint">
      <h2 className="adminc__h2">Donations</h2>
      <p className="adminc__sub">
        Gifts received in dollars, waiting to become Current — 95% minted to
        the recipient the donor named, 5% kept as operating dollars.
      </p>
      {note && <p className="curc__error">{note}</p>}

      {received.length === 0 && <p className="curc__empty">No donations waiting.</p>}
      {received.map((d) => (
        <div className="curc__donation" key={d.id}>
          <div className="curc__donation-head">
            <strong>{usd(d.amount_cents)}</strong>
            <span>{d.donor_email ?? 'anonymous'}{d.frequency !== 'one-time' ? ` · ${d.frequency}` : ''}</span>
            <em>{new Date(d.created_at).toLocaleDateString()}</em>
          </div>
          {d.designation && <p className="curc__donation-say">&ldquo;{d.designation}&rdquo;</p>}
          {pickFor === d.id ? (
            <div className="curc__send">
              <input
                className="curc__input" placeholder="Grant to which member?"
                value={who} onChange={(e) => setWho(e.target.value)} autoFocus
              />
              {hits.map((h) => (
                <button className="curc__hit" key={h.id} disabled={busy} onClick={() => translate(d.id, h)}>
                  {h.full_name ?? 'Member'} — mint {usd(Math.round(d.amount_cents * 0.95))} as Current
                </button>
              ))}
            </div>
          ) : (
            <button className="btn btn-primary curc__go" onClick={() => { setPickFor(d.id); setWho(''); }}>
              Translate to Current
            </button>
          )}
        </div>
      ))}

      {translated.length > 0 && (
        <>
          <p className="curc__hist-head">Translated</p>
          {translated.map((d) => (
            <p className="curc__hist" key={d.id}>
              {usd(d.amount_cents)} · {d.donor_email ?? 'anonymous'}
              {d.designation && ` · "${d.designation}"`}
              {d.central_cents != null && ` · ${usd(d.central_cents)} to operations`}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
