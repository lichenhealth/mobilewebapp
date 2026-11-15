import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listFeedShares, createFeedShare, setFeedShareDetail, revokeFeedShare, type FeedShare } from '../lib/calendarApi';
import { seesLine } from '../lib/calShare';
import CalShareCard from './CalShareCard';
import './CalShareCard.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPhone = (s: string) => !/[a-z]/i.test(s) && s.replace(/\D/g, '').length >= 7;

/** WHO SEES MY LICHEN CALENDAR ELSEWHERE (founder 2026-11-15: what the brain
 *  shares is "reflected in the settings section if I go in manually"). The
 *  same calendar_feed_shares rows the brain's share_calendar writes; each
 *  person's link is their own, so stopping one leaves the rest. */
export default function CalendarShares() {
  const [rows, setRows] = useState<FeedShare[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string | null }[]>([]);
  const [stopArm, setStopArm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => void listFeedShares().then(setRows);
  useEffect(load, []);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || EMAIL_RE.test(t) || isPhone(t)) { setHits([]); return; }
    const h = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id,full_name').eq('findable', true).eq('kind', 'person').ilike('full_name', `%${t}%`).limit(6);
      setHits((data as { id: string; full_name: string | null }[] | null) ?? []);
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  async function add(s: Parameters<typeof createFeedShare>[0]) {
    setErr(null);
    try { const row = await createFeedShare(s); setQ(''); setHits([]); load(); setOpen(row.id); }
    catch (e) { setErr((e as Error).message); }
  }
  const t = q.trim();

  return (
    <div className="cedit__field" id="shared">
      <span className="cedit__label">Who you share your calendar with</span>
      <p className="cedit__hint">
        Each person gets their own link to see your Lichen calendar in Google, Apple or Outlook — you choose
        whether they see everything or only when you're busy, and you can stop any one of them alone.
        Events you marked "Nothing" never show; to-dos and your care plan never ride along. You can also just
        ask the brain: "share my calendar with Gabe."
      </p>
      {rows.map((r) => (
        <div key={r.id} className="cset__bkcard" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong>{r.recipient_name}</strong>
          <span className="cedit__hint" style={{ margin: 0 }}>
            Sees {seesLine(r.detail).replace(/\bI'm\b/g, "you're").replace(/\bmy\b/g, 'your')}.
            {' '}{r.sent_at ? `Sent ${r.channel === 'chat' ? 'in Lichen chat' : r.channel === 'text' ? 'by text' : r.channel === 'email' ? 'by email' : ''} ${new Date(r.sent_at).toLocaleDateString()}.` : 'Not sent yet.'}
          </span>
          <div className="cshare__seg">
            <button type="button" className={r.detail === 'details' ? 'is-on' : ''} onClick={() => void setFeedShareDetail(r.id, 'details').then(load)}>Everything</button>
            <button type="button" className={r.detail === 'busy' ? 'is-on' : ''} onClick={() => void setFeedShareDetail(r.id, 'busy').then(load)}>Only busy times</button>
          </div>
          <div className="cshare__acts">
            <button type="button" className="cedit__add cedit__add--sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Close' : r.sent_at ? 'Send again' : 'Send it'}</button>
            <button type="button" className="cedit__add cedit__add--sm"
              onClick={() => {
                if (stopArm !== r.id) { setStopArm(r.id); setTimeout(() => setStopArm(null), 4000); return; }
                void revokeFeedShare(r.id).then(load);
              }}>{stopArm === r.id ? 'Their link stops working — sure?' : 'Stop sharing'}</button>
          </div>
          {open === r.id && <CalShareCard shareId={r.id} key={r.id + r.detail} />}
        </div>
      ))}
      <div className="cset__add cset__add--wrap">
        <input className="cedit__input cset__grow" placeholder="Share with — a name, email or cell" value={q}
          onChange={(e) => setQ(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {(EMAIL_RE.test(t) || isPhone(t)) && (
          <button type="button" className="cedit__add cedit__add--sm"
            onClick={() => void add(EMAIL_RE.test(t) ? { name: t, email: t } : { name: t, phone: t })}>Share</button>
        )}
      </div>
      {hits.map((h) => (
        <button key={h.id} type="button" className="cedit__add cedit__add--sm" style={{ alignSelf: 'flex-start' }}
          onClick={() => void add({ recipientProfileId: h.id, name: h.full_name ?? 'Member' })}>
          Share with {h.full_name} — on Lichen
        </button>
      ))}
      {err && <p className="cshare__err">{err}</p>}
    </div>
  );
}
