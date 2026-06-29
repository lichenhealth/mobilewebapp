import { useEffect, useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { loadChatList, colorFor, monogramFor, formatRelative, KIND_LABEL, ChatVM } from '../lib/chatApi';
import './Chat.css';

export default function Chat() {
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<ChatVM[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    loadChatList().then((vms) => { if (active) { setChats(vms); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.last?.body.toLowerCase().includes(q) ?? false) ||
      c.members.some((m) => m.name.toLowerCase().includes(q)),
    );
  }, [query, chats]);

  return (
    <div className="chat">
      <header className="chat__head">
        <span className="eyebrow">Chat · {chats.length} {chats.length === 1 ? 'thread' : 'threads'}</span>
        <h1 className="chat__title">
          <span className="display-italic">Messages</span>
        </h1>
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
              Chats appear here automatically for your communities, groups, places, organizations, and care team.
            </p>
          </div>
        )}

        {!loading && chats.length > 0 && hits.length === 0 && (
          <div className="chat__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
            <p className="chat__empty-sub">Try a different word, or a person's name.</p>
          </div>
        )}

        {hits.map((c) => (
          <ConversationRow
            key={c.id}
            chat={c}
            highlight={query}
            onClick={() => navigate(`/chat/${c.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationRow({ chat, highlight, onClick }: { chat: ChatVM; highlight?: string; onClick: () => void }) {
  const last = chat.last;
  const senderName = last
    ? chat.members.find((m) => m.profile_id === last.sender_id)?.name.split(' ')[0]
    : undefined;

  return (
    <button className="conv-row" onClick={onClick}>
      <div className="conv-row__avatar-stack">
        <GroupAvatar chat={chat} />
      </div>
      <div className="conv-row__body">
        <div className="conv-row__top">
          <span className="conv-row__name">
            {highlightText(chat.title, highlight)}
            <span className="conv-row__muted"> ·{KIND_LABEL[chat.kind].toLowerCase()}</span>
          </span>
          <span className="conv-row__time">{last ? formatRelative(last.created_at) : ''}</span>
        </div>
        <div className="conv-row__bottom">
          <span className="conv-row__preview">
            {last
              ? <>{senderName && <span className="conv-row__sender">{senderName}: </span>}{highlightText(last.body, highlight)}</>
              : <em>No messages yet</em>}
          </span>
        </div>
      </div>
    </button>
  );
}

function GroupAvatar({ chat }: { chat: ChatVM }) {
  const sample = chat.members.slice(0, 3);
  if (sample.length <= 1) {
    return (
      <div className="conv-row__avatar">
        <span>{monogramFor(chat.title)}</span>
      </div>
    );
  }
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
