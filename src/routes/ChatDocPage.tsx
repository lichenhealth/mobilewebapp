import { trashDoc } from '../lib/trashApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import DocComments, { useDocComments } from '../components/office/DocComments';
import DocSharePanel from '../components/office/DocSharePanel';
import DocVoice from '../components/office/DocVoice';
import DocReader from '../components/office/DocReader';
import { unshareDoc, listDocShares } from '../lib/chatDocsApi';
import { cellMark, firstName, peerColor, type Anchor, type Goto, type Peer } from '../components/office/collab';
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
  // SHARING + CLAUDE IN THE DOC (founder 2026-11-26).
  const [shareOpen, setShareOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(() => new URLSearchParams(window.location.search).get('claude') === '1');
  const [myLevel, setMyLevel] = useState<'owner' | 'edit' | 'view' | 'link' | null>(null);
  const [shareCount, setShareCount] = useState(0);
  type Patch = { title?: string; body?: string | null; data?: ChatDocRow['data'] };
  const pending = useRef<Patch | null>(null);
  const docRef = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const [sp] = useSearchParams();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [goto, setGoto] = useState<Goto | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(!!sp.get('comment'));
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remote, setRemote] = useState<{ html: string; n: number } | null>(null);
  const [comments, setComments] = useDocComments(typeof doc === 'object' && doc ? doc.id : null);
  // CLOUD (founder 2026-11-14: "lets have this be cloud, so things auto save"):
  // what I last sent, what the server last held, and the live state as refs so
  // the realtime handler always sees the present.
  const lastSent = useRef<string>('');
  const baseTabs = useRef<SheetTab[]>([]);
  const live = useRef({ tabs, doc });
  live.current = { tabs, doc };
  const onAnchor = useCallback((a: Anchor | null) => setAnchor(a), []);
  const jump = useCallback((a: Anchor) => setGoto((g) => ({ anchor: a, n: (g?.n ?? 0) + 1 })), []);

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
      lastSent.current = stable(d.data ?? null);
      baseTabs.current = d.data?.sheets?.length ? JSON.parse(JSON.stringify(d.data.sheets)) : [{ name: 'Sheet1', cells: (d.data?.cells ?? [['']]).map((r) => [...r]) }];
      if (!d.chat_id) {
        setRoom(null);
        if (d.created_by === me) {
          setMyLevel('owner');
          void listDocShares(d.id).then((r) => { if (active) setShareCount(r.length); });
        } else {
          const { data: sh } = await supabase.from('chat_doc_shares').select('level').eq('doc_id', d.id).eq('profile_id', me).maybeSingle();
          if (!active) return;
          setMyLevel(((sh as { level: 'view' | 'edit' } | null)?.level) ?? 'link');
          const { data: o } = await supabase.from('profiles').select('full_name').eq('id', d.created_by).maybeSingle();
          if (active) setNames((n) => ({ ...n, [d.created_by]: (o as { full_name: string | null } | null)?.full_name ?? 'A member' }));
        }
        return;
      }
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
      if (patch.data) lastSent.current = stable(patch.data);
      await saveChatDoc(id, patch);
      if (patch.data?.sheets) baseTabs.current = JSON.parse(JSON.stringify(patch.data.sheets));
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

  // LIVE: a teammate's save streams in; presence says who else is here and
  // where they're looking. My own echo is recognized and ignored.
  const docKey = typeof doc === 'object' && doc ? doc.id : null;
  useEffect(() => {
    if (!docKey || !me) return;
    let myName = 'Someone';
    const ch = supabase.channel(`doc-live:${docKey}`, { config: { presence: { key: me } } });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_docs', filter: `id=eq.${docKey}` }, (pl) => {
      const row = pl.new as ChatDocRow;
      const cur = live.current.doc;
      if (!cur || cur === 'gone') return;
      const pend = pending.current;
      const mine = !!row.data && stable(row.data) === lastSent.current;
      setDoc({ ...row, ...(pend ?? {}), data: pend?.data ?? row.data });
      if (mine) return;
      if (!pend?.title && row.title) setTitle(row.title);
      const d = row.data;
      if (row.kind === 'doc') {
        if (!pend?.data) { const h = d?.html ?? textToHtml(row.body ?? ''); setHtml(h); setBody(row.body ?? ''); setRemote((r) => ({ html: h, n: (r?.n ?? 0) + 1 })); }
      } else if (row.kind === 'sheet') {
        const theirs: SheetTab[] = d?.sheets?.length ? JSON.parse(JSON.stringify(d.sheets)) : [{ name: 'Sheet1', cells: (d?.cells ?? [['']]).map((r) => [...r]) }];
        let next = theirs;
        if (pend?.data) {
          // Keep MY unsaved cells on top of theirs, cell by cell — two people in
          // different cells never erase each other.
          next = rebaseCells(baseTabs.current, live.current.tabs, theirs);
          pending.current = { ...pend, data: { ...(row.data ?? {}), ...(pend.data ?? {}), sheets: next, cells: next[0]?.cells ?? [['']] } };
        }
        baseTabs.current = JSON.parse(JSON.stringify(theirs));
        setTabs(next);
      } else if (row.kind === 'slides') {
        if (!pend?.data) { setSlides((d?.slides ?? []).map((x) => ({ ...x }))); setTheme(d?.theme ?? 'paper'); }
      }
    });
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_docs', filter: `id=eq.${docKey}` }, () => setDoc('gone'));
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState<{ uid: string; name: string; anchor?: Anchor | null }>();
      const out: Peer[] = [];
      for (const [k, metas] of Object.entries(st)) {
        if (k === me) continue;
        const m = metas[metas.length - 1];
        if (m) out.push({ uid: m.uid, name: m.name, color: peerColor(m.uid), anchor: m.anchor ?? null });
      }
      setPeers(out);
    });
    let active = true;
    void (async () => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', me).maybeSingle();
      myName = (data as { full_name: string | null } | null)?.full_name ?? 'Someone';
      presence.current = (a) => { if (active) void ch.track({ uid: me, name: myName, anchor: a }); };
    })();
    ch.subscribe((stt) => { if (stt === 'SUBSCRIBED') presence.current?.(anchorRef.current); });
    return () => { active = false; presence.current = null; void supabase.removeChannel(ch); };
  }, [docKey, me]);
  const presence = useRef<((a: Anchor | null) => void) | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  useEffect(() => {
    anchorRef.current = anchor;
    const t = window.setTimeout(() => presence.current?.(anchor), 250);
    return () => window.clearTimeout(t);
  }, [anchor]);

  if (!me) return null;
  if (doc === 'gone') {
    return (
      <div className="cdocp">
        <p className="cdocp__missing">That item doesn&rsquo;t exist, or it isn&rsquo;t shared with you.</p>
      </div>
    );
  }
  if (!doc) return <div className="cdocp"><p className="cdocp__missing">Loading…</p></div>;

  const personal = !doc.chat_id;
  const isOwner = personal && doc.created_by === me;
  const canEdit = !personal || isOwner || myLevel === 'edit';
  const ownerName = names[doc.created_by] ?? 'a member';
  const accessWord = !personal ? null
    : isOwner
      ? (doc.link_access === 'anyone' ? 'Anyone with the link can view'
        : doc.link_access === 'lichen' ? `Anyone on Lichen with the link${shareCount ? ` · shared with ${shareCount}` : ''}`
        : shareCount ? `Shared with ${shareCount} ${shareCount === 1 ? 'person' : 'people'}` : 'Private — only you')
      : `Shared by ${ownerName} · ${myLevel === 'edit' ? 'you can edit' : 'view only'}`;
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

  const openRoots = comments.filter((c) => !c.parent_id && !c.resolved_at);
  const cellMarks = new Set(openRoots.flatMap((c) => (c.anchor?.kind === 'cell' ? [cellMark(c.anchor.tab, c.anchor.r, c.anchor.c)] : [])));
  const slideMarks = new Set(openRoots.flatMap((c) => (c.anchor?.kind === 'slide' ? [c.anchor.index] : [])));

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
            {accessWord}
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
              className="cdocp__title" value={title} maxLength={120} readOnly={!canEdit}
              onChange={(e) => onTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setTitle(doc.title); }}
              aria-label="Title"
            />
            <div className="cdocp__file">
              <button className="cdocp__filebtn" onClick={() => setFileMenu((v) => !v)} aria-expanded={fileMenu}>File ▾</button>
              {fileMenu && (
                <div className="sheet__menu cdocp__filemenu" onMouseLeave={() => setFileMenu(false)}>
                  <button onClick={() => void makeCopy()}>Make a copy</button>
                  {personal && <button onClick={() => { setFileMenu(false); setShareOpen(true); }}>Share…</button>}
                  {isOwner && <button onClick={() => { setFileMenu(false); openPicker(doc.id, 'doc'); }}>Add to a folder…</button>}
                  <button onClick={() => { setFileMenu(false); window.print(); }}>Print / save as PDF</button>
                  {(!personal || isOwner) && <button className="is-danger" onClick={() => { setFileMenu(false); setConfirmDel(true); }}>{doc.chat_id ? 'Delete…' : 'Move to trash…'}</button>}
                  {personal && !isOwner && myLevel !== 'link' && <button onClick={async () => { setFileMenu(false); await unshareDoc(doc.id, me); navigate('/drive'); }}>Remove it from my Drive</button>}
                </div>
              )}
            </div>
          </div>
          <div className="cdocp__status" aria-live="polite">
            <span className={'cdocp__saved is-' + status}>{statusWord}</span>
            {msg && <span className="cdocp__msg">{msg}</span>}
            {editedBy && status === 'saved' && <span className="cdocp__edited">· Last edit by {editedBy} · {when}</span>}
            <span className="cdocp__collab">
              {peers.length > 0 && (
                <span className="cdocp__peers" title={`Also here: ${peers.map((p) => p.name).join(', ')}`}>
                  {peers.slice(0, 4).map((p) => <span key={p.uid} className="cdocp__peer" style={{ background: p.color }}>{firstName(p.name)[0]}</span>)}
                  <span className="cdocp__peerword">{peers.length === 1 ? `${firstName(peers[0].name)} is here` : `${peers.length} others here`}</span>
                </span>
              )}
              {personal && (
                <button className="cdocp__cbtn cdocp__sharebtn" onClick={() => setShareOpen(true)}>Share</button>
              )}
              <button className={'cdocp__cbtn' + (voiceOpen ? ' is-on' : '')} onClick={() => setVoiceOpen((v) => !v)} aria-label="Claude — ask about this, or have it read to you">
                <Icon name="brain" size={14} /> Claude
              </button>
              <button className={'cdocp__cbtn' + (commentsOpen ? ' is-on' : '')} onClick={() => setCommentsOpen((v) => !v)}>
                💬 Comments{openRoots.length ? ` · ${openRoots.length}` : ''}
              </button>
            </span>
          </div>
          {!canEdit && (
            <DocReader kind={doc.kind} html={html} sheets={tabs} slides={slides} theme={theme} />
          )}
          {canEdit && doc.kind === 'doc' && (
            <DocEditor html={html} title={title} onChange={onDoc} chatId={doc.chat_id} onAnchor={onAnchor} goto={goto} remote={remote}
              placeholder={doc.chat_id ? 'Write here — everyone in the room can read and edit this.' : 'Write here — this lives in your Drive, yours alone.'} />
          )}
          {canEdit && doc.kind === 'sheet' && <SheetEditor tabs={tabs} onChange={onSheet} title={title} onAnchor={onAnchor} marks={cellMarks} peers={peers} goto={goto} />}
          {canEdit && doc.kind === 'slides' && <SlidesEditor slides={slides} theme={theme} onChange={onSlides} title={title} chatId={doc.chat_id} onAnchor={onAnchor} marks={slideMarks} peers={peers} goto={goto} />}
          {commentsOpen && (
            <DocComments docId={doc.id} me={me} rows={comments} setRows={setComments} anchor={anchor}
              onGoto={jump} onClose={() => setCommentsOpen(false)} focusId={sp.get('comment')} />
          )}
        </>
      )}
      {shareOpen && (
        <DocSharePanel doc={doc} me={me} onClose={() => { setShareOpen(false); if (isOwner) void listDocShares(doc.id).then((r) => setShareCount(r.length)); }}
          onLink={(v) => setDoc((cur) => (cur && cur !== 'gone' ? { ...cur, ...v } : cur))} />
      )}
      {voiceOpen && doc.kind !== 'poll' && (
        <DocVoice doc={doc} html={html} body={body} onClose={() => setVoiceOpen(false)} />
      )}
      {(!personal || isOwner) && <div className="cdocp__settings">
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
      </div>}
    </div>
  );
}

