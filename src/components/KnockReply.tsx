import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { myBookingLink, replyToKnock } from '../lib/knockReplyApi';
import './KnockReply.css';

/** REPLY WITHOUT LETTING THEM IN (founder 2026-11-10: "reply to them with a
 *  custom message and some time to chat with me via my booking link, but not
 *  accept them into lichen… that interim step feels like it might be
 *  necessary as things begin to pick up with word of mouth"). One shared
 *  control for every door desk — /invite and each space's backstage. The
 *  knock stays at the door; the row just remembers it was answered. */
export type ReplyableKnock = {
  id: string; name: string; email: string;
  replied_at?: string | null; reply_count?: number | null; last_reply?: string | null;
};

const dateWord = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function KnockReply({ knock, onSent }: { knock: ReplyableKnock; onSent?: (repliedAt: string) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [bookLink, setBookLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [repliedAt, setRepliedAt] = useState<string | null>(knock.replied_at ?? null);
  const [count, setCount] = useState<number>(knock.reply_count ?? 0);
  // A plain receipt right where Send was pressed (founder 2026-11-10: "I don't
  // see confirmation"); the words themselves live in the knock's thread.
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    let live = true;
    void myBookingLink(user.id).then((l) => { if (live) setBookLink(l); });
    return () => { live = false; };
  }, [open, user]);

  const first = knock.name.trim().split(/\s+/)[0] || 'them';
  const hasLink = !!bookLink && text.includes(bookLink);

  function addLink() {
    if (!bookLink || hasLink) return;
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n\nHere's my calendar if you'd like to find a time to talk: ${bookLink}` : `Here's my calendar if you'd like to find a time to talk: ${bookLink}`));
  }

  async function send() {
    if (busy || text.trim().length < 2) return;
    setBusy(true); setErr(null);
    try {
      const r = await replyToKnock(knock.id, text.trim());
      setRepliedAt(r.replied_at); setCount((c) => c + 1); setJustSent(true); onSent?.(r.replied_at);
      setOpen(false); setText('');
    } catch (e) { setErr((e as Error).message || 'That didn’t send.'); }
    finally { setBusy(false); }
  }

  if (!open) {
    return (
      <span className="kreply">
        <button type="button" className="btn invite__use kreply__open" onClick={() => setOpen(true)} disabled={count >= 3}>
          {repliedAt ? 'Reply again' : 'Reply'}
        </button>
        {justSent && repliedAt && (
          <span className="kreply__done">Sent to {first} ✓ {dateWord(repliedAt)} — it's in the thread, and a copy is in your inbox</span>
        )}
      </span>
    );
  }

  return (
    <div className="kreply kreply--open">
      <p className="kreply__hint">
        Write to {first} without inviting them in — the email goes to {knock.email}, their reply comes
        straight to your inbox (a copy of yours lands there too), and their knock stays here until you decide.
      </p>
      <textarea
        className="invite__input invite__textarea kreply__box"
        rows={6}
        autoFocus
        maxLength={4000}
        value={text}
        placeholder={`Thank you for reaching out, ${first}…`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="kreply__acts">
        {bookLink && (
          <button type="button" className="kreply__chip" onClick={addLink} disabled={hasLink}>
            {hasLink ? 'Booking link added ✓' : '+ Add my booking link'}
          </button>
        )}
        <span className="kreply__spacer" />
        <button type="button" className="invite__dismiss" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
        <button type="button" className="btn btn-primary invite__use" onClick={() => void send()} disabled={busy || text.trim().length < 2}>
          {busy ? 'Sending…' : 'Send reply'}
        </button>
      </div>
      {err && <p className="kreply__err">{err}</p>}
    </div>
  );
}
