import { useEffect, useState, type ReactNode } from 'react';
import { knockStatusWord, knockTone, loadKnockReplies, type KnockReplyRow } from '../lib/knockThreadApi';
import './KnockCard.css';

/** EACH KNOCK IS A THREAD (founder 2026-11-10: "each knock be a thread and
 *  expandable. when i just let someone in, they're green. when i'm in process
 *  with them, they stay peach. when they are rejected or spam, that red we
 *  use"). One shell for every door desk — /invite and a space's backstage.
 *  Shut: name, email, status in its colour. Open: what they wrote, every
 *  reply sent back (dated, by whom), then the desk's own actions. */
export type KnockCardData = {
  id: string; name: string; email: string; story: string | null; status: string;
  created_at?: string; replied_at?: string | null; reply_count?: number | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function KnockCard({ knock, children, defaultOpen = false, flag, sub, sentNonce = 0, highlight = false }: {
  knock: KnockCardData;
  /** The desk's actions — shown inside the open card, only while the knock waits. */
  children?: ReactNode;
  defaultOpen?: boolean;
  flag?: ReactNode;
  sub?: ReactNode;
  /** Bump after a reply sends so the thread re-reads. */
  sentNonce?: number;
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [replies, setReplies] = useState<KnockReplyRow[] | null>(null);
  const tone = knockTone(knock.status);

  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadKnockReplies(knock.id).then((r) => { if (live) setReplies(r); });
    return () => { live = false; };
  }, [open, knock.id, sentNonce]);

  return (
    <li className={`kcard kcard--${tone}${open ? ' is-open' : ''}${highlight ? ' is-called' : ''}`}>
      <button type="button" className="kcard__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="kcard__who">
          <span className="kcard__name"><strong>{knock.name}</strong> <span className="kcard__email">· {knock.email}</span></span>
          <span className="kcard__status">{knockStatusWord(knock.status, knock.replied_at)}</span>
        </span>
        <span className="kcard__fold" aria-hidden="true" />
      </button>
      {open && (
        <div className="kcard__body">
          {(flag || sub) && <div className="kcard__meta">{flag}{sub}</div>}
          <ol className="kcard__thread">
            <li className="kcard__msg kcard__msg--them">
              <span className="kcard__msg-by">{knock.name.split(/\s+/)[0] || 'They'} wrote{knock.created_at ? ` · ${when(knock.created_at)}` : ''}</span>
              <span className="kcard__msg-text">{knock.story?.trim() || 'No note — just asked to join.'}</span>
            </li>
            {(replies ?? []).map((r) => (
              <li className="kcard__msg kcard__msg--you" key={r.id}>
                <span className="kcard__msg-by">{r.sender?.full_name ?? 'You'} replied · {when(r.sent_at)}</span>
                <span className="kcard__msg-text">{r.body}</span>
              </li>
            ))}
            {replies && replies.length === 0 && knock.status === 'new' && (
              <li className="kcard__none">No reply sent yet.</li>
            )}
          </ol>
          {knock.status === 'new' && children && <div className="kcard__acts">{children}</div>}
        </div>
      )}
    </li>
  );
}
