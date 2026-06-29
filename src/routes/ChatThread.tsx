import { useEffect, useMemo, useRef, useState, RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import {
  MessageRow, MemberInfo, ChatKind, KIND_LABEL,
  colorFor, monogramFor, formatTime,
} from '../lib/chatApi';
import './ChatThread.css';

interface ChatInfo { id: string; kind: ChatKind; title: string; }

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [members, setMembers] = useState<Record<string, MemberInfo>>({});
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initial load: chat, members, messages
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [cRes, mRes, msgRes] = await Promise.all([
        supabase.from('chats').select('id, kind, title').eq('id', id).maybeSingle(),
        supabase.from('chat_members').select('profile_id, profiles(full_name)').eq('chat_id', id),
        supabase.from('chat_messages').select('id, chat_id, sender_id, body, created_at').eq('chat_id', id).order('created_at', { ascending: true }),
      ]);
      if (!active) return;
      if (!cRes.data) { setMissing(true); setLoading(false); return; }
      const c = cRes.data as { id: string; kind: ChatKind; title: string | null };
      setChat({ id: c.id, kind: c.kind, title: c.title ?? KIND_LABEL[c.kind] });
      const map: Record<string, MemberInfo> = {};
      for (const r of (mRes.data as { profile_id: string; profiles: { full_name: string | null } | null }[] | null) ?? []) {
        map[r.profile_id] = { profile_id: r.profile_id, name: r.profiles?.full_name ?? 'Member' };
      }
      setMembers(map);
      setMessages(((msgRes.data as MessageRow[] | null) ?? []));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id]);

  // Realtime: append new messages as they arrive (dedupe by id)
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`chat:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${id}` },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const runs = useMemo(() => groupRuns(messages), [messages]);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || !me || !chat) return;
    setDraft('');
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ chat_id: chat.id, sender_id: me, body: text })
      .select('id, chat_id, sender_id, body, created_at')
      .single();
    if (!error && data) {
      const row = data as MessageRow;
      setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
    }
  };

  if (missing) {
    return (
      <div className="thread thread--missing">
        <button className="thread__back" onClick={() => navigate('/chat')}>
          <Icon name="arrow-left" size={18} /> Back to chat
        </button>
        <p>That conversation doesn't exist, or you're not a member.</p>
      </div>
    );
  }
  if (loading || !chat) {
    return <div className="thread"><p style={{ padding: 24, color: 'var(--ink-faint)' }}>Loading…</p></div>;
  }

  const memberList = Object.values(members);

  return (
    <div className="thread">
      <ChatHeader chat={chat} members={memberList} onBack={() => navigate('/chat')} />
      <div className="thread__scroll" ref={scrollRef}>
        <ChatIntro chat={chat} members={memberList} />
        {runs.map((run, i) => (
          <MessageRun key={i} run={run} me={me} members={members} />
        ))}
      </div>
      <ChatInputBar draft={draft} setDraft={setDraft} onSend={sendMessage} inputRef={inputRef} />
    </div>
  );
}

function ChatHeader({ chat, members, onBack }: { chat: ChatInfo; members: MemberInfo[]; onBack: () => void }) {
  return (
    <header className="thread__head">
      <button className="thread__icon" onClick={onBack} aria-label="Back">
        <Icon name="arrow-left" size={18} />
      </button>
      <div className="thread__head-id">
        <div className="thread__head-avatar">
          <div className="thread__head-group">
            {members.slice(0, 3).map((mem, i) => (
              <span key={mem.profile_id} style={{ background: colorFor(mem.profile_id), zIndex: 3 - i }}>
                {monogramFor(mem.name)}
              </span>
            ))}
          </div>
        </div>
        <div className="thread__head-text">
          <h2 className="thread__head-name">{chat.title}</h2>
          <p className="thread__head-sub">
            {KIND_LABEL[chat.kind]} · {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
      </div>
      <button className="thread__icon" aria-label="Info">
        <Icon name="info" size={18} />
      </button>
    </header>
  );
}

function ChatIntro({ chat, members }: { chat: ChatInfo; members: MemberInfo[] }) {
  return (
    <div className="thread__intro">
      <div className="thread__intro-mark">
        <div className="thread__intro-group">
          {members.slice(0, 4).map((mem, i) => (
            <span key={mem.profile_id} style={{ background: colorFor(mem.profile_id), zIndex: 4 - i }}>
              {monogramFor(mem.name)}
            </span>
          ))}
        </div>
      </div>
      <h3 className="thread__intro-name">{chat.title}</h3>
      <p className="thread__intro-desc">{KIND_LABEL[chat.kind]} chat</p>
      <p className="thread__intro-hint">
        Lichen keeps this conversation between members. No third-party tracking.
      </p>
    </div>
  );
}

interface Run { senderId: string; messages: MessageRow[]; }

function groupRuns(msgs: MessageRow[]): Run[] {
  const runs: Run[] = [];
  for (const m of msgs) {
    const last = runs[runs.length - 1];
    const gap = last
      ? new Date(m.created_at).getTime() - new Date(last.messages[last.messages.length - 1].created_at).getTime()
      : Infinity;
    if (last && last.senderId === m.sender_id && gap < 3 * 60_000) last.messages.push(m);
    else runs.push({ senderId: m.sender_id, messages: [m] });
  }
  return runs;
}

function MessageRun({ run, me, members }: { run: Run; me: string; members: Record<string, MemberInfo> }) {
  const isMe = run.senderId === me;
  const sender = members[run.senderId];
  const showSender = !isMe;

  return (
    <div className={'msg-run' + (isMe ? ' msg-run--me' : '')}>
      {!isMe && (
        <div className="msg-run__avatar" aria-hidden="true">
          <span style={{ background: colorFor(run.senderId) }}>{monogramFor(sender?.name ?? '?')}</span>
        </div>
      )}
      <div className="msg-run__bubbles">
        {showSender && <p className="msg-run__sender">{sender?.name ?? 'Member'}</p>}
        {run.messages.map((m, i) => (
          <div key={m.id} className={'bubble-wrap' + (isMe ? ' bubble-wrap--me' : '')}>
            <div className={'bubble' + (isMe ? ' bubble--me' : '')}>
              <p className="bubble__text">{m.body}</p>
              {i === run.messages.length - 1 && (
                <span className="bubble__time">
                  {formatTime(m.created_at)}
                  {isMe && <span className="bubble__check"><Icon name="check-double" size={12} /></span>}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatInputBar({
  draft, setDraft, onSend, inputRef,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }, [draft, inputRef]);

  const canSend = draft.trim().length > 0;

  return (
    <div className="thread__input-wrap">
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
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
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
