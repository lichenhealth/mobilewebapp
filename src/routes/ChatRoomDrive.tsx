import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { DocAiMark } from '../components/ChatDocCard';
import {
  listChatDocs, listSpaceDocs, countSpaceDocsByChat,
  DOC_KIND_LABEL, DOC_KIND_ICON, type ChatDocRow,
} from '../lib/chatDocsApi';
import { listSpaceRooms, type SpaceRoom } from '../lib/spacesApi';
import { signChatMedia, type Attachment } from '../lib/chatApi';
import { loadPrompts, promptSeen, markPrompt } from '../lib/promptsApi';
import './ChatDocs.css';

/** THE DRIVE TREE (founder 2026-10-21, the Google-Drive carrot: "have the
 *  drop down open up and highlight how far down the nesting folders the
 *  person is who clicked thru… the Kapulli 2026 Retreat drive selected, but
 *  you can scroll up to the Kapulli 2026 Group to see the entire drive"):
 *  one view serves `/chat/:id/drive` (a room selected) and
 *  `/spaces/:id/drive` (the whole group selected) — the tree at the top is
 *  the nesting made visible, the selected node lit peach, every other node
 *  one tap away. A TOPIC room with no matching event on the group's calendar
 *  offers to create one — an event is what unlocks RSVPs and group
 *  scheduling (founder, same message). */
