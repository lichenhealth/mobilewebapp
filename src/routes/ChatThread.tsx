import { useEffect, useMemo, useRef, useState, RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import {
  CONVERSATIONS,
  USERS,
  messagesFor,
  formatTime,
  ChatMessage,
  Conversation,
  ChatReaction,
} from '../data/chat';
import './ChatThread.css';

const QUICK_REACTIONS = ['❤️', '🙏', '🌱', '✨', '👍', '😂'];

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const conv = useMemo(() => CONVERSATIONS.find((c) => c.id === id), [id]);

  // Local message + reaction state so the chat feels interactive
  const initial = useMemo(() => messagesFor(id), [id]);
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  useEffect(() => { setMessages(messagesFor(id)); }, [id]);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [draft, setDraft] = useState('');
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on mount & whenever new messages arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!conv) {
    return (
      <div className="thread thread--missing">
        <button className="thread__back" onClick={() => navigate('/chat')}>
          <Icon name="arrow-left" size={18} /> Back to chat
        </button>
        <p>That conversation doesn't exist.</p>
      </div>
    );
  }

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const newMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: conv.id,
      senderId: 'me',
      text,
      ts: Date.now(),
      replyToId: replyTo?.id,
    };
    setMessages((m) => [...m, newMsg]);
    setDraft('');
    setReplyTo(null);
  };

  const toggleReaction = (msgId: string, emoji: string) => {
    setMessages((curr) =>
      curr.map((m) => {
        if (m.id !== msgId) return m;
        const list: ChatReaction[] = m.reactions ? [...m.reactions] : [];
        const existing = list.find((r) => r.emoji === emoji);
        if (existing) {
          if (existing.userIds.includes('me')) {
            existing.userIds = existing.userIds.filter((u) => u !== 'me');
          } else {
            existing.userIds = [...existing.userIds, 'me'];
          }
          return { ...m, reactions: list.filter((r) => r.userIds.length > 0) };
        }
        list.push({ emoji, userIds: ['me'] });
        return { ...m, reactions: list };
      })
    );
    setOpenMenuFor(null);
  };

  const startReply = (msg: ChatMessage) => {
    setReplyTo(msg);
    setOpenMenuFor(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Group messages into runs from the same sender within 3 minutes
  const runs = groupRuns(messages);

  return (
    <div className="thread">
      <ChatHeader conversation={conv} onBack={() => navigate('/chat')} />

      <div className="thread__scroll" ref={scrollRef}>
        <ChatIntro conversation={conv} />
        {runs.map((run, i) => (
          <MessageRun
            key={i}
            run={run}
            conversation={conv}
            allMessages={messages}
            onReact={toggleReaction}
            onReply={startReply}
            openMenuFor={openMenuFor}
            setOpenMenuFor={setOpenMenuFor}
          />
        ))}
      </div>

      <ChatInputBar
        draft={draft}
        setDraft={setDraft}
        onSend={sendMessage}
        replyTo={replyTo}
        clearReply={() => setReplyTo(null)}
        inputRef={inputRef}
      />
    </div>
  );
}

// ─── Chat header ────────────────────────────────────────────────────
function ChatHeader({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  return (
    <header className="thread__head">
      <button className="thread__icon" onClick={onBack} aria-label="Back">
        <Icon name="arrow-left" size={18} />
      </button>
      <div className="thread__head-id">
        <div className="thread__head-avatar">
          {conversation.kind === 'group' ? (
            <div className="thread__head-group">
              {conversation.memberIds.slice(0, 3).map((id, i) => (
                <span
                  key={id}
                  style={{ background: USERS[id]?.color, zIndex: 3 - i }}
                >{USERS[id]?.monogram}</span>
              ))}
            </div>
          ) : (
            <span>{conversation.monogram}</span>
          )}
        </div>
        <div className="thread__head-text">
          <h2 className="thread__head-name">{conversation.name}</h2>
          <p className="thread__head-sub">
            {conversation.kind === 'group'
              ? `${conversation.memberIds.length} members`
              : conversation.handle}
          </p>
        </div>
      </div>
      <button className="thread__icon" aria-label="Info">
        <Icon name="info" size={18} />
      </button>
    </header>
  );
}

// ─── Chat intro (above the first message) ───────────────────────────
function ChatIntro({ conversation }: { conversation: Conversation }) {
  return (
    <div className="thread__intro">
      <div className="thread__intro-mark">
        {conversation.kind === 'group' ? (
          <div className="thread__intro-group">
            {conversation.memberIds.slice(0, 4).map((id, i) => (
              <span
                key={id}
                style={{ background: USERS[id]?.color, zIndex: 4 - i }}
              >{USERS[id]?.monogram}</span>
            ))}
          </div>
        ) : (
          <div className="thread__intro-single">{conversation.monogram}</div>
        )}
      </div>
      <h3 className="thread__intro-name">{conversation.name}</h3>
      {conversation.description ? (
        <p className="thread__intro-desc">{conversation.description}</p>
      ) : conversation.handle ? (
        <p className="thread__intro-desc">{conversation.handle}</p>
      ) : null}
      <p className="thread__intro-hint">
        Lichen keeps this conversation between you and trusted members.
        No third-party tracking.
      </p>
    </div>
  );
}

// ─── Message grouping ───────────────────────────────────────────────
interface Run {
  senderId: string;
  messages: ChatMessage[];
}

function groupRuns(msgs: ChatMessage[]): Run[] {
  const runs: Run[] = [];
  for (const m of msgs) {
    const last = runs[runs.length - 1];
    const gap = last ? m.ts - last.messages[last.messages.length - 1].ts : Infinity;
    if (last && last.senderId === m.senderId && gap < 3 * 60_000) {
      last.messages.push(m);
    } else {
      runs.push({ senderId: m.senderId, messages: [m] });
    }
  }
  return runs;
}

// ─── A run of bubbles from the same sender ──────────────────────────
function MessageRun({
  run, conversation, allMessages,
  onReact, onReply, openMenuFor, setOpenMenuFor,
}: {
  run: Run;
  conversation: Conversation;
  allMessages: ChatMessage[];
  onReact: (msgId: string, emoji: string) => void;
  onReply: (msg: ChatMessage) => void;
  openMenuFor: string | null;
  setOpenMenuFor: (id: string | null) => void;
}) {
  const isMe = run.senderId === 'me';
  const sender = USERS[run.senderId];
  const showSender = conversation.kind === 'group' && !isMe;

  return (
    <div className={'msg-run' + (isMe ? ' msg-run--me' : '')}>
      {!isMe && (
        <div className="msg-run__avatar" aria-hidden="true">
          <span style={{ background: sender?.color ?? 'var(--ink-soft)' }}>
            {sender?.monogram}
          </span>
        </div>
      )}
      <div className="msg-run__bubbles">
        {showSender && <p className="msg-run__sender">{sender?.name}</p>}
        {run.messages.map((m, i) => {
          const reply = m.replyToId ? allMessages.find((x) => x.id === m.replyToId) : undefined;
          const isLast = i === run.messages.length - 1;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              replyTo={reply}
              isMe={isMe}
              showTime={isLast}
              menuOpen={openMenuFor === m.id}
              onOpenMenu={() => setOpenMenuFor(openMenuFor === m.id ? null : m.id)}
              onCloseMenu={() => setOpenMenuFor(null)}
              onReact={(emoji) => onReact(m.id, emoji)}
              onReply={() => onReply(m)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── A single message bubble ────────────────────────────────────────
function MessageBubble({
  message, replyTo, isMe, showTime,
  menuOpen, onOpenMenu, onCloseMenu,
  onReact, onReply,
}: {
  message: ChatMessage;
  replyTo?: ChatMessage;
  isMe: boolean;
  showTime: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}) {
  const replyAuthor = replyTo ? USERS[replyTo.senderId] : null;

  return (
    <div className={'bubble-wrap' + (isMe ? ' bubble-wrap--me' : '')}>
      <div className={'bubble' + (isMe ? ' bubble--me' : '')}>
        {replyTo && (
          <div className="bubble__reply">
            <span className="bubble__reply-author">
              {replyAuthor?.id === 'me' ? 'You' : replyAuthor?.name.split(' ')[0]}
            </span>
            <span className="bubble__reply-text">{replyTo.text}</span>
          </div>
        )}
        <p className="bubble__text">{message.text}</p>
        {showTime && (
          <span className="bubble__time">
            {formatTime(message.ts)}
            {isMe && (
              <span className="bubble__check">
                <Icon name="check-double" size={12} />
              </span>
            )}
          </span>
        )}
      </div>

      {message.reactions && message.reactions.length > 0 && (
        <div className="bubble__reactions">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              className={'reaction' + (r.userIds.includes('me') ? ' is-mine' : '')}
              onClick={() => onReact(r.emoji)}
              aria-label={`${r.emoji} ${r.userIds.length}`}
            >
              <span>{r.emoji}</span>
              <span className="reaction__count">{r.userIds.length}</span>
            </button>
          ))}
        </div>
      )}

      <button
        className="bubble__more"
        onClick={onOpenMenu}
        aria-label="Message actions"
      >
        <Icon name="more-horizontal" size={14} />
      </button>

      {menuOpen && (
        <MessageActionMenu
          isMe={isMe}
          onReact={onReact}
          onReply={onReply}
          onClose={onCloseMenu}
        />
      )}
    </div>
  );
}

// ─── Action menu (appears on •••) ───────────────────────────────────
function MessageActionMenu({
  isMe, onReact, onReply, onClose,
}: {
  isMe: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onClose: () => void;
}) {
  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.msg-menu, .bubble__more')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className={'msg-menu' + (isMe ? ' msg-menu--me' : '')}>
      <div className="msg-menu__reactions">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} onClick={() => onReact(e)} className="msg-menu__reaction">
            {e}
          </button>
        ))}
      </div>
      <div className="msg-menu__divider" />
      <button className="msg-menu__action" onClick={onReply}>
        <Icon name="reply" size={14} /> Reply
      </button>
      <button className="msg-menu__action" onClick={onClose}>
        <Icon name="bookmark" size={14} /> Save message
      </button>
      <button className="msg-menu__action" onClick={onClose}>
        <Icon name="info" size={14} /> Message info
      </button>
    </div>
  );
}

