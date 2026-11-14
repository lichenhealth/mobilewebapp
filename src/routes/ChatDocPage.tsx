import { trashDoc } from '../lib/trashApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { PollBody, DocAiMark } from '../components/ChatDocCard';
import {
  loadChatDoc, saveChatDoc, setChatDocAi, deleteChatDoc, createPersonalDoc,
  DOC_KIND_LABEL, DOC_KIND_ICON, type ChatDocRow, type Slide,
} from '../lib/chatDocsApi';
import type { SheetTab } from '../lib/formula';
import { textToHtml } from '../lib/richText';
import { useCollect } from '../collections/CollectPrompt';
import SheetEditor from '../components/office/SheetEditor';
import DocEditor from '../components/office/DocEditor';
import SlidesEditor from '../components/office/SlidesEditor';
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
  const { openPicker } = useCollect();
  const me = user?.id ?? '';
  const [doc, setDoc] = useState<ChatDocRow | null | 'gone'>(null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [body, setBody] = useState('');
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [theme, setTheme] = useState('paper');
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [msg, setMsg] = useState('');
  const [fileMenu, setFileMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  type Patch = { title?: string; body?: string | null; data?: ChatDocRow['data'] };
  const pending = useRef<Patch | null>(null);
  const docRef = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!docId || !me) return;
    let active = true;
    (async () => {
      const d = await loadChatDoc(docId);
      if (!active) return;
      if (!d) { setDoc('gone'); return; }
      setDoc(d);
      docRef.current = d.id;
      setTitle(d.title);
      setBody(d.body ?? '');
      setHtml(d.data?.html ?? textToHtml(d.body ?? ''));
      setTabs(d.data?.sheets?.length
        ? d.data.sheets.map((t) => ({ ...t, cells: t.cells.map((r) => [...r]) }))
        : [{ name: 'Sheet1', cells: (d.data?.cells ?? [['']]).map((r) => [...r]), frozen: 0 }]);
      setSlides((d.data?.slides ?? [{ title: '', body: '', layout: 'title' }]).map((x) => ({ ...x })));
      setTheme(d.data?.theme ?? 'paper');
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

  // AUTOSAVE — the Google posture: every change is saved a beat later, and a
  // pending save flushes when the tab hides or the page unmounts.
  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current; pending.current = null;
    const id = docRef.current;
    if (!patch || !id) return;
    setStatus('saving');
    try {
      await saveChatDoc(id, patch);
      setDoc((cur) => (cur && cur !== 'gone' ? { ...cur, ...patch, updated_by: user?.id ?? cur.updated_by, updated_at: new Date().toISOString() } : cur));
      setStatus((s) => (s === 'saving' ? 'saved' : s));
    }
    catch (e) { setStatus('error'); setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
  }, [user?.id]);
  const queue = (patch: Patch) => {
    pending.current = { ...(pending.current ?? {}), ...patch }; setStatus('dirty'); setMsg('');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 900);
  };
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', () => void flush());
    return () => { document.removeEventListener('visibilitychange', hide); void flush(); };
  }, [flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (!me) return null;
  if (doc === 'gone') {
    return (
      <div className="cdocp">
        <p className="cdocp__missing">That item doesn&rsquo;t exist, or you&rsquo;re not in its room.</p>
      </div>
    );
  }
  if (!doc) return <div className="cdocp"><p className="cdocp__missing">Loading…</p></div>;

  const saveWith = (patch: Patch) => queue(patch);
  const dataNow = (over: Partial<NonNullable<ChatDocRow['data']>>) => ({ ...(doc.data ?? {}), ...over });
  const onTitle = (v: string) => {
    setTitle(v);
    if (v.trim()) queue({ title: v.trim() });
  };
  const onDoc = (h: string, text: string) => { setHtml(h); setBody(text); saveWith({ body: text, data: dataNow({ html: h }) }); };
  const onSheet = (t: SheetTab[]) => { setTabs(t); saveWith({ data: dataNow({ sheets: t, cells: t[0]?.cells ?? [['']] }) }); };
  const onSlides = (sl: Slide[], th: string) => { setSlides(sl); setTheme(th); saveWith({ data: dataNow({ slides: sl, theme: th }) }); };

  const flipAi = async (on: boolean) => {
    setMsg('');
    try { await setChatDocAi(doc.id, on); setDoc({ ...doc, ai_enabled: on }); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
  };
  const makeCopy = async () => {
    setFileMenu(false);
    await flush();
    if (doc.kind === 'poll') return;
    const data = doc.kind === 'doc' ? dataNow({ html }) : doc.kind === 'sheet' ? dataNow({ sheets: tabs, cells: tabs[0]?.cells }) : dataNow({ slides, theme });
    const row = await createPersonalDoc(doc.kind, `Copy of ${title}`.slice(0, 120), { body: doc.kind === 'doc' ? body : null, data });
    navigate(`/docs/${row.id}`);
  };

  const editedBy = doc.updated_by ? (names[doc.updated_by] ?? (doc.updated_by === me ? 'you' : 'a member')) : null;
  const when = new Date(doc.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const statusWord = status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes…' : status === 'error' ? 'Couldn’t save' : 'All changes saved';

  return (
    <div className={'cdocp' + (doc.kind !== 'poll' ? ' cdocp--office' : '')}>
      <PageHead onBack={() => { void flush(); navigate(doc.chat_id ? `/chat/${doc.chat_id}` : '/drive'); }} />
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
          <div className="cdocp__titlerow">
            <input
              className="cdocp__title" value={title} maxLength={120}
              onChange={(e) => onTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setTitle(doc.title); }}
              aria-label="Title"
            />
            <div className="cdocp__file">
              <button className="cdocp__filebtn" onClick={() => setFileMenu((v) => !v)} aria-expanded={fileMenu}>File ▾</button>
              {fileMenu && (
                <div className="sheet__menu cdocp__filemenu" onMouseLeave={() => setFileMenu(false)}>
                  <button onClick={() => void makeCopy()}>Make a copy</button>
                  {!doc.chat_id && <button onClick={() => { setFileMenu(false); openPicker(doc.id, 'doc'); }}>Add to a folder…</button>}
                  <button onClick={() => { setFileMenu(false); window.print(); }}>Print / save as PDF</button>
                  <button className="is-danger" onClick={() => { setFileMenu(false); setConfirmDel(true); }}>{doc.chat_id ? 'Delete…' : 'Move to trash…'}</button>
                </div>
              )}
            </div>
          </div>
          <div className="cdocp__status" aria-live="polite">
            <span className={'cdocp__saved is-' + status}>{statusWord}</span>
            {msg && <span className="cdocp__msg">{msg}</span>}
            {editedBy && status === 'saved' && <span className="cdocp__edited">· Last edit by {editedBy} · {when}</span>}
          </div>
          {doc.kind === 'doc' && (
            <DocEditor html={html} title={title} onChange={onDoc}
              placeholder={doc.chat_id ? 'Write here — everyone in the room can read and edit this.' : 'Write here — this lives in your Drive, yours alone.'} />
          )}
          {doc.kind === 'sheet' && <SheetEditor tabs={tabs} onChange={onSheet} title={title} />}
          {doc.kind === 'slides' && <SlidesEditor slides={slides} theme={theme} onChange={onSlides} title={title} />}
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
          <button className="cdocp__del is-sure" onBlur={() => setConfirmDel(false)} autoFocus onClick={async () => {
            try {
              pending.current = null;
              await (doc.chat_id ? deleteChatDoc(doc.id) : trashDoc(doc.id));
              navigate(doc.chat_id ? `/chat/${doc.chat_id}/drive` : '/drive');
            }
            catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t work.'); setConfirmDel(false); }
          }}>
            {doc.chat_id ? 'Delete it for the whole room?' : 'Move it to the trash?'}
          </button>
        ) : (
          <button className="cdocp__del" onClick={() => setConfirmDel(true)}>{doc.chat_id ? 'Delete' : 'Move to trash'}</button>
        )}
      </div>
    </div>
  );
}
