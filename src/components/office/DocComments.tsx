import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { a1 } from '../../lib/formula';
import type { Anchor } from './collab';

/** COMMENTS (founder 2026-11-14) — Google's comment thread on Docs, Sheets
 *  and Slides. A comment pins to what you were looking at when you wrote it
 *  (selected text, the cell, the slide), replies thread under it, anyone who
 *  can open the doc may resolve or reopen, and the whole panel is live. */

export interface DocComment {
  id: string; doc_id: string; parent_id: string | null; author_id: string; body: string;
  anchor: Anchor | null; resolved_at: string | null; created_at: string;
  author: { full_name: string | null } | null;
}
const SEL = 'id, doc_id, parent_id, author_id, body, anchor, resolved_at, created_at, author:profiles!doc_comments_author_id_fkey(full_name)';

export function useDocComments(docId: string | null) {
  const [rows, setRows] = useState<DocComment[]>([]);
  useEffect(() => {
    if (!docId) return;
    let live = true;
    const load = async () => {
      const { data } = await supabase.from('doc_comments').select(SEL).eq('doc_id', docId).order('created_at');
      if (live) setRows((data as unknown as DocComment[]) ?? []);
    };
    void load();
    const ch = supabase.channel(`doc-comments:${docId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_comments', filter: `doc_id=eq.${docId}` }, () => void load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'doc_comments' }, () => void load())
      .subscribe();
    return () => { live = false; void supabase.removeChannel(ch); };
  }, [docId]);
  return [rows, setRows] as const;
}

export const anchorLabel = (a: Anchor | null | undefined): string => {
  if (!a) return 'The whole document';
  if (a.kind === 'cell') return `Cell ${a.tab}!${a1(a.r, a.c)}`;
  if (a.kind === 'slide') return `Slide ${a.index + 1}`;
  return `“${a.quote.length > 60 ? a.quote.slice(0, 59) + '…' : a.quote}”`;
};
const when = (iso: string) => {
  const d = new Date(iso), mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function DocComments({ docId, me, rows, setRows, anchor, onGoto, onClose, focusId }: {
  docId: string; me: string; rows: DocComment[]; setRows: (f: (r: DocComment[]) => DocComment[]) => void;
  anchor: Anchor | null; onGoto: (a: Anchor) => void; onClose: () => void; focusId?: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [pinned, setPinned] = useState<Anchor | null>(anchor);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The pin follows what you're looking at until you start writing.
  useEffect(() => { if (!draft) setPinned(anchor); }, [anchor, draft]);

  const roots = useMemo(() => rows.filter((r) => !r.parent_id), [rows]);
  const kids = (id: string) => rows.filter((r) => r.parent_id === id);
  const open = roots.filter((r) => !r.resolved_at);
  const done = roots.filter((r) => r.resolved_at);

  useEffect(() => {
    if (!focusId) return;
    const t = rows.find((r) => r.id === focusId);
    if (t?.resolved_at) setShowResolved(true);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-thread="${focusId}"]`)?.scrollIntoView({ block: 'nearest' }));
    if (t?.anchor) onGoto(t.anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, rows.length > 0]);

  const post = async (body: string, parent: DocComment | null) => {
    const text = body.trim(); if (!text) return;
    setBusy(true); setErr('');
    const { data, error } = await supabase.from('doc_comments')
      .insert({ doc_id: docId, parent_id: parent?.id ?? null, body: text.slice(0, 4000), anchor: parent ? null : pinned })
      .select(SEL).single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRows((cur) => (cur.some((r) => r.id === (data as unknown as DocComment).id) ? cur : [...cur, data as unknown as DocComment]));
    if (parent) setReply((r) => ({ ...r, [parent.id]: '' })); else setDraft('');
  };
  const resolve = async (c: DocComment, on: boolean) => {
    setRows((cur) => cur.map((r) => (r.id === c.id ? { ...r, resolved_at: on ? new Date().toISOString() : null } : r)));
    const { error } = await supabase.from('doc_comments').update({ resolved_at: on ? new Date().toISOString() : null }).eq('id', c.id);
    if (error) setErr(error.message);
  };
  const remove = async (c: DocComment) => {
    setRows((cur) => cur.filter((r) => r.id !== c.id && r.parent_id !== c.id));
    const { error } = await supabase.from('doc_comments').delete().eq('id', c.id);
    if (error) setErr(error.message);
  };

  // A function, not a component: a component defined here would remount on
  // every keystroke and steal the reply box's focus.
  const thread = (c: DocComment) => (
    <div key={c.id} className={'dcm__thread' + (c.resolved_at ? ' is-done' : '') + (focusId === c.id ? ' is-focus' : '')} data-thread={c.id}>
      <button className="dcm__anchor" onClick={() => c.anchor && onGoto(c.anchor)} disabled={!c.anchor}>{anchorLabel(c.anchor)}</button>
      {[c, ...kids(c.id)].map((m) => (
        <div key={m.id} className="dcm__msg">
          <div className="dcm__who"><b>{m.author?.full_name ?? 'A member'}</b> <span>{when(m.created_at)}</span></div>
          <p>{m.body}</p>
          {m.author_id === me && <button className="dcm__link is-danger" onClick={() => void remove(m)}>Delete</button>}
        </div>
      ))}
      {!c.resolved_at && (
        <div className="dcm__reply">
          <input placeholder="Reply…" value={reply[c.id] ?? ''} onChange={(e) => setReply((r) => ({ ...r, [c.id]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void post(reply[c.id] ?? '', c); } }} />
        </div>
      )}
      <div className="dcm__acts">
        <button className="dcm__link" onClick={() => void resolve(c, !c.resolved_at)}>{c.resolved_at ? 'Reopen' : 'Resolve ✓'}</button>
      </div>
    </div>
  );

  return (
    <aside className="dcm" aria-label="Comments">
      <div className="dcm__head"><b>Comments</b><button onClick={onClose} aria-label="Close comments">×</button></div>
      <div className="dcm__new">
        <span className="dcm__pin">On: {anchorLabel(pinned)}{pinned && <button onClick={() => setPinned(null)} aria-label="Comment on the whole document instead">×</button>}</span>
        <textarea placeholder="Add a comment…" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(draft, null); } }} />
        <button className="sheet__primary" disabled={busy || !draft.trim()} onClick={() => void post(draft, null)}>Comment</button>
        {err && <p className="dcm__err">{err}</p>}
      </div>
      <div className="dcm__list" ref={listRef}>
        {!open.length && <p className="dcm__empty">No open comments. Select text, a cell or a slide, then write one here.</p>}
        {open.map(thread)}
        {done.length > 0 && (
          <>
            <button className="dcm__link dcm__resolvedtoggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? 'Hide' : 'Show'} resolved ({done.length})</button>
            {showResolved && done.map(thread)}
          </>
        )}
      </div>
    </aside>
  );
}
