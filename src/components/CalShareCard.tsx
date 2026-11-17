import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import {
  loadFeedShare, setFeedShareDetail, sendFeedShareChat, sendFeedShareByBrain, sendFeedShareEmail, feedShareSmsHref, markFeedShareSent,
  calendarFeedUrl, brainCanEdit, loadShareErrand, type FeedShare, type ShareErrand,
} from '../lib/calendarApi';
import { shareMessage, seesShort, brainShareIntro, brainShareBody } from '../lib/calShare';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './CalShareCard.css';

/** SHARE MY CALENDAR, FROM THE CONVERSATION (founder 2026-11-15). The brain
 *  made the share row (a private link nobody has yet); THIS tap is what sends it.
 *
 *  ONE MESSAGE AT A TIME, AND THE RESULT WHERE YOU TAPPED (founder 2026-11-17:
 *  "its too clunky and wordy right now - but also I clicked 'let my brain send
 *  it' and nothing visually happened" — the receipt rendered at the card's foot,
 *  off screen, so she tapped again and Gabe got it twice). The card is: who +
 *  what they'll see, a Brain | Me switch, the ONE message that will go out
 *  (editable), and its send button — which becomes the SENT state in place,
 *  read back from the errand on every later visit (waiting / needs you / all set). */
type Sent = { by: 'brain' | 'chat' | 'text' | 'email' | 'copy'; at: string; chatId?: string };