// ─── Input bar ──────────────────────────────────────────────────────
function ChatInputBar({
  draft, setDraft, onSend, replyTo, clearReply, inputRef,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSend: () => void;
  replyTo: ChatMessage | null;
  clearReply: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}) {
  // Auto-grow textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }, [draft, inputRef]);

  const canSend = draft.trim().length > 0;
  const replyAuthor = replyTo ? USERS[replyTo.senderId] : null;

  return (
    <div className="thread__input-wrap">
      {replyTo && (
        <div className="thread__reply-preview">
          <Icon name="reply" size={14} />
          <span className="thread__reply-preview-text">
            Replying to{' '}
            <strong>
              {replyAuthor?.id === 'me' ? 'yourself' : replyAuthor?.name.split(' ')[0]}
            </strong>
            : &ldquo;{replyTo.text.slice(0, 80)}{replyTo.text.length > 80 ? '…' : ''}&rdquo;
          </span>
          <button className="thread__reply-close" onClick={clearReply} aria-label="Cancel reply">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <div className="thread__input">
        <button className="thread__input-icon" aria-label="Attach">
          <Icon name="paperclip" size={18} />
        </button>
        <textarea
          ref={inputRef}
          className="thread__input-text"
          placeholder="Write something kind"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
        />
        <button
          className={'thread__send' + (canSend ? ' is-ready' : '')}
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send"
        >
          <Icon name={canSend ? 'arrow-up' : 'mic'} size={16} />
        </button>
      </div>
    </div>
  );
}
