import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { DocAiMark } from '../components/ChatDocCard';
import { listChatDocs, countSpaceDocsByChat, DOC_KIND_LABEL, DOC_KIND_ICON, type ChatDocRow } from '../lib/chatDocsApi';
import { listSpaceRooms, type SpaceRoom } from '../lib/spacesApi';
import './ChatDocs.css';

interface RoomInfo { title: string; spaceName: string | null; spaceId: string | null }

/** A room's DRIVE (founder 2026-10-21: "any docs created via this scenario
 *  will live in the drive of that chat and be nested under the greater drive
 *  of that group or community"): everything born in this room's composer,
 *  with the sibling rooms' folders below — the nesting made visible. An
 *  AI-free item wears the gray slashed brain. */
export default function ChatRoomDrive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [docs, setDocs] = useState<ChatDocRow[] | null>(null);
  const [siblings, setSiblings] = useState<{ room: SpaceRoom; count: number }[]>([]);

  useEffect(() => {
    if (!id || !me) return;
    let active = true;
    (async () => {
      const [{ data: c }, rows] = await Promise.all([
        supabase.from('chats')
          .select('topic, title, room_space:spaces!chats_space_id_fkey(id, name)')
          .eq('id', id).maybeSingle(),
        listChatDocs(id),
      ]);
      if (!active) return;
      const cr = c as unknown as { topic: string | null; title: string | null; room_space: { id: string; name: string } | null } | null;
      const info: RoomInfo = {
        title: cr?.room_space ? `${cr.room_space.name}${cr.topic ? ` · ${cr.topic}` : ''}` : (cr?.title ?? 'This room'),
        spaceName: cr?.room_space?.name ?? null,
        spaceId: cr?.room_space?.id ?? null,
      };
      setRoom(info);
      setDocs(rows);
      if (info.spaceId) {
        const [allRooms, counts] = await Promise.all([
          listSpaceRooms(info.spaceId),
          countSpaceDocsByChat(info.spaceId),
        ]);
        if (!active) return;
        setSiblings(allRooms.filter((r) => r.id !== id).map((r) => ({ room: r, count: counts.get(r.id) ?? 0 })));
      }
    })();
    return () => { active = false; };
  }, [id, me]);

  if (!me) return null;

  return (
    <div className="cdocp">
      <button className="cmp__back cdocp__back" onClick={() => navigate(`/chat/${id}`)}>
        <Icon name="arrow-left" size={14} /> Back to the room
      </button>
      <div className="cdocp__drivehead">
        <Icon name="drive" size={20} />
        <div>
          <h2 className="cdocp__drivetitle">{room?.title ?? '…'} — drive</h2>
          {room?.spaceName && <p className="cdocp__drivesub">Part of {room.spaceName}&rsquo;s drive</p>}
        </div>
      </div>
      {docs === null ? (
        <p className="cdocp__missing">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="cdocp__empty">
          Nothing here yet — the ⊕ in the room&rsquo;s composer creates a doc, a poll, or a spreadsheet,
          and it lands right here.
        </p>
      ) : (
        <div className="cdocp__list">
          {docs.map((d) => (
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
          ))}
        </div>
      )}
      {siblings.length > 0 && room?.spaceName && (
        <div className="cdocp__siblings">
          <p className="cdocp__sib-h">More of {room.spaceName}&rsquo;s drive</p>
          {siblings.map(({ room: r, count }) => (
            <button key={r.id} className="cdocp__row" onClick={() => navigate(`/chat/${r.id}/drive`)}>
              <span className="cdocp__row-icon"><Icon name="drive" size={16} /></span>
              <span className="cdocp__row-main">
                <span className="cdocp__row-title">{r.topic ?? 'Main room'}</span>
                <span className="cdocp__row-meta">{count} {count === 1 ? 'item' : 'items'}</span>
              </span>
              {!r.assistantEnabled && <DocAiMark title="AI-free room — nothing said there reaches any assistant" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