export default function ChatRoomDrive({ mode }: { mode: 'room' | 'space' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [spaceName, setSpaceName] = useState<string | null>(null);
  const [roomTopic, setRoomTopic] = useState<string | null>(null);
  const [rooms, setRooms] = useState<SpaceRoom[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [docs, setDocs] = useState<ChatDocRow[] | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [eventHit, setEventHit] = useState<{ title: string; postId: string | null } | null | 'none'>(null);
  const [promptGone, setPromptGone] = useState(false);
  // promptSeen() reads a cache loadPrompts() fills async — render only after
  // it has landed, or a dismissed prompt flashes back on every reload.
  const [promptsReady, setPromptsReady] = useState(false);
  // SHARED IN THIS ROOM (founder 2026-10-21: "a hybrid of Google Drive and
  // when you click the name of the person you're chatting with on iChat and
  // it has all the links, photos, documents, etc you've shared in that
  // chat") — the room's photos and links, gathered from its own messages.
  const [photos, setPhotos] = useState<{ key: string; url: string }[]>([]);
  const [links, setLinks] = useState<{ url: string; who: string; at: string }[]>([]);

  useEffect(() => {
    if (!id || !me) return;
    let active = true;
    (async () => {
      setDocs(null);
      let sid: string | null = null;
      if (mode === 'room') {
        const [{ data: c }, rows] = await Promise.all([
          supabase.from('chats')
            .select('topic, room_space:spaces!chats_space_id_fkey(id, name)')
            .eq('id', id).maybeSingle(),
          listChatDocs(id),
        ]);
        if (!active) return;
        const cr = c as unknown as { topic: string | null; room_space: { id: string; name: string } | null } | null;
        sid = cr?.room_space?.id ?? null;
        setSpaceId(sid);
        setSpaceName(cr?.room_space?.name ?? null);
        setRoomTopic(cr?.topic ?? null);
        setDocs(rows);
        // The iChat half: everything shared IN the room, from its messages.
        const { data: msgs } = await supabase.from('chat_messages')
          .select('body, attachments, created_at, sender:profiles!chat_messages_sender_id_fkey(full_name)')
          .eq('chat_id', id).order('created_at', { ascending: false }).limit(400);
        if (!active) return;
        type Msg = { body: string | null; attachments: Attachment[] | null; created_at: string; sender: { full_name: string | null } | null };
        const rowsM = (msgs as unknown as Msg[] | null) ?? [];
        const photoPaths: string[] = [];
        const linkRows: { url: string; who: string; at: string }[] = [];
        const seen = new Set<string>();
        for (const m of rowsM) {
          for (const a of m.attachments ?? []) {
            if (a.type === 'photo' && photoPaths.length < 24) photoPaths.push(a.url);
          }
          for (const u of (m.body ?? '').match(/https?:\/\/[^\s)]+/g) ?? []) {
            if (!seen.has(u) && linkRows.length < 30) {
              seen.add(u);
              linkRows.push({ url: u, who: m.sender?.full_name ?? 'Someone', at: m.created_at });
            }
          }
        }
        const signed = await signChatMedia(photoPaths);
        if (!active) return;
        setPhotos(photoPaths.filter((p) => signed[p]).map((p) => ({ key: p, url: signed[p] })));
        setLinks(linkRows);
      } else {
        sid = id;
        const [{ data: s }, rows] = await Promise.all([
          supabase.from('spaces').select('id, name').eq('id', id).maybeSingle(),
          listSpaceDocs(id),
        ]);
        if (!active) return;
        setSpaceId(sid);
        setSpaceName((s as { name: string } | null)?.name ?? null);
        setRoomTopic(null);
        setDocs(rows);
        setPhotos([]); setLinks([]);
      }
      if (sid) {
        const [allRooms, byChat] = await Promise.all([listSpaceRooms(sid), countSpaceDocsByChat(sid)]);
        if (!active) return;
        setRooms(allRooms);
        setCounts(byChat);
      }
      void loadPrompts(me).then(() => { if (active) setPromptsReady(true); });
    })();
    return () => { active = false; };
  }, [id, me, mode]);

  // The event offer: a TOPIC room is often a real gathering taking shape —
  // if the group's calendar already holds an event matching the topic, point
  // at it; if not, offer to create one (never pushed, dismiss remembers).
  useEffect(() => {
    if (mode !== 'room' || !roomTopic || !spaceId) { setEventHit(null); return; }
    let active = true;
    (async () => {
      const { data: evs } = await supabase
        .from('events').select('id, title')
        .eq('owner_space_id', spaceId)
        .ilike('title', `%${roomTopic}%`)
        .limit(1);
      if (!active) return;
      const ev = (evs as { id: string; title: string }[] | null)?.[0];
      if (!ev) { setEventHit('none'); return; }
      const { data: post } = await supabase
        .from('posts').select('id').eq('linked_event_id', ev.id).maybeSingle();
      if (!active) return;
      setEventHit({ title: ev.title, postId: (post as { id: string } | null)?.id ?? null });
    })();
    return () => { active = false; };
  }, [mode, roomTopic, spaceId]);

  const roomName = (r: SpaceRoom) => r.topic ?? 'Main room';
  const totalCount = useMemo(
    () => rooms.reduce((a, r) => a + (counts.get(r.id) ?? 0), 0),
    [rooms, counts],
  );
  const byRoom = useMemo(() => {
    const m = new Map<string, ChatDocRow[]>();
    for (const d of docs ?? []) {
      if (!d.chat_id) continue;   // personal docs live in Drive, not a room
      const arr = m.get(d.chat_id) ?? [];
      arr.push(d);
      m.set(d.chat_id, arr);
    }
    return m;
  }, [docs]);

  if (!me) return null;
  const title = mode === 'space'
    ? `${spaceName ?? '…'} — drive`
    : `${spaceName ?? '…'}${roomTopic ? ` · ${roomTopic}` : ''} — drive`;
  const promptTopic = `room-event-${id}`;
  const showCreateEvent = mode === 'room' && !!roomTopic && eventHit === 'none'
    && !promptGone && promptsReady && !promptSeen(promptTopic);

  const itemRow = (d: ChatDocRow) => (
    <button key={d.id} className="cdocp__row" onClick={() => navigate(`/docs/${d.id}`)}>
      <span className="cdocp__row-icon"><Icon name={DOC_KIND_ICON[d.kind]} size={16} /></span>
      <span className="cdocp__row-main">
        <span className="cdocp__row-title">{d.title}</span>
        <span className="cdocp__row-meta">
          {DOC_KIND_LABEL[d.kind]} · updated {new Date(d.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </span>
      {!d.ai_enabled && <DocAiMark />}
    </button>
  );

  return (
    <div className="cdocp">
      {mode === 'room' ? (
        <button className="cmp__back cdocp__back" onClick={() => navigate(`/chat/${id}`)}>
          <Icon name="arrow-left" size={14} /> Back to the room
        </button>
      ) : (
        <button className="cmp__back cdocp__back" onClick={() => navigate(`/spaces/${id}`)}>
          <Icon name="arrow-left" size={14} /> Back to {spaceName ?? 'the group'}
        </button>
      )}

      {/* The tree — where this drive sits in the group's nesting. */}
      <div className="cdocp__tree">
        <div className={'cdocp__node cdocp__node--root' + (mode === 'space' ? ' is-sel' : '')}>
          <button
            className={'cdocp__carrot' + (treeOpen ? ' is-open' : '')}
            aria-label={treeOpen ? 'Fold the rooms' : 'Unfold the rooms'}
            onClick={() => setTreeOpen((o) => !o)}
          >
            <Icon name="chevron-right" size={13} />
          </button>
          <button className="cdocp__node-main" onClick={() => spaceId && navigate(`/spaces/${spaceId}/drive`)}>
            <Icon name="drive" size={15} />
            <span className="cdocp__node-name">{spaceName ?? '…'} — whole drive</span>
            <span className="cdocp__node-count">{totalCount}</span>
          </button>
        </div>
        {treeOpen && rooms.map((r) => {
          const sel = mode === 'room' && r.id === id;
          return (
            <div key={r.id} className={'cdocp__node cdocp__node--child' + (sel ? ' is-sel' : '')}>
              <button className="cdocp__node-main" onClick={() => !sel && navigate(`/chat/${r.id}/drive`)}>
                <Icon name="chat" size={14} />
                <span className="cdocp__node-name">{roomName(r)}</span>
                <span className="cdocp__node-count">{counts.get(r.id) ?? 0}</span>
                {!r.assistantEnabled && <DocAiMark title="AI-free room — nothing said there reaches any assistant" />}
              </button>
            </div>
          );
        })}
      </div>

      <h2 className="cdocp__drivetitle">{title}</h2>

      {/* A topic room that looks like a real gathering: point at its event,
          or offer to create one — that's what unlocks RSVPs and scheduling. */}
      {mode === 'room' && roomTopic && eventHit && eventHit !== 'none' && (
        <button
          className="cdocp__evline"
          onClick={() => navigate(eventHit.postId ? `/events/${eventHit.postId}` : `/events?space=${spaceId}`)}
        >
          <Icon name="rsvp" size={14} /> “{eventHit.title}” is on {spaceName ?? 'the group'}&rsquo;s calendar ›
        </button>
      )}
      {showCreateEvent && (
        <div className="cdocp__evprompt" role="note">
          <div className="cdocp__evprompt-body">
            <p className="cdocp__evprompt-title">Planning {roomTopic} for real?</p>
            <p className="cdocp__evprompt-sub">
              Create an event for it — that unlocks RSVPs, group scheduling and a calendar home for this room&rsquo;s plans.
            </p>
            <button
              className="btn btn-primary cdocp__evprompt-go"
              onClick={() => navigate(`/compose?area=events&title=${encodeURIComponent(roomTopic)}`)}
            >
              Create the event
            </button>
          </div>
          <button
            className="thread__about-x"
            aria-label="Not now"
            onClick={() => { setPromptGone(true); void markPrompt(me, promptTopic); }}
          >×</button>
        </div>
      )}

      {docs === null ? (
        <p className="cdocp__missing">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="cdocp__empty">
          {mode === 'space'
            ? 'Nothing in this drive yet — the ⊕ in any room’s composer creates a doc, a poll, or a spreadsheet.'
            : 'Nothing here yet — the ⊕ in the room’s composer creates a doc, a poll, or a spreadsheet, and it lands right here.'}
        </p>
      ) : mode === 'space' ? (
        // The whole drive, grouped by room — the zoomed-out view.
        rooms
          .filter((r) => (byRoom.get(r.id) ?? []).length > 0)
          .map((r) => (
            <div key={r.id} className="cdocp__roomsec">
              <p className="cdocp__sib-h">{roomName(r)}</p>
              <div className="cdocp__list">{(byRoom.get(r.id) ?? []).map(itemRow)}</div>
            </div>
          ))
      ) : (
        <div className="cdocp__list">{docs.map(itemRow)}</div>
      )}

      {/* Shared in this room — the iChat anatomy (founder 2026-10-21):
          the photos and links that already passed through the conversation,
          gathered where the documents live. Room view only. */}
      {mode === 'room' && photos.length > 0 && (
        <div className="cdocp__shared">
          <p className="cdocp__sib-h">Photos shared here</p>
          <div className="cdocp__photogrid">
            {photos.map((p) => (
              <a key={p.key} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}
      {mode === 'room' && links.length > 0 && (
        <div className="cdocp__shared">
          <p className="cdocp__sib-h">Links shared here</p>
          <div className="cdocp__list">
            {links.map((l) => (
              <a key={l.url} className="cdocp__row cdocp__row--link" href={l.url} target="_blank" rel="noreferrer">
                <span className="cdocp__row-icon"><Icon name="globe" size={16} /></span>
                <span className="cdocp__row-main">
                  <span className="cdocp__row-title">{l.url.replace(/^https?:\/\//, '')}</span>
                  <span className="cdocp__row-meta">
                    from {l.who} · {new Date(l.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