/** Key-sorted JSON — Postgres jsonb reorders keys, so plain stringify can't
 *  recognize my own echo. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

/** My unsaved cell edits (mine vs base) laid over a teammate's newer save. */
function rebaseCells(base: SheetTab[], mine: SheetTab[], theirs: SheetTab[]): SheetTab[] {
  const out: SheetTab[] = JSON.parse(JSON.stringify(theirs));
  for (const m of mine) {
    const b = base.find((t) => t.name === m.name);
    const t = out.find((x) => x.name === m.name);
    if (!t) { if (!b) out.push(JSON.parse(JSON.stringify(m))); continue; }
    m.cells.forEach((row, r) => row.forEach((v, c) => {
      if ((b?.cells[r]?.[c] ?? '') === v) return;
      while (t.cells.length <= r) t.cells.push([]);
      while (t.cells[r].length <= c) t.cells[r].push('');
      t.cells[r][c] = v;
    }));
    if (b) b.cells.forEach((row, r) => row.forEach((v, c) => {
      // A cell I cleared stays cleared.
      if (v && !(m.cells[r]?.[c]) && t.cells[r]?.[c] === v) t.cells[r][c] = '';
    }));
    if (stable(m.fmt) !== stable(b?.fmt)) t.fmt = m.fmt;
    if (stable(m.charts) !== stable(b?.charts)) t.charts = m.charts;
    if (stable(m.cond) !== stable(b?.cond)) t.cond = m.cond;
    if (stable(m.filter) !== stable(b?.filter)) t.filter = m.filter;
  }
  return out;
}