export default function CalShareCard({ shareId }: { shareId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [first, setFirst] = useState('me');
  const [face, setFace] = useState<string | null>(null);
  const [themFirst, setThemFirst] = useState<string | null>(null);
  const [canEditBrain, setCanEditBrain] = useState(false);
  const [share, setShare] = useState<(FeedShare & { revoked_at: string | null }) | null | undefined>(undefined);
  const [errand, setErrand] = useState<ShareErrand | null>(null);
  const [by, setBy] = useState<'brain' | 'me'>('brain');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [again, setAgain] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('first_name,full_name,avatar_url').eq('id', user.id).maybeSingle().then(({ data }) => {
      const p = data as { first_name: string | null; full_name: string | null; avatar_url: string | null } | null;
      setFirst(p?.first_name || (p?.full_name ?? '').split(' ')[0] || 'me');
      setFace(p?.avatar_url ?? null);
    });
  }, [user]);
  useEffect(() => { void brainCanEdit().then(setCanEditBrain); }, []);
  useEffect(() => {
    void loadFeedShare(shareId).then((s) => {
      setShare(s);
      if (s && !s.recipient_profile_id) setBy('me');
    });
    void loadShareErrand(shareId).then(setErrand);
  }, [shareId]);
  useEffect(() => {
    if (!share?.recipient_profile_id) return;
    void supabase.from('profiles').select('first_name,full_name').eq('id', share.recipient_profile_id).maybeSingle().then(({ data }) => {
      const p = data as { first_name: string | null; full_name: string | null } | null;
      if (p) setThemFirst((p.first_name || (p.full_name ?? '').split(' ')[0] || '').trim() || null);
    });
  }, [share?.recipient_profile_id]);

  const url = share ? calendarFeedUrl(share.token) : '';
  const original = share ? (by === 'brain' ? brainShareBody(first, share.detail, url) : shareMessage(first, share.detail, url)) : '';
  // An untouched message follows the switches; an edited one is left alone
  // until the member switches who sends it (a different voice, a fresh start).
  useEffect(() => { if (!edited) setText(original); }, [original]); // eslint-disable-line react-hooks/exhaustive-deps

  // What was sent before, read back on any visit (the errand for the Brain,
  // the share's own channel stamp for the rest).
  useEffect(() => {
    if (sent || !share) return;
    const eAt = errand ? new Date(errand.created_at).getTime() : 0;
    const sAt = share.sent_at ? new Date(share.sent_at).getTime() : 0;
    if (errand && errand.status !== 'closed' && eAt >= sAt - 60_000) setSent({ by: 'brain', at: errand.created_at, chatId: errand.chat_id });
    else if (share.sent_at && share.channel) setSent({ by: share.channel, at: share.sent_at });
  }, [share, errand]); // eslint-disable-line react-hooks/exhaustive-deps

  if (share === undefined) return null;
  if (share === null || share.revoked_at) return <div className="cshare"><p className="cshare__fine">This share was stopped.</p></div>;

  const who = share.recipient_name;
  const whoFirst = themFirst || who.split(' ')[0];
  const member = !!share.recipient_profile_id;
  const brainOn = member && by === 'brain';

  async function detail(d: 'details' | 'busy') {
    if (!share || d === share.detail) return;
    await setFeedShareDetail(share.id, d);
    setShare({ ...share, detail: d });
  }
  function switchBy(next: 'brain' | 'me') {
    if (next === by) return;
    setBy(next); setEdited(false); setEditing(false);
  }
  async function run(fn: () => Promise<Sent>) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const s = await fn();
      setSent(s); setAgain(false); setEditing(false);
      if (s.by === 'brain') void loadShareErrand(shareId).then(setErrand);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const sendBrain = () => run(async () => {
    const r = await sendFeedShareByBrain(share.id, edited ? text : '');
    return { by: 'brain', at: new Date().toISOString(), chatId: r.chatId || undefined };
  });
  const sendChat = () => run(async () => {
    const chatId = await sendFeedShareChat(share, text);
    return { by: 'chat', at: new Date().toISOString(), chatId };
  });
  const sendEmail = () => run(async () => {
    await sendFeedShareEmail(share.id, note);
    return { by: 'email', at: new Date().toISOString() };
  });
  async function copy(t: string, label: string, mark: boolean) {
    try {
      await navigator.clipboard.writeText(t);
      setCopied(label); setErr(null);
      window.setTimeout(() => setCopied(null), 2500);
      if (mark) void markFeedShareSent(share!.id, 'copy');
    } catch { setErr('Couldn’t copy automatically — press and hold the text to copy it.'); }
  }

  const when = sent ? new Date(sent.at) : null;
  const whenWords = when
    ? (Date.now() - when.getTime() < 90_000 ? 'just now'
      : when.toDateString() === new Date().toDateString() ? `today at ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : when.toLocaleDateString([], { month: 'short', day: 'numeric' }))
    : '';
  const sentTitle = !sent ? '' : {
    brain: `Your Brain messaged ${whoFirst}`,
    chat: `Sent to ${whoFirst} in Lichen chat`,
    text: `Opened your Messages to text ${whoFirst}`,
    email: `Emailed ${share.recipient_email ?? whoFirst}`,
    copy: `You copied it to send yourself`,
  }[sent.by];
  const sentSub = !sent ? '' : sent.by !== 'brain' ? ''
    : errand?.status === 'done' ? `${whoFirst} has your calendar ✓`
    : errand?.status === 'flagged' ? `${whoFirst} needs you${errand.last_note ? ` — ${errand.last_note}` : ''}`
    : `It'll help ${whoFirst} set it up and bell you if they need you.`;
  const showSent = !!sent && !again;

  return (
    <div className="cshare">
      <div className="cshare__top">
        <p className="cshare__head"><strong>Share your calendar with {who}</strong></p>
        <div className="cshare__seg" role="group" aria-label="What they see">
          <button type="button" className={share.detail === 'details' ? 'is-on' : ''} onClick={() => void detail('details')}>Everything</button>
          <button type="button" className={share.detail === 'busy' ? 'is-on' : ''} onClick={() => void detail('busy')}>Only busy times</button>
        </div>
        <p className="cshare__fine">{whoFirst} will see {seesShort(share.detail).replace(/\bI'm\b/, "you're").replace(/^my\b/, 'your')}.</p>
      </div>

      {showSent ? (
        <div className={`cshare__sent${errand?.status === 'flagged' && sent!.by === 'brain' ? ' is-flag' : ''}`} role="status">
          <p className="cshare__sent-title"><span aria-hidden="true">✓</span> {sentTitle} <span className="cshare__sent-when">· {whenWords}</span></p>
          {sentSub && <p className="cshare__sent-sub">{sentSub}</p>}
          <div className="cshare__acts">
            {sent!.chatId && <button type="button" className="afeed__pubbtn" onClick={() => navigate(`/chat/${sent!.chatId}`)}>Open the chat ›</button>}
            <button type="button" className="cshare__copy" onClick={() => setAgain(true)}>Send it again</button>
          </div>
        </div>
      ) : (
        <>
          {member && (
            <div className="cshare__seg cshare__seg--by" role="group" aria-label="Who sends it">
              <button type="button" className={by === 'brain' ? 'is-on' : ''} onClick={() => switchBy('brain')}>Your Brain sends it</button>
              <button type="button" className={by === 'me' ? 'is-on' : ''} onClick={() => switchBy('me')}>You send it</button>
            </div>
          )}

          <div className={`cshare__msg${brainOn ? ' cshare__msg--brain' : ''}`}>
            {brainOn && user && <Avatar id={user.id} name={first} url={face} size={30} mark="brain" />}
            <div className="cshare__bubble">
              {brainOn && <p className="cshare__fixed">{brainShareIntro(whoFirst, first)}</p>}
              {editing
                ? <textarea aria-label="The message" value={text} rows={7} autoFocus
                    onChange={(e) => { setText(e.target.value); setEdited(true); }} />
                : <p className="cshare__body">{text}</p>}
            </div>
          </div>
          {brainOn && <p className="cshare__fine">It answers {whoFirst}'s setup questions and bells you if they need you.</p>}
          {by === 'me' && share.recipient_email && (
            <input className="cshare__note" placeholder="Add a note for the email (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          )}

          <div className="cshare__acts">
            {brainOn && (
              <button type="button" className="afeed__pubbtn" disabled={busy || !text.trim()} onClick={() => void sendBrain()}>
                {busy ? 'Sending…' : 'Let my Brain send it'}
              </button>
            )}
            {!brainOn && member && (
              <button type="button" className="afeed__pubbtn" disabled={busy || !text.trim()} onClick={() => void sendChat()}>
                {busy ? 'Sending…' : 'Send in chat'}
              </button>
            )}
            {!brainOn && share.recipient_phone && (
              <a className="afeed__pubbtn" href={feedShareSmsHref(share.recipient_phone, text)}
                onClick={() => { void markFeedShareSent(share.id, 'text'); setSent({ by: 'text', at: new Date().toISOString() }); setAgain(false); }}>Text {share.recipient_phone}</a>
            )}
            {!brainOn && share.recipient_email && (
              <button type="button" className="afeed__pubbtn" disabled={busy} onClick={() => void sendEmail()}>{busy ? 'Sending…' : 'Email it'}</button>
            )}
            {(!brainOn || canEditBrain) && (
              <button type="button" className="cshare__copy" onClick={() => setEditing((v) => !v)}>{editing ? 'Done editing' : 'Edit'}</button>
            )}
            {edited && (
              <button type="button" className="cshare__copy" onClick={() => { setEdited(false); setEditing(false); setText(original); }}>Use the original</button>
            )}
            {!brainOn && (
              <button type="button" className="cshare__copy" onClick={() => void copy(text, 'Message copied ✓', true)}>Copy message</button>
            )}
            <button type="button" className="cshare__copy" onClick={() => void copy(url, 'Link copied ✓', false)}>Copy link</button>
            {again && <button type="button" className="cshare__copy" onClick={() => setAgain(false)}>Never mind</button>}
          </div>
          {by === 'me' && share.recipient_email && edited && (
            <p className="cshare__fine">The email uses Lichen's own wording plus your note — your edits ride chat, text and copy.</p>
          )}
        </>
      )}

      {copied && <p className="cshare__ok" role="status">{copied}</p>}
      {err && <p className="cshare__err">{err}</p>}
      <p className="cshare__fine">
        {whoFirst}'s link is their own — stop it any time in <Link className="link-cue" to="/calendar/settings#shared">Calendar settings</Link>.
      </p>
    </div>
  );
}
