import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  loadFeedShare, setFeedShareDetail, sendFeedShareChat, sendFeedShareEmail, feedShareSmsHref, markFeedShareSent,
  calendarFeedUrl, type FeedShare,
} from '../lib/calendarApi';
import { shareMessage, seesLine } from '../lib/calShare';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './CalShareCard.css';

/** SHARE MY CALENDAR, FROM THE CONVERSATION (founder 2026-11-15). The brain
 *  made the share row (a private link nobody has yet); THIS tap is what sends
 *  it — Lichen chat, a text from their own phone, or email. What the person
 *  will see is said plainly and switchable right here; the same row shows in
 *  Calendar settings → Your Lichen calendar, elsewhere. */
export default function CalShareCard({ shareId }: { shareId: string }) {
  const { user } = useAuth();
  const [first, setFirst] = useState('me');
  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('first_name,full_name').eq('id', user.id).maybeSingle().then(({ data }) => {
      const p = data as { first_name: string | null; full_name: string | null } | null;
      setFirst(p?.first_name || (p?.full_name ?? '').split(' ')[0] || 'me');
    });
  }, [user]);
  const [share, setShare] = useState<(FeedShare & { revoked_at: string | null }) | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void loadFeedShare(shareId).then(setShare); }, [shareId]);
  useEffect(() => {
    if (share) setText(shareMessage(first, share.detail, calendarFeedUrl(share.token)));
  }, [share?.detail, share?.token, first]); // eslint-disable-line react-hooks/exhaustive-deps

  if (share === undefined) return null;
  if (share === null || share.revoked_at) return <div className="cshare"><p className="cshare__fine">This share was stopped.</p></div>;

  const who = share.recipient_name;
  async function detail(d: 'details' | 'busy') {
    if (!share || d === share.detail) return;
    await setFeedShareDetail(share.id, d);
    setShare({ ...share, detail: d });
  }
  async function go(fn: () => Promise<void>, done: string) {
    setBusy(true); setErr(null);
    try { await fn(); setMsg(done); setShare(await loadFeedShare(shareId)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="cshare">
      <p className="cshare__head"><strong>Share your calendar with {who}</strong></p>
      <p className="cshare__sees">{who.split(' ')[0]} will see {seesLine(share.detail).replace(/\bI'm\b/g, "you're").replace(/\bmy\b/g, 'your')}.</p>
      <div className="cshare__seg" role="group" aria-label="What they see">
        <button type="button" className={share.detail === 'details' ? 'is-on' : ''} onClick={() => void detail('details')}>Everything</button>
        <button type="button" className={share.detail === 'busy' ? 'is-on' : ''} onClick={() => void detail('busy')}>Only busy times</button>
      </div>
      <details className="cshare__msg">
        <summary>The message</summary>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
      </details>
      {share.recipient_email && (
        <input className="cshare__note" placeholder="Add a note for the email (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="cshare__acts">
        {share.recipient_profile_id && (
          <button type="button" className="afeed__pubbtn" disabled={busy}
            onClick={() => void go(async () => { await sendFeedShareChat(share, text); }, `Sent to ${who.split(' ')[0]} in Lichen chat ✓`)}>Send in Lichen chat</button>
        )}
        {share.recipient_phone && (
          <a className="afeed__pubbtn" href={feedShareSmsHref(share.recipient_phone, text)}
            onClick={() => { void markFeedShareSent(share.id, 'text'); setMsg('Opened your Messages — tap send there ✓'); }}>Text {share.recipient_phone}</a>
        )}
        {share.recipient_email && (
          <button type="button" className="afeed__pubbtn" disabled={busy}
            onClick={() => void go(() => sendFeedShareEmail(share.id, note), `Emailed ${share.recipient_email} ✓`)}>Email {share.recipient_email}</button>
        )}
        <button type="button" className="cshare__copy"
          onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg('Copied — paste it anywhere ✓'); void markFeedShareSent(share.id, 'copy'); } catch { /* fine */ } }}>Copy</button>
      </div>
      {msg && <p className="cshare__ok">{msg}</p>}
      {err && <p className="cshare__err">{err}</p>}
      <p className="cshare__fine">
        {share.sent_at ? `Last sent ${new Date(share.sent_at).toLocaleDateString()}. ` : ''}
        {who.split(' ')[0]}'s link is their own — stop it any time in <Link className="link-cue" to="/calendar/settings#shared">Calendar settings</Link>.
      </p>
    </div>
  );
}
