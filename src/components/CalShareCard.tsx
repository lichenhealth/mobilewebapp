import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import {
  loadFeedShare, setFeedShareDetail, sendFeedShareChat, sendFeedShareByBrain, sendFeedShareEmail, feedShareSmsHref, markFeedShareSent,
  calendarFeedUrl, brainCanEdit, type FeedShare,
} from '../lib/calendarApi';
import { shareMessage, seesLine, brainShareIntro, brainShareBody } from '../lib/calShare';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './CalShareCard.css';

/** SHARE MY CALENDAR, FROM THE CONVERSATION (founder 2026-11-15). The brain
 *  made the share row (a private link nobody has yet); THIS tap is what sends
 *  it — Lichen chat, a text from their own phone, or email. What the person
 *  will see is said plainly and switchable right here; the same row shows in
 *  Calendar settings → Your Lichen calendar, elsewhere.
 *
 *  SEE IT BEFORE IT GOES (founder 2026-11-15, same day: "show me what the brain
 *  is going to send to him, with the option to just send it; or, edit it? as
 *  well as the ability to copy the link myself. maybe have a pre-composed
 *  message for me, too, which I can also edit… kinda like the invitations to
 *  lichen"): both messages are SHOWN, each with Send + Edit — the Brain's
 *  (its "this is «First»'s Brain" opening is fixed, never editable: every
 *  Brain message says what it is) and one in the member's own voice — plus
 *  the bare link with its own Copy. */
