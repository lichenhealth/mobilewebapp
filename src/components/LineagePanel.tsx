// A WISDOM LINEAGE's own corner of its page (founder 2026-11-20: "there needs
// to be reparations or value attribution to the original wisdom holders").
// Says plainly who holds its value (Lichen, in trust — or a recognized
// holder), lists offerings rooted in it, lets a nominated holder accept, and
// lets any member nominate a holder. Lichen never decides who speaks for a
// people: a platform steward reviews, and the holder must say yes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  answerStewardship, loadRootedOfferings, myHolderInvite, nominateHolder, searchPeople,
  type LineageNomination,
} from '../lib/lineageApi';
import './LineagePanel.css';

export default function LineagePanel({ lineageId, name, me }: { lineageId: string; name: string; me: string }) {
  const [holder, setHolder] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [offerings, setOfferings] = useState<{ id: string; title: string | null; body: string | null }[]>([]);
  const [invite, setInvite] = useState<LineageNomination | null>(null);
  const [inviteDone, setInviteDone] = useState('');
  const [nomOpen, setNomOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string }[]>([]);
  const [pick, setPick] = useState<{ id: string; full_name: string } | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      // A self-referencing FK can't be embedded (CLAUDE.md) — two reads.
      const { data } = await supabase.from('profiles').select('steward_profile_id').eq('id', lineageId).maybeSingle();
      const hid = (data as { steward_profile_id: string | null } | null)?.steward_profile_id ?? null;
      let hname = 'a holder';
      if (hid) {
        const { data: h } = await supabase.from('profiles').select('full_name').eq('id', hid).maybeSingle();
        hname = (h as { full_name: string | null } | null)?.full_name ?? hname;
      }
      if (live) setHolder(hid ? { id: hid, name: hname } : null);
      const offs = await loadRootedOfferings(lineageId);
      if (live) setOfferings(offs);
      const inv = await myHolderInvite(lineageId, me);
      if (live) setInvite(inv);
    })();
    return () => { live = false; };
  }, [lineageId, me]);

  useEffect(() => {
    if (pick) return;
    const t = setTimeout(() => { void searchPeople(q).then(setHits); }, 250);
    return () => clearTimeout(t);
  }, [q, pick]);

  async function answer(accept: boolean) {
    if (!invite) return;
    setErr('');
    try {
      await answerStewardship(invite.id, accept);
      setInvite(null);
      setInviteDone(accept ? `You now steward ${name} on behalf of the lineage.` : 'Thank you — it stays held in trust by Lichen.');
      if (accept) setHolder({ id: me, name: 'you' });
    } catch (e) { setErr((e as Error).message); }
  }

  async function sendNomination() {
    if (!pick) return;
    setErr('');
    try {
      await nominateHolder(lineageId, pick.id, note);
      setSent(true);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="lineage">
      <p className="lineage__trust">
        {holder === undefined ? '…'
          : holder ? (<>Value attributed to {name} is stewarded by{' '}
              <Link className="link-cue" to={`/members/${holder.id}`}>{holder.name}</Link>, a recognized holder of the lineage.</>)
          : (<>Value attributed to {name} is held in trust by Lichen until the lineage&rsquo;s own recognized holders step in.
              Lichen doesn&rsquo;t decide who speaks for a people.</>)}
      </p>

      {invite && (
        <div className="lineage__invite">
          <p>You&rsquo;ve been recognized as a holder of {name}. Accept to steward its value on behalf of the lineage.</p>
          <div className="lineage__acts">
            <button className="btn btn-primary" onClick={() => void answer(true)}>Accept</button>
            <button className="btn btn-ghost" onClick={() => void answer(false)}>Not me</button>
          </div>
        </div>
      )}
      {inviteDone && <p className="lineage__done">{inviteDone}</p>}

      {offerings.length > 0 && (
        <div className="lineage__offers">
          <h3 className="lineage__h">Offerings rooted in {name}</h3>
          <ul>
            {offerings.map((o) => (
              <li key={o.id}>
                <Link className="link-cue" to={`/posts/${o.id}`}>{o.title || (o.body ?? '').slice(0, 80) || 'An offering'}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {me && !holder && !invite && (
        sent ? (
          <p className="lineage__done">Nominated ✓ — a Lichen steward will review it and ask {pick?.full_name ?? 'them'} to accept.</p>
        ) : !nomOpen ? (
          <button className="lineage__nom-door" onClick={() => setNomOpen(true)}>Nominate a holder of this lineage ›</button>
        ) : (
          <div className="lineage__nom">
            <p className="lineage__hint">Someone carrying this lineage, recognized by its own community. A Lichen steward reviews every nomination, and the person must accept.</p>
            {pick ? (
              <p className="lineage__pick">{pick.full_name} <button className="lineage__x" onClick={() => { setPick(null); setQ(''); }}>change</button></p>
            ) : (<>
              <input className="lineage__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Their name on Lichen" />
              {hits.map((h) => (
                <button key={h.id} className="lineage__hit" onClick={() => { setPick(h); setHits([]); }}>{h.full_name}</button>
              ))}
            </>)}
            <textarea className="lineage__input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="How are they connected to this lineage? (optional)" />
            <div className="lineage__acts">
              <button className="btn btn-primary" disabled={!pick} onClick={() => void sendNomination()}>Nominate</button>
              <button className="btn btn-ghost" onClick={() => setNomOpen(false)}>Cancel</button>
            </div>
          </div>
        )
      )}
      {err && <p className="lineage__err">{err}</p>}
    </section>
  );
}
