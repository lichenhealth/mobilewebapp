import { trashDoc } from '../lib/trashApi';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { PollBody, DocAiMark } from '../components/ChatDocCard';
import {
  loadChatDoc, saveChatDoc, setChatDocAi, deleteChatDoc,
  DOC_KIND_LABEL, DOC_KIND_ICON, type ChatDocRow, type Slide,
} from '../lib/chatDocsApi';
import { aiDoorOn } from '../components/AssistantDoor';
import { PageHead } from '../components/PageHead';
import './ChatDocs.css';

interface RoomInfo { title: string; spaceName: string | null; spaceId: string | null }

/** One item of a room's drive (founder 2026-10-21): a doc edits as one big
 *  page, a spreadsheet as a grid, a poll shows itself live. Collaborative in
 *  the plainest sense — any room member may edit, last save wins, and the
 *  foot says who touched it last. */
export default function ChatDocPage() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [doc, setDoc] = useState<ChatDocRow | null | 'gone'>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cells, setCells] = useState<string[][]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!docId || !me) return;
    let active = true;
    (async () => {
      const d = await loadChatDoc(docId);
      if (!active) return;
      if (!d) { setDoc('gone'); return; }
      setDoc(d);
      setTitle(d.title);
      setBody(d.body ?? '');
      setCells((d.data?.cells ?? [['', '', ''], ['', '', ''], ['', '', '']]).map((r) => [...r]));
      setSlides((d.data?.slides ?? [{ title: '', body: '' }]).map((s) => ({ ...s })));
      // A PERSONAL doc (founder 2026-10-21, Drive's +) has no room — it
      // lives in your Drive alone, and nothing else loads.
      if (!d.chat_id) { setRoom(null); return; }
      const [{ data: c }, { data: m }] = await Promise.all([
        supabase.from('chats')
          .select('topic, title, room_space:spaces!chats_space_id_fkey(id, name)')
          .eq('id', d.chat_id).maybeSingle(),
        supabase.from('chat_members').select('profile_id, profiles(full_name)').eq('chat_id', d.chat_id),
      ]);
      if (!active) return;
      const cr = c as unknown as { topic: string | null; title: string | null; room_space: { id: string; name: string } | null } | null;
      setRoom({
        title: cr?.room_space ? `${cr.room_space.name}${cr.topic ? ` · ${cr.topic}` : ''}` : (cr?.title ?? 'the room'),
        spaceName: cr?.room_space?.name ?? null,
        spaceId: cr?.room_space?.id ?? null,
      });
      const nm: Record<string, string> = {};
      for (const r of (m as { profile_id: string; profiles: { full_name: string | null } | null }[] | null) ?? []) {
        nm[r.profile_id] = r.profiles?.full_name ?? 'Member';
      }
      setNames(nm);
    })();
    return () => { active = false; };
  }, [docId, me]);

  useEffect(() => {
    if (presenting == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(null);
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setPresenting((i) => (i == null ? i : Math.min(i + 1, slides.length - 1)));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPresenting((i) => (i == null ? i : Math.max(i - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  if (!me) return null;
  if (doc === 'gone') {
    return (
      <div className="cdocp">
        <p className="cdocp__missing">That item doesn&rsquo;t exist, or you&rsquo;re not in its room.</p>
      </div>
    );
  }
  if (!doc) return <div className="cdocp"><p className="cdocp__missing">Loading…</p></div>;

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await saveChatDoc(doc.id, {
        title: title.trim() || doc.title,
        ...(doc.kind === 'doc' ? { body } : {}),
        ...(doc.kind === 'sheet' ? { data: { ...(doc.data ?? {}), cells } } : {}),
        ...(doc.kind === 'slides' ? { data: { ...(doc.data ?? {}), slides } } : {}),
      });
      setDirty(false); setMsg('Saved ✓');
      const nextData = doc.kind === 'sheet' ? { ...(doc.data ?? {}), cells } : doc.kind === 'slides' ? { ...(doc.data ?? {}), slides } : doc.data;
      setDoc({ ...doc, title: title.trim() || doc.title, body, data: nextData, updated_by: me, updated_at: new Date().toISOString() });
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
    setBusy(false);
  };

  const flipAi = async (on: boolean) => {
    setMsg('');
    try {
      await setChatDocAi(doc.id, on);
      setDoc({ ...doc, ai_enabled: on });
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
  };

  const editedBy = doc.updated_by ? (names[doc.updated_by] ?? 'a member') : null;
  const when = new Date(doc.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className="cdocp">
      <PageHead onBack={() => navigate(doc.chat_id ? `/chat/${doc.chat_id}` : '/drive')} />
      <div className="cdocp__head">
        <span className="cdocp__kind"><Icon name={DOC_KIND_ICON[doc.kind]} size={14} /> {DOC_KIND_LABEL[doc.kind]}</span>
        {doc.chat_id && !doc.ai_enabled && <DocAiMark />}
        {doc.chat_id ? (
          <button className="cdocp__drivelink" onClick={() => navigate(`/chat/${doc.chat_id}/drive`)}>
            In {room?.title ?? 'the room'}&rsquo;s drive ›
          </button>
        ) : (
          <span className="cdocp__drivelink" style={{ textDecoration: 'none', cursor: 'default' }}>
            Private — only you
          </span>
        )}
      </div>
      {doc.kind === 'poll' ? (
        <>
          <h2 className="cdocp__title-ro">{doc.title}</h2>
          <PollBody doc={doc} me={me} names={names} />
        </>
      ) : (
        <>
          <input
            className="cdocp__title" value={title} maxLength={120}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            aria-label="Title"
          />
          {doc.kind === 'doc' && (
            <textarea
              className="cdocp__body" value={body}
              placeholder={doc.chat_id ? "Write here — everyone in the room can read and edit this." : "Write here — this lives in your Drive, yours alone."}
              onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            />
          )}
          {doc.kind === 'sheet' && (
            <div className="cdocp__sheetwrap">
              <table className="cdocp__sheet">
                <tbody>
                  {cells.map((rowArr, r) => (
                    <tr key={r}>
                      {rowArr.map((cell, cIdx) => (
                        <td key={cIdx}>
                          <input
                            value={cell}
                            onChange={(e) => {
                              const v = e.target.value;
                              setCells((cur) => cur.map((rr, ri) => (ri === r ? rr.map((cc, ci) => (ci === cIdx ? v : cc)) : rr)));
                              setDirty(true);
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cdocp__sheet-grow">
                <button onClick={() => { setCells((cur) => [...cur, cur[0].map(() => '')]); setDirty(true); }}>+ Row</button>
                <button onClick={() => { setCells((cur) => cur.map((r) => [...r, ''])); setDirty(true); }}>+ Column</button>
              </div>
            </div>
          )}
          {doc.kind === 'slides' && (
            <div className="cdocp__slides">
              <button className="btn" onClick={() => setPresenting(0)}><Icon name="slides" size={14} /> Present</button>
              {slides.map((s, i) => (
                <div className="cdocp__slide" key={i}>
                  <div className="cdocp__slide-top">
                    <span className="cdocp__slide-n">{i + 1}</span>
                    <button disabled={i === 0} aria-label="Move up" onClick={() => { setSlides((cur) => { const n = [...cur]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }); setDirty(true); }}>↑</button>
                    <button disabled={i === slides.length - 1} aria-label="Move down" onClick={() => { setSlides((cur) => { const n = [...cur]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; }); setDirty(true); }}>↓</button>
                    {slides.length > 1 && <button aria-label="Remove slide" onClick={() => { setSlides((cur) => cur.filter((_, j) => j !== i)); setDirty(true); }}>×</button>}
                  </div>
                  <input className="cdocp__slide-title" placeholder="Slide title" value={s.title}
                    onChange={(e) => { const v = e.target.value; setSlides((cur) => cur.map((x, j) => (j === i ? { ...x, title: v } : x))); setDirty(true); }} />
                  <textarea className="cdocp__slide-body" placeholder="One point per line" value={s.body}
                    onChange={(e) => { const v = e.target.value; setSlides((cur) => cur.map((x, j) => (j === i ? { ...x, body: v } : x))); setDirty(true); }} />
                </div>
              ))}
              <div className="cdocp__sheet-grow">
                <button onClick={() => { setSlides((cur) => [...cur, { title: '', body: '' }]); setDirty(true); }}>+ Slide</button>
              </div>
            </div>
          )}
          {presenting != null && slides[presenting] && (
            <div className="cdocp__present" role="dialog" aria-label="Presentation"
              onClick={() => setPresenting((i) => (i == null ? i : Math.min(i + 1, slides.length - 1)))}>
              <button className="cdocp__present-x" aria-label="Stop presenting" onClick={(e) => { e.stopPropagation(); setPresenting(null); }}><Icon name="close" size={18} /></button>
              <div className="cdocp__present-card">
                <h1>{slides[presenting].title || title}</h1>
                {slides[presenting].body.trim() && (
                  <ul>{slides[presenting].body.split('\n').filter((l) => l.trim()).map((l, k) => <li key={k}>{l.replace(/^[-•*]\s*/, '')}</li>)}</ul>
                )}
              </div>
              <div className="cdocp__present-nav" onClick={(e) => e.stopPropagation()}>
                <button disabled={presenting === 0} onClick={() => setPresenting(presenting - 1)} aria-label="Previous"><Icon name="chevron-left" size={18} /></button>
                <span>{presenting + 1} / {slides.length}</span>
                <button disabled={presenting === slides.length - 1} onClick={() => setPresenting(presenting + 1)} aria-label="Next"><Icon name="chevron-right" size={18} /></button>
              </div>
            </div>
          )}
          <div className="cdocp__foot">
            <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="cdocp__msg">{msg}</span>}
            {editedBy && !dirty && <span className="cdocp__edited">Edited by {editedBy} · {when}</span>}
          </div>
        </>
      )}
      <div className="cdocp__settings">
        {doc.chat_id ? (
          <label className="thread__docpanel-ai">
            <input type="checkbox" checked={doc.ai_enabled} onChange={(e) => void flipAi(e.target.checked)} />
            AI may read this {DOC_KIND_LABEL[doc.kind].toLowerCase()}
            {!doc.ai_enabled && <span className="cdocp__ai-note">— off: no assistant ever reads it</span>}
          </label>
        ) : (
          <span className="cdocp__ai-note">{aiDoorOn('saved')
            ? 'Private to you. Your own assistant can read and build this while Drive AI is on — just ask it.'
            : 'Private to you. Drive AI is off, so no assistant reads it.'}</span>
        )}
        {confirmDel ? (
          <button className="cdocp__del is-sure" onClick={async () => {
            try {
              await (doc.chat_id ? deleteChatDoc(doc.id) : trashDoc(doc.id));
              navigate(doc.chat_id ? `/chat/${doc.chat_id}/drive` : '/drive');
            }
            catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t work.'); setConfirmDel(false); }
          }}>
            {doc.chat_id ? 'Delete it for the whole room?' : 'Delete it for good?'}
          </button>
        ) : (
          <button className="cdocp__del" onClick={() => setConfirmDel(true)}>Delete</button>
        )}
      </div>
    </div>
  );
}
