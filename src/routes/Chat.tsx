import { useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import {
  loadChatList, loadUnreadCounts, ensureDirectChat, messagePreview,
  colorFor, monogramFor, formatRelative, KIND_LABEL, ChatVM,
} from '../lib/chatApi';
import './Chat.css';
import { searchMessages, type MessageHit } from '../lib/chatApi';

export default function Chat() {
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<ChatVM[]>([]);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  // Searching message HISTORY, not just the latest line (founder 2026-07-28).
  // RLS scopes it to rooms you're in; debounced so typing stays cheap.
  const [msgHits, setMsgHits] = useState<MessageHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setMsgHits([]); return; }
    let live = true;
    const t = window.setTimeout(() => {
      void searchMessages(q).then((r) => { if (live) setMsgHits(r); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [query]);
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  useEffect(() => {
    if (!me) return;
    let active = true;
    loadChatList(me).then((vms) => { if (active) { setChats(vms); setLoading(false); } });
    loadUnreadCounts().then((m) => { if (active) setUnread(m); });
    return () => { active = false; };
  }, [me]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.last?.body?.toLowerCase().includes(q) ?? false) ||
      c.members.some((m) => m.name.toLowerCase().includes(q)),
    );
  }, [query, chats]);

  return (
    <div className="chat">
      <header className="chat__head">
        <div className="chat__head-row">
          <div>
            <span className="eyebrow">Chat · {chats.length} {chats.length === 1 ? 'thread' : 'threads'}</span>
            <h1 className="chat__title">
              <span className="display-italic">Messages</span>
            </h1>
          </div>
          <button className="chat__new" onClick={() => setPicking(true)} aria-label="New message">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className="chat__search">
        <Icon name="search" size={16} />
        <input
          className="chat__search-input"
          placeholder="Search messages and people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="chat__search-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="chat__list">
        {loading && <div className="chat__empty"><p>Loading your chats…</p></div>}

        {!loading && chats.length === 0 && (
          <div className="chat__empty">
            <Icon name="message" size={20} />
            <p>No chats yet</p>
            <p className="chat__empty-sub">
              Start a direct message with the button up top, or chats appear here
              automatically for your communities, groups, places, organizations, and care team.
            </p>
          </div>
        )}

        {!loading && chats.length > 0 && hits.length === 0 && msgHits.length === 0 && (
          <div className="chat__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
            <p className="chat__empty-sub">Try a different word, or a person's name.</p>
          </div>
        )}

        {msgHits.length > 0 && (
          <div className="chat__msghits">
            <p className="chat__msghits-head">In messages</p>
            {msgHits.map((m) => {
              const room = chats.find((c) => c.id === m.chat_id);
              return (
                <button
                  key={m.id}
                  className="chat__msghit"
                  onClick={() => navigate(`/chat/${m.chat_id}`)}
                >
                  <span className="chat__msghit-top">
                    <strong>{m.senderName ?? 'A member'}</strong>
                    {room && <em> · {room.title}</em>}
                    <span className="chat__msghit-when">{formatRelative(m.created_at)}</span>
                  </span>
                  <span className="chat__msghit-body">{m.body}</span>
                </button>
              );
            })}
          </div>
        )}

        {hits.map((c) => (
          <ConversationRow
            key={c.id}
            chat={c}
            me={me}
            highlight={query}
            unread={unread.get(c.id) ?? 0}
            onClick={() => navigate(`/chat/${c.id}`)}
          />
        ))}
      </div>

      {picking && (
        <NewMessage
          me={me}
          onClose={() => setPicking(false)}
          onPick={async (otherId) => {
            try {
              const chatId = await ensureDirectChat(otherId);
              setPicking(false);
              navigate(`/chat/${chatId}`);
            } catch (e) {
              console.error(e);
              alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
        />
      )}
    </div>
  );
}

function ConversationRow({ chat, me, highlight, unread = 0, onClick }: { chat: ChatVM; me: string; highlight?: string; unread?: number; onClick: () => void }) {
  const last = chat.last;
  const isDirect = chat.kind === 'direct';
  const isDM = isDirect || chat.kind === 'help'; // help rooms render DM-style (other member's avatar, no sender prefix)
  const senderName = last
    ? chat.members.find((m) => m.profile_id === last.sender_id)?.name.split(' ')[0]
    : undefined;
  const showSender = last && !isDM;

  return (
    <button className={'conv-row' + (unread > 0 ? ' has-unread' : '')} onClick={onClick}>
      <div className="conv-row__avatar-stack">
        <GroupAvatar chat={chat} me={me} />
      </div>
      <div className="conv-row__body">
        <div className="conv-row__top">
          <span className="conv-row__name">
            {highlightText(chat.title, highlight)}
            {!isDirect && <span className="conv-row__muted"> ·{KIND_LABEL[chat.kind].toLowerCase()}</span>}
          </span>
          <span className="conv-row__time">{last ? formatRelative(last.created_at) : ''}</span>
        </div>
        <div className="conv-row__bottom">
          <span className="conv-row__preview">
            {last
              ? <>{showSender && senderName && <span className="conv-row__sender">{senderName}: </span>}{highlightText(messagePreview(last), highlight)}</>
              : <em>No messages yet</em>}
          </span>
          {unread > 0 && <span className="conv-row__unread">{unread > 99 ? '99+' : unread}</span>}
        </div>
      </div>
    </button>
  );
}

function GroupAvatar({ chat, me }: { chat: ChatVM; me: string }) {
  // Direct/help + solo chats show a single monogram, keyed off the OTHER member.
  const dmLike = chat.kind === 'direct' || chat.kind === 'help';
  const single =
    dmLike
      ? (chat.members.find((m) => m.profile_id !== me) ?? chat.members[0])
      : chat.members.length <= 1
        ? chat.members[0]
        : null;

  if (dmLike || chat.members.length <= 1) {
    const color = single ? colorFor(single.profile_id) : undefined;
    return (
      <div className="conv-row__avatar" style={color ? { background: color, color: 'var(--bone-warm)' } : undefined}>
        <span>{monogramFor(single?.name ?? chat.title)}</span>
      </div>
    );
  }

  const sample = chat.members.slice(0, 3);
  return (
    <div className="conv-row__group">
      {sample.map((mem, i) => (
        <div
          key={mem.profile_id}
          className="conv-row__group-bub"
          style={{ zIndex: 3 - i, background: colorFor(mem.profile_id) }}
        >
          {monogramFor(mem.name)}
        </div>
      ))}
    </div>
  );
}

// ─── New-message people picker ───────────────────────────────────────────────

interface PickRow { id: string; full_name: string | null; headline: string | null; }

function NewMessage({ me, onClose, onPick }: { me: string; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      let req = supabase.from('profiles').select('id, full_name, headline').neq('id', me).limit(30);
      const term = q.trim();
      if (term) req = req.ilike('full_name', `%${term}%`);
      const { data } = await req;
      if (active) { setRows((data as PickRow[] | null) ?? []); setLoading(false); }
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [q, me]);

  return (
    <div className="picker" role="dialog" aria-modal="true">
      <div className="picker__backdrop" onClick={onClose} />
      <div className="picker__sheet">
        <div className="picker__head">
          <h2 className="picker__title">New message</h2>
          <button className="picker__close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="picker__search">
          <Icon name="search" size={16} />
          <input
            className="picker__search-input"
            placeholder="Search people by name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="picker__list">
          {loading && <p className="picker__hint">Searching…</p>}
          {!loading && rows.length === 0 && <p className="picker__hint">No members found.</p>}
          {rows.map((r) => {
            const name = r.full_name ?? 'Member';
            return (
              <button key={r.id} className="picker__row" onClick={() => onPick(r.id)}>
                <span className="picker__avatar" style={{ background: colorFor(r.id) }}>{monogramFor(name)}</span>
                <span className="picker__row-text">
                  <span className="picker__row-name">{name}</span>
                  {r.headline && <span className="picker__row-sub">{r.headline}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function highlightText(text: string, query?: string): ReactNode {
  if (!query) return text;
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
