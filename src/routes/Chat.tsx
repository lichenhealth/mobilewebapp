import { useMemo, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import {
  CONVERSATIONS,
  MESSAGES,
  USERS,
  lastMessage,
  unreadCount,
  formatRelative,
  Conversation,
  ChatMessage,
} from '../data/chat';
import './Chat.css';

interface SearchHit {
  conversation: Conversation;
  matchedMessage?: ChatMessage;
}

export default function Chat() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const hits: SearchHit[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default order: pinned first, then by last-message time desc
      return CONVERSATIONS
        .map((c) => ({ conversation: c }))
        .sort((a, b) => {
          if (!!b.conversation.pinned !== !!a.conversation.pinned)
            return Number(!!b.conversation.pinned) - Number(!!a.conversation.pinned);
          const la = lastMessage(a.conversation.id)?.ts ?? 0;
          const lb = lastMessage(b.conversation.id)?.ts ?? 0;
          return lb - la;
        });
    }
    const results: SearchHit[] = [];
    for (const c of CONVERSATIONS) {
      // Match against conversation name + handle
      const nameMatch =
        c.name.toLowerCase().includes(q) ||
        (c.handle?.toLowerCase().includes(q) ?? false);
      // Find first message in this conversation matching the query
      const msgMatch = MESSAGES.find(
        (m) => m.conversationId === c.id && m.text.toLowerCase().includes(q)
      );
      if (nameMatch || msgMatch) {
        results.push({ conversation: c, matchedMessage: nameMatch ? undefined : msgMatch });
      }
    }
    return results;
  }, [query]);

  return (
    <div className="chat">
      <header className="chat__head">
        <span className="eyebrow">Chat · {CONVERSATIONS.length} threads</span>
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
          <button
            className="chat__search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="chat__list">
        {hits.length === 0 && (
          <div className="chat__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
            <p className="chat__empty-sub">Try a different word, or a person's name.</p>
          </div>
        )}
        {hits.map(({ conversation, matchedMessage }) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            highlight={query}
            matchedMessage={matchedMessage}
            onClick={() => navigate(`/chat/${conversation.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ConversationRow ────────────────────────────────────────────────
interface RowProps {
  conversation: Conversation;
  highlight?: string;
  matchedMessage?: ChatMessage;
  onClick: () => void;
}

function ConversationRow({ conversation, highlight, matchedMessage, onClick }: RowProps) {
  const last = matchedMessage ?? lastMessage(conversation.id);
  const unread = matchedMessage ? 0 : unreadCount(conversation.id);

  const senderLabel =
    last && conversation.kind === 'group' && last.senderId !== 'me'
      ? USERS[last.senderId]?.name.split(' ')[0] + ': '
      : last?.senderId === 'me'
      ? 'You: '
      : '';

  return (
    <button className={'conv-row' + (unread > 0 ? ' has-unread' : '')} onClick={onClick}>
      <div className="conv-row__avatar-stack">
        {conversation.kind === 'group' ? (
          <GroupAvatar conv={conversation} />
        ) : (
          <div className="conv-row__avatar">
            <span>{conversation.monogram}</span>
          </div>
        )}
      </div>

      <div className="conv-row__body">
        <div className="conv-row__top">
          <span className="conv-row__name">
            {conversation.pinned && (
              <span className="conv-row__pin" aria-label="Pinned">
                <Icon name="pin" size={11} />
              </span>
            )}
            {highlightText(conversation.name, highlight)}
            {conversation.muted && <span className="conv-row__muted">·muted</span>}
          </span>
          <span className="conv-row__time">
            {last ? formatRelative(last.ts) : ''}
          </span>
        </div>
        <div className="conv-row__bottom">
          <span className="conv-row__preview">
            {senderLabel && <span className="conv-row__sender">{senderLabel}</span>}
            {last ? highlightText(last.text, matchedMessage ? highlight : undefined) : <em>No messages yet</em>}
          </span>
          {unread > 0 && <span className="conv-row__unread">{unread}</span>}
        </div>
        {matchedMessage && (
          <p className="conv-row__match-context">
            <Icon name="search" size={10} />
            <span>match in this conversation</span>
          </p>
        )}
      </div>
    </button>
  );
}

// Group avatar: stacked monograms (up to 3)
function GroupAvatar({ conv }: { conv: Conversation }) {
  const sample = conv.memberIds.slice(0, 3);
  return (
    <div className="conv-row__group">
      {sample.map((id, i) => (
        <div
          key={id}
          className="conv-row__group-bub"
          style={{ zIndex: 3 - i, background: USERS[id]?.color ?? '#ccc' }}
        >
          {USERS[id]?.monogram}
        </div>
      ))}
    </div>
  );
}

// Wrap matched text in <mark> for highlighting
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
