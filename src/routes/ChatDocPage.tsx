import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { PollBody, DocAiMark } from '../components/ChatDocCard';
import {
  loadChatDoc, saveChatDoc, setChatDocAi, deleteChatDoc,
  DOC_KIND_LABEL, DOC_KIND_ICON, type ChatDocRow,
} from '../lib/chatDocsApi';
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
      });
      setDirty(false); setMsg('Saved ✓');
      setDoc({ ...doc, title: title.trim() || doc.title, body, data: doc.kind === 'sheet' ? { ...(doc.data ?? {}), cells } : doc.data, updated_by: me, updated_at: new Date().toISOString() });
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
      {doc.chat_id ? (
        <button className="cmp__back cdocp__back" onClick={() => navigate(`/chat/${doc.chat_id}`)}>
          <Icon name="arrow-left" size={14} /> Back to {room?.title ?? 'the room'}
        </button>
      ) : (
        <button className="cmp__back cdocp__back" onClick={() => navigate('/drive')}>
          <Icon name="arrow-left" size={14} /> Back to Drive
        </button>
      )}
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
          <span className="cdocp__ai-note">No assistant reads what lives only in your Drive.</span>
        )}
        {confirmDel ? (
          <button className="cdocp__del is-sure" onClick={async () => {
            try {
              await deleteChatDoc(doc.id);
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