export default function CalShareCard({ shareId }: { shareId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [first, setFirst] = useState('me');
  const [face, setFace] = useState<string | null>(null);
  const [themFirst, setThemFirst] = useState<string | null>(null);
  const [brainChat, setBrainChat] = useState<string | null>(null);
  const [canEditBrain, setCanEditBrain] = useState(false);
  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('first_name,full_name,avatar_url').eq('id', user.id).maybeSingle().then(({ data }) => {
      const p = data as { first_name: string | null; full_name: string | null; avatar_url: string | null } | null;
      setFirst(p?.first_name || (p?.full_name ?? '').split(' ')[0] || 'me');
      setFace(p?.avatar_url ?? null);
    });
  }, [user]);
  useEffect(() => { void brainCanEdit().then(setCanEditBrain); }, []);
  const [share, setShare] = useState<(FeedShare & { revoked_at: string | null }) | null | undefined>(undefined);
  // Each message tracks whether the member has touched it: an untouched one
  // follows the Everything / Only-busy switch, an edited one is left alone.
  const [selfText, setSelfText] = useState('');
  const [selfEdited, setSelfEdited] = useState(false);
  const [selfEditing, setSelfEditing] = useState(false);
  const [brainText, setBrainText] = useState('');
  const [brainEdited, setBrainEdited] = useState(false);
  const [brainEditing, setBrainEditing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void loadFeedShare(shareId).then(setShare); }, [shareId]);
  // The Brain greets them by THEIR first name, read the way the server reads it.
  useEffect(() => {
    if (!share?.recipient_profile_id) return;
    void supabase.from('profiles').select('first_name,full_name').eq('id', share.recipient_profile_id).maybeSingle().then(({ data }) => {
      const p = data as { first_name: string | null; full_name: string | null } | null;
      if (p) setThemFirst((p.first_name || (p.full_name ?? '').split(' ')[0] || '').trim() || null);
    });
  }, [share?.recipient_profile_id]);
  const url = share ? calendarFeedUrl(share.token) : '';
  useEffect(() => {
    if (!share) return;
    if (!selfEdited) setSelfText(shareMessage(first, share.detail, url));
    if (!brainEdited) setBrainText(brainShareBody(first, share.detail, url));
  }, [share?.detail, share?.token, first]); // eslint-disable-line react-hooks/exhaustive-deps

  if (share === undefined) return null;
  if (share === null || share.revoked_at) return <div className="cshare"><p className="cshare__fine">This share was stopped.</p></div>;

  const who = share.recipient_name;
  const whoFirst = who.split(' ')[0];
  async function detail(d: 'details' | 'busy') {
    if (!share || d === share.detail) return;
    await setFeedShareDetail(share.id, d);
    setShare({ ...share, detail: d });
  }
  async function go(fn: () => Promise<string | void>, done: string) {
    setBusy(true); setErr(null);
    try { const extra = await fn(); setMsg(extra || done); setShare(await loadFeedShare(shareId)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function copy(text: string, done: string, channel: boolean) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(done); setErr(null);
      if (channel && share) void markFeedShareSent(share.id, 'copy');
    } catch { setErr('Couldn’t copy automatically — press and hold the text to copy it.'); }
  }
  const brainSays = brainShareIntro(themFirst || whoFirst, first);

  return (
    <div className="cshare">
      <p className="cshare__head"><strong>Share your calendar with {who}</strong></p>
      <p className="cshare__sees">{whoFirst} will see {seesLine(share.detail).replace(/\bI'm\b/g, "you're").replace(/\bmy\b/g, 'your')}.</p>
      <div className="cshare__seg" role="group" aria-label="What they see">
        <button type="button" className={share.detail === 'details' ? 'is-on' : ''} onClick={() => void detail('details')}>Everything</button>
        <button type="button" className={share.detail === 'busy' ? 'is-on' : ''} onClick={() => void detail('busy')}>Only busy times</button>
      </div>

      {share.recipient_profile_id && user && (
        <section className="cshare__opt cshare__opt--brain">
          <div className="cshare__opt-head">
            <Avatar id={user.id} name={first} url={face} size={36} mark="brain" />
            <div className="cshare__opt-words">
              <strong>Let your Brain send it</strong>
              <span>It messages {whoFirst} in Lichen chat as <em>{first}'s Brain — AI on your behalf</em>, helps them get it set up, and lets you know if they need you.</span>
            </div>
          </div>
          <div className="cshare__bubble cshare__bubble--brain">
            <p className="cshare__fixed">{brainSays}</p>
            {brainEditing
              ? <textarea aria-label="Your Brain's message" value={brainText} rows={10} autoFocus
                  onChange={(e) => { setBrainText(e.target.value); setBrainEdited(true); }} />
              : <p className="cshare__body">{brainText}</p>}
          </div>
          {brainEditing && <p className="cshare__fine">The first line stays — your Brain always says who it is.</p>}
          <div className="cshare__acts">
            <button type="button" className="afeed__pubbtn" disabled={busy || !brainText.trim()}
              onClick={() => void go(async () => {
                const r = await sendFeedShareByBrain(share.id, brainEdited ? brainText : '');
                setBrainChat(r.chatId || null); setBrainEditing(false);
                if (brainEdited && !r.custom) return `Your Brain messaged ${whoFirst} — but with its standard message; your edits didn't go through`;
              }, `Your Brain messaged ${whoFirst} ✓ — it'll help them and bell you if they need you`)}>Let my Brain send it</button>
            {canEditBrain && (
              <button type="button" className="cshare__copy" onClick={() => setBrainEditing((v) => !v)}>
                {brainEditing ? 'Done editing' : 'Edit'}
              </button>
            )}
            {brainEdited && (
              <button type="button" className="cshare__copy"
                onClick={() => { setBrainEdited(false); setBrainEditing(false); setBrainText(brainShareBody(first, share.detail, url)); }}>Use the original</button>
            )}
            {brainChat && <button type="button" className="cshare__copy" onClick={() => navigate(`/chat/${brainChat}`)}>Open the chat ›</button>}
          </div>
        </section>
      )}

      <section className="cshare__opt">
        <div className="cshare__opt-words">
          <strong>{share.recipient_profile_id ? 'Or send it yourself' : 'Send it yourself'}</strong>
          <span>In your own words — written for you, yours to change.</span>
        </div>
        <div className="cshare__bubble">
          {selfEditing
            ? <textarea aria-label="Your message" value={selfText} rows={10} autoFocus
                onChange={(e) => { setSelfText(e.target.value); setSelfEdited(true); }} />
            : <p className="cshare__body">{selfText}</p>}
        </div>
        {share.recipient_email && (
          <input className="cshare__note" placeholder="Add a note for the email (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        )}
        <div className="cshare__acts">
          {share.recipient_profile_id && (
            <button type="button" className="afeed__pubbtn" disabled={busy || !selfText.trim()}
              onClick={() => void go(async () => { await sendFeedShareChat(share, selfText); setSelfEditing(false); }, `Sent to ${whoFirst} in Lichen chat ✓`)}>Send in chat</button>
          )}
          {share.recipient_phone && (
            <a className="afeed__pubbtn" href={feedShareSmsHref(share.recipient_phone, selfText)}
              onClick={() => { void markFeedShareSent(share.id, 'text'); setMsg('Opened your Messages — tap send there ✓'); }}>Text {share.recipient_phone}</a>
          )}
          {share.recipient_email && (
            <button type="button" className="afeed__pubbtn" disabled={busy}
              onClick={() => void go(() => sendFeedShareEmail(share.id, note), `Emailed ${share.recipient_email} ✓`)}>Email {share.recipient_email}</button>
          )}
          <button type="button" className="cshare__copy" onClick={() => setSelfEditing((v) => !v)}>{selfEditing ? 'Done editing' : 'Edit'}</button>
          <button type="button" className="cshare__copy" onClick={() => void copy(selfText, 'Message copied — paste it anywhere ✓', true)}>Copy message</button>
          {selfEdited && (
            <button type="button" className="cshare__copy"
              onClick={() => { setSelfEdited(false); setSelfEditing(false); setSelfText(shareMessage(first, share.detail, url)); }}>Use the original</button>
          )}
        </div>
        {share.recipient_email && selfEdited && (
          <p className="cshare__fine">The email uses Lichen's own wording plus your note above — your edits ride chat, text and copy.</p>
        )}
      </section>

      <div className="cshare__link">
        <span className="cshare__link-label">Just the link</span>
        <code className="cshare__link-url" title={url}>{url}</code>
        <button type="button" className="cshare__copy" onClick={() => void copy(url, 'Link copied ✓', true)}>Copy link</button>
      </div>

      {msg && <p className="cshare__ok">{msg}</p>}
      {err && <p className="cshare__err">{err}</p>}
      <p className="cshare__fine">
        {share.sent_at ? `Last sent ${new Date(share.sent_at).toLocaleDateString()}. ` : ''}
        {whoFirst}'s link is their own — stop it any time in <Link className="link-cue" to="/calendar/settings#shared">Calendar settings</Link>.
      </p>
    </div>
  );
}
