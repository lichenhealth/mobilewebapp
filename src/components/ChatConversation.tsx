import { Fragment, useEffect, useMemo, useRef, useState, RefObject, ChangeEvent } from 'react';
import { Icon } from './Icon';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  MessageRow, MemberInfo, ChatKind, ReactionRow, Attachment, MediaType,
  KIND_LABEL, MESSAGE_COLS, REACTION_EMOJI,
  colorFor, monogramFor, formatTime, dayLabel, chatTitle, otherMember,
  uploadChatMedia, signChatMedia, loadReactions, toggleReaction,
  markChatRead, visitorIdOfKey, helpPartyOrder, CLAUDE_PROFILE_ID, LICHEN_HEALTH_PROFILE_ID, type PartySpace,
} from '../lib/chatApi';
import { EmojiPicker } from './EmojiPicker';
import { loadPost, loadSpaceNames } from '../lib/postsApi';
import Avatar from './Avatar';
import { postOpenPath } from '../lib/feedMapping';
import '../routes/ChatThread.css';

interface ChatInfo { id: string; kind: ChatKind; title: string | null; space_id: string | null; party?: PartySpace; helpMemberId?: string | null; }
interface Pending { type: MediaType; path: string; localUrl: string; }

/** The full chat conversation (header + messages + composer) for one chat.
 *  Self-contained: loads its own data, subscribes to realtime, handles send /
 *  attachments / reactions / replies. Fills its parent (give the parent a bounded
 *  height). Used by the full-screen thread route and the Concierge care tab. */
export default function ChatConversation({
  chatId, me, onBack, showIntro = true, onInfo,
}: {
  chatId: string;
  me: string;
  onBack?: () => void;      // when set, the header shows a back button
  showIntro?: boolean;
  /** Gives the header's info circle a job (e.g. Concierge → Care Team tab). Hidden when absent. */
  onInfo?: () => void;
}) {
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [members, setMembers] = useState<Record<string, MemberInfo>>({});
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const navigate = useNavigate();
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState('');
  // "Chat about this post" (founder 2026-08-17): the card's chat door carries
  // the post here (?about=<id>) and it sits PINNED above the composer as a
  // card — title, who posted it, and when it was posted as a space, WHICH
  // human you're actually writing to (chat is person-to-person; a space
  // can't be in a chat, so the door goes to the person who posted). The
  // member can × it and just talk. While it's there, the first message
  // carries a line naming the post, so the other side has the context too.
  const [params] = useSearchParams();
  const aboutId = params.get('about');
  const [about, setAbout] = useState<{ id: string; title: string; path: string; spaceName: string | null } | null>(null);
  const aboutDone = useRef(false);
  useEffect(() => {
    if (!aboutId || aboutDone.current) return;
    aboutDone.current = true;
    void loadPost(aboutId).then(async (p) => {
      if (!p) return;
      let spaceName: string | null = null;
      if (p.author_space_id) {
        const names = await loadSpaceNames([p.author_space_id]);
        spaceName = names.get(p.author_space_id) ?? null;
      }
      setAbout({ id: p.id, title: p.title || p.body.slice(0, 60), path: postOpenPath(p), spaceName });
    });
  }, [aboutId]);
  // ?draft= — same idea with the words supplied whole (the availability nudge
  // arrives this way): the member still presses send themselves, so whatever
  // lands in the thread is theirs, editable and declinable.
  const draftParam = params.get('draft');
  const draftDone = useRef(false);
  useEffect(() => {
    if (!draftParam || draftDone.current) return;
    draftDone.current = true;
    setDraft(draftParam);
  }, [draftParam]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initial load: chat, members, messages, reactions
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [cRes, mRes, msgRes] = await Promise.all([
        supabase.from('chats').select('id, kind, title, space_id, direct_key, party:spaces!chats_party_space_id_fkey(id, name, avatar_url)').eq('id', chatId).maybeSingle(),
        supabase.from('chat_members').select('profile_id, profiles(full_name, avatar_url)').eq('chat_id', chatId),
        supabase.from('chat_messages').select(MESSAGE_COLS).eq('chat_id', chatId).order('created_at', { ascending: true }),
      ]);
      if (!active) return;
      if (!cRes.data) { setMissing(true); setLoading(false); return; }
      const c = cRes.data as unknown as { id: string; kind: ChatKind; title: string | null; space_id: string | null; direct_key: string | null;
        party: { id: string; name: string; avatar_url: string | null } | null };
      setChat({
        id: c.id, kind: c.kind, title: c.title, space_id: c.space_id,
        party: c.party ? { id: c.party.id, name: c.party.name, avatarUrl: c.party.avatar_url, visitorId: visitorIdOfKey(c.direct_key) } : undefined,
        // A help room is keyed 'help:<member>' — the person being helped.
        helpMemberId: c.kind === 'help' && c.direct_key?.startsWith('help:') ? c.direct_key.slice(5) : null,
      });
      const map: Record<string, MemberInfo> = {};
      for (const r of (mRes.data as { profile_id: string; profiles: { full_name: string | null; avatar_url: string | null } | null }[] | null) ?? []) {
        map[r.profile_id] = {
          profile_id: r.profile_id,
          name: r.profiles?.full_name ?? 'Member',
          avatarUrl: r.profiles?.avatar_url ?? null,
        };
      }
      setMembers(map);
      setMessages(((msgRes.data as MessageRow[] | null) ?? []));
      setReactions(await loadReactions(chatId));
      setLoading(false);
      // Being here IS reading: bump the read cursor + clear this chat's
      // bell notifications (the TopBar updates itself via realtime).
      void markChatRead(chatId);
    })();
    return () => { active = false; };
  }, [chatId]);

  // Realtime: new messages
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
          void markChatRead(chatId);   // still looking — stay caught up
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId]);

  // Realtime: reactions (INSERT + DELETE; needs REPLICA IDENTITY FULL for delete filter)
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`reactions:${chatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_message_reactions', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const r = payload.new as ReactionRow;
            setReactions((cur) => (
              cur.some((x) => x.message_id === r.message_id && x.profile_id === r.profile_id && x.emoji === r.emoji)
                ? cur : [...cur, r]
            ));
          } else if (payload.eventType === 'DELETE') {
            const o = payload.old as ReactionRow;
            setReactions((cur) => cur.filter(
              (x) => !(x.message_id === o.message_id && x.profile_id === o.profile_id && x.emoji === o.emoji),
            ));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId]);

  // Sign any attachment paths we haven't signed yet
  useEffect(() => {
    const need = new Set<string>();
    for (const m of messages) for (const a of m.attachments ?? []) {
      if (!mediaUrls[a.url]) need.add(a.url);
    }
    if (need.size === 0) return;
    let active = true;
    signChatMedia([...need]).then((map) => { if (active) setMediaUrls((cur) => ({ ...cur, ...map })); });
    return () => { active = false; };
  }, [messages, mediaUrls]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const runs = useMemo(() => groupRuns(messages), [messages]);
  const messagesById = useMemo(() => {
    const m: Record<string, MessageRow> = {};
    for (const msg of messages) m[msg.id] = msg;
    return m;
  }, [messages]);
  const reactionsByMessage = useMemo(() => {
    const m: Record<string, ReactionRow[]> = {};
    for (const r of reactions) (m[r.message_id] ??= []).push(r);
    return m;
  }, [reactions]);

  async function addPending(file: Blob, ext: string, type: MediaType) {
    if (!chat) return;
    setUploading(true);
    try {
      const path = await uploadChatMedia(chat.id, file, ext);
      setPending((p) => [...p, { type, path, localUrl: URL.createObjectURL(file) }]);
    } catch (e) {
      console.error('Upload failed', e);
    }
    setUploading(false);
  }

  const sendMessage = async () => {
    const text = draft.trim();
    if ((!text && pending.length === 0 && !about) || !me || !chat || uploading) return;
    const attachments: Attachment[] | null = pending.length
      ? pending.map((p) => ({ type: p.type, url: p.path }))
      : null;
    const reply = replyTo?.id ?? null;
    // The pinned post rides along on the first message, then steps aside.
    const bodyText = about
      ? `About "${about.title}" — ${window.location.origin}${about.path}${text ? `\n\n${text}` : ''}`
      : (text || null);
    setDraft(''); setPending([]); setReplyTo(null); setAbout(null);
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ chat_id: chat.id, sender_id: me, body: bodyText, attachments, reply_to: reply })
      .select(MESSAGE_COLS)
      .single();
    if (!error && data) {
      const row = data as MessageRow;
      setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
    }
  };

  const react = async (messageId: string, emoji: string) => {
    if (!chat || !me) return;
    const mine = (reactionsByMessage[messageId] ?? []).some((r) => r.profile_id === me && r.emoji === emoji);
    setMenuFor(null);
    setReactions((cur) => mine
      ? cur.filter((r) => !(r.message_id === messageId && r.profile_id === me && r.emoji === emoji))
      : [...cur, { message_id: messageId, chat_id: chat.id, profile_id: me, emoji }]);
    try {
      await toggleReaction(chat.id, messageId, emoji, me, !mine);
    } catch (e) { console.error(e); }
  };

  if (missing) {
    return (
      <div className="conv conv--missing">
        {onBack && (
          <button className="thread__back" onClick={onBack}>
            <Icon name="arrow-left" size={18} /> Back
          </button>
        )}
        <p>That conversation doesn't exist, or you're not a member.</p>
      </div>
    );
  }
  if (loading || !chat) {
    return <div className="conv"><p style={{ padding: 24, color: 'var(--ink-faint)' }}>Loading…</p></div>;
  }

  const memberList = Object.values(members);
  const title = chatTitle(chat.kind, chat.title, memberList, me, chat.party);

  return (
    <div className="conv">
      <ChatHeader chat={chat} title={title} members={memberList} me={me} onBack={onBack} onInfo={onInfo} />
      <div className="thread__scroll" ref={scrollRef}>
        {showIntro && <ChatIntro chat={chat} title={title} members={memberList} me={me} />}
        {runs.map((run, i) => {
          const day = new Date(run.messages[0].created_at).toDateString();
          const prevDay = i > 0 ? new Date(runs[i - 1].messages[0].created_at).toDateString() : null;
          return (
            <Fragment key={i}>
              {day !== prevDay && (
                <div className="thread__day">{dayLabel(run.messages[0].created_at)}</div>
              )}
              <MessageRun
                run={run}
                me={me}
                helpMemberId={chat.helpMemberId}
                members={members}
                messagesById={messagesById}
                reactionsByMessage={reactionsByMessage}
                mediaUrls={mediaUrls}
                menuFor={menuFor}
                setMenuFor={setMenuFor}
                onReply={setReplyTo}
                onReact={react}
              />
            </Fragment>
          );
        })}
      </div>
      {about && (
        <div className="thread__about" role="note">
          <button className="thread__about-body" onClick={() => navigate(about.path)} title="Open the post">
            <span className="thread__about-kicker">About this post</span>
            <span className="thread__about-title">{about.title}</span>
            {about.spaceName && (
              <span className="thread__about-who">
                {chat?.kind === 'space_dm'
                  ? <>Posted by {about.spaceName} — {otherMember(Object.values(members), me)?.name ?? 'the steward'} who posted it answers here</>
                  : <>Posted by {about.spaceName} — you&rsquo;re writing to {otherMember(Object.values(members), me)?.name ?? 'the person'} who posted it</>}
              </span>
            )}
          </button>
          <button className="thread__about-x" onClick={() => setAbout(null)} aria-label="Just chat, without the post">×</button>
        </div>
      )}
      <ChatInputBar
        draft={draft} setDraft={setDraft} onSend={sendMessage} inputRef={inputRef}
        pending={pending} onRemovePending={(i) => setPending((p) => p.filter((_, idx) => idx !== i))}
        uploading={uploading} onAttach={addPending}
        replyTo={replyTo} replyName={replyTo ? (members[replyTo.sender_id]?.name ?? 'Member') : ''}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

/** Where this room's identity lives: a DM partner's member profile, or the
 *  space's profile for org/community/group/place rooms. Care-team, event,
 *  and help rooms have no profile page — returns null (no link). */
function profilePathFor(chat: ChatInfo, members: MemberInfo[], me: string): string | null {
  if (chat.kind === 'direct') {
    const other = otherMember(members, me);
    return other ? `/members/${other.profile_id}` : null;
  }
  if (chat.space_id && ['organization', 'community', 'group', 'place'].includes(chat.kind)) {
    return `/spaces/${chat.space_id}`;
  }
  // A conversation WITH a space: the visitor's link goes to the space, the
  // space's admins' link goes to the visitor.
  if (chat.kind === 'space_dm' && chat.party) {
    return chat.party.visitorId === me ? `/spaces/${chat.party.id}` : (chat.party.visitorId ? `/members/${chat.party.visitorId}` : null);
  }
  return null;
}

/** For a space_dm: what the header/intro shows as the counterpart, and the
 *  line under the name. The visitor sees the space's logo wearing the face
 *  of the admin who answers; an admin sees the visitor. */
function spacePartyView(chat: ChatInfo, members: MemberInfo[], me: string): { avatar: React.ReactNode; sub: string } | null {
  if (chat.kind !== 'space_dm' || !chat.party) return null;
  const party = chat.party;
  const iAmVisitor = party.visitorId === me;
  const answerers = members.filter((m) => m.profile_id !== party.visitorId);
  if (iAmVisitor) {
    const one = answerers.length === 1 ? answerers[0] : null;
    return {
      avatar: <Avatar id={party.id} name={party.name} url={party.avatarUrl} size={38}
        stewardFace={one ? { id: one.profile_id, name: one.name, url: one.avatarUrl } : undefined} />,
      sub: one ? `${one.name} answers for ${party.name}` : `${party.name}'s stewards answer here`,
    };
  }
  const visitor = members.find((m) => m.profile_id === party.visitorId);
  return {
    avatar: <Avatar id={visitor?.profile_id ?? 'v'} name={visitor?.name ?? 'Member'} url={visitor?.avatarUrl} size={38} />,
    sub: `Writing to ${party.name} — you answer for it`,
  };
}

function ChatHeader({ chat, title, members, me, onBack, onInfo }: { chat: ChatInfo; title: string; members: MemberInfo[]; me: string; onBack?: () => void; onInfo?: () => void }) {
  const navigate = useNavigate();
  const profilePath = profilePathFor(chat, members, me);
  // Help is no longer DM-shaped: with two possible responders, a message
  // has to say WHO sent it, and the header has to show both faces.
  const isDirect = chat.kind === 'direct';
  const other = otherMember(members, me);
  const partyView = spacePartyView(chat, members, me);
  return (
    <header className="thread__head">
      {onBack ? (
        <button className="thread__icon" onClick={onBack} aria-label="Back">
          <Icon name="arrow-left" size={18} />
        </button>
      ) : (
        <span className="thread__icon-spacer" aria-hidden="true" />
      )}
      <div
        className={'thread__head-id' + (profilePath ? ' thread__head-id--link' : '')}
        onClick={profilePath ? () => navigate(profilePath) : undefined}
        role={profilePath ? 'link' : undefined}
        tabIndex={profilePath ? 0 : undefined}
        onKeyDown={profilePath ? (e) => { if (e.key === 'Enter') navigate(profilePath); } : undefined}
      >
        <div className="thread__head-avatar">
          {partyView ? (
            <div className="thread__head-party">{partyView.avatar}</div>
          ) : chat.kind === 'help' ? (
            /* All three parties, tiered lower→higher like the inbox stacks
               (founder 2026-08-19: the single brain read flat; the intro
               keeps its side-by-side row). Fixed order: member, orange, blue. */
            <div className="thread__head-help" aria-hidden>
              {helpPartyOrder(members).slice(0, 3).map((mem, i) => (
                mem.avatarUrl
                  ? <img key={mem.profile_id} src={mem.avatarUrl} alt="" style={{ zIndex: i + 1 }} />
                  : <span key={mem.profile_id} style={{ background: colorFor(mem.profile_id), zIndex: i + 1 }}>{monogramFor(mem.name)}</span>
              ))}
            </div>
          ) : (isDirect || members.filter((m) => m.profile_id !== me).length === 1) && other ? (
            <div className="thread__head-party">
              <Avatar id={other.profile_id} name={other.name} url={other.avatarUrl} size={38} />
            </div>
          ) : (
            <div className="thread__head-group">
              {/* THE FACES YOU'RE TALKING TO (founder 2026-08-16): use real
                  avatars when they exist — a help room's whole point is
                  seeing that both Lichen Health and the assistant are here,
                  and monogram discs couldn't show that. Your OWN face is
                  dropped: you're in every chat you can see, so it carries no
                  information and costs a slot. */}
              {members.filter((m) => m.profile_id !== me).slice(0, 3).map((mem, i) => (
                mem.avatarUrl
                  ? <img key={mem.profile_id} src={mem.avatarUrl} alt="" style={{ zIndex: 3 - i }} />
                  : (
                    <span key={mem.profile_id} style={{ background: colorFor(mem.profile_id), zIndex: 3 - i }}>
                      {monogramFor(mem.name)}
                    </span>
                  )
              ))}
            </div>
          )}
        </div>
        <div className="thread__head-text">
          <h2 className="thread__head-name">{title}</h2>
          <p className="thread__head-sub">
            {partyView ? partyView.sub : chat.kind === 'help' ? 'Lichen help' : isDirect ? 'Direct message' : `${KIND_LABEL[chat.kind]} · ${members.length} ${members.length === 1 ? 'member' : 'members'}`}
          </p>
        </div>
      </div>
      {onInfo && (
        <button className="thread__icon" aria-label="Info" onClick={onInfo}>
          <Icon name="info" size={18} />
        </button>
      )}
    </header>
  );
}

function ChatIntro({ chat, title, members, me }: { chat: ChatInfo; title: string; members: MemberInfo[]; me: string }) {
  const navigate = useNavigate();
  // Help is no longer DM-shaped: with two possible responders, a message
  // has to say WHO sent it, and the header has to show both faces.
  const isDirect = chat.kind === 'direct';
  const other = otherMember(members, me);
  const profilePath = profilePathFor(chat, members, me);
  const partyView = spacePartyView(chat, members, me);
  return (
    <div className="thread__intro">
      <div
        className={'thread__intro-mark' + (profilePath ? ' thread__intro-mark--link' : '')}
        onClick={profilePath ? () => navigate(profilePath) : undefined}
        role={profilePath ? 'link' : undefined}
        tabIndex={profilePath ? 0 : undefined}
      >
        {partyView ? (
          <div className="thread__intro-party">{partyView.avatar}</div>
        ) : chat.kind === 'help' ? (
          /* Every party, side by side and legible — not a clump (founder
             2026-08-18: "move the 3 profile icons out farther"). */
          <div className="thread__intro-row">
            {helpPartyOrder(members).slice(0, 4).map((mem) => (
              <Avatar key={mem.profile_id} id={mem.profile_id} name={mem.name} url={mem.avatarUrl} size={52} />
            ))}
          </div>
        ) : (isDirect || members.filter((m) => m.profile_id !== me).length === 1) && other ? (
          <div className="thread__intro-party">
            <Avatar id={other.profile_id} name={other.name} url={other.avatarUrl} size={64} />
          </div>
        ) : (
          <div className="thread__intro-group">
            {/* Same rule as the header: real faces, and not your own — this
                mark is the first thing you see in an empty room, so it should
                show WHO is waiting for you. */}
            {members.filter((m) => m.profile_id !== me).slice(0, 4).map((mem, i) => (
              mem.avatarUrl
                ? <img key={mem.profile_id} src={mem.avatarUrl} alt="" style={{ zIndex: 4 - i }} />
                : (
                  <span key={mem.profile_id} style={{ background: colorFor(mem.profile_id), zIndex: 4 - i }}>
                    {monogramFor(mem.name)}
                  </span>
                )
            ))}
          </div>
        )}
      </div>
      <h3 className="thread__intro-name">{title}</h3>
      {/* A help room says who's in it and what they're for (founder
          2026-08-16) — the two intelligences, and that feedback is welcome
          rather than merely tolerated. */}
      {chat.kind === 'help' ? (
        <p className="thread__intro-desc">
          Claude <em>(Lichen Builder)</em> and Galyn <em>(Lichen Architect)</em> are both here —
          to help you use the platform, and to make it better with what you tell us.
        </p>
      ) : (
        <p className="thread__intro-desc">{partyView ? partyView.sub : isDirect ? 'Direct message' : `${KIND_LABEL[chat.kind]} chat`}</p>
      )}
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
    // A reply starts its own run so its quoted context reads clearly.
    if (last && last.senderId === m.sender_id && gap < 3 * 60_000 && !m.reply_to) last.messages.push(m);
    else runs.push({ senderId: m.sender_id, messages: [m] });
  }
  return runs;
}

function MessageRun({
  run, me, members, messagesById, reactionsByMessage, mediaUrls, menuFor, setMenuFor, onReply, onReact, helpMemberId,
}: {
  run: Run;
  me: string;
  /** Set in a help room: the person being helped (from the room's key). */
  helpMemberId?: string | null;
  members: Record<string, MemberInfo>;
  messagesById: Record<string, MessageRow>;
  reactionsByMessage: Record<string, ReactionRow[]>;
  mediaUrls: Record<string, string>;
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  onReply: (m: MessageRow) => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const navigate = useNavigate();
  const isMe = run.senderId === me;
  const sender = members[run.senderId];
  const showSender = !isMe;
  const openSender = () => navigate(`/members/${run.senderId}`);
  // THE HUMAN BEHIND THE ORANGE ICON (founder 2026-08-18): in a help room,
  // a person answering who isn't the member being helped, Lichen Health
  // itself, or Claude is a steward — their face wears a peach ring and a
  // small heart, the cue that they speak for Lichen Help.
  const steward = helpMemberId !== undefined && helpMemberId !== null
    && run.senderId !== helpMemberId && run.senderId !== CLAUDE_PROFILE_ID && run.senderId !== LICHEN_HEALTH_PROFILE_ID;

  return (
    <div className={'msg-run' + (isMe ? ' msg-run--me' : '')}>
      {!isMe && (
        <button className={'msg-run__avatar msg-run__avatar--link' + (steward ? ' msg-run__avatar--steward' : '')} onClick={openSender}
          aria-label={`${sender?.name ?? 'Member'}'s profile`} title={steward ? `${sender?.name ?? 'A steward'} — answering for Lichen Health` : undefined}>
          <Avatar id={run.senderId} name={sender?.name ?? '?'} url={sender?.avatarUrl} size={28} />
          {steward && <span className="msg-run__steward-mark" aria-hidden><Icon name="heart-line" size={9} /></span>}
        </button>
      )}
      <div className="msg-run__bubbles">
        {showSender && (
          <p className="msg-run__sender">
            <button className="msg-run__sender-link" onClick={openSender}>{sender?.name ?? 'Member'}</button>
          </p>
        )}
        {run.messages.map((m, i) => {
          const quoted = m.reply_to ? messagesById[m.reply_to] : undefined;
          const rx = reactionsByMessage[m.id] ?? [];
          return (
            <div key={m.id} className={'bubble-wrap' + (isMe ? ' bubble-wrap--me' : '')}>
              <div className={'bubble' + (isMe ? ' bubble--me' : '')}>
                {m.reply_to && (
                  <div className="bubble__reply">
                    <span className="bubble__reply-author">
                      {quoted ? (members[quoted.sender_id]?.name ?? 'Member') : 'Message'}
                    </span>
                    <span className="bubble__reply-text">
                      {quoted ? quotedPreview(quoted) : 'unavailable'}
                    </span>
                  </div>
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="bubble__media">
                    {m.attachments.map((a, k) => (
                      <MediaItem key={k} attachment={a} url={mediaUrls[a.url]} />
                    ))}
                  </div>
                )}
                {m.body && <p className="bubble__text">{m.body}</p>}
                {i === run.messages.length - 1 && (
                  <span className="bubble__time">
                    {formatTime(m.created_at)}
                    {isMe && <span className="bubble__check"><Icon name="check" size={12} /></span>}
                  </span>
                )}
              </div>

              {rx.length > 0 && (
                <div className="bubble__reactions">
                  {groupReactions(rx, me).map((g) => (
                    <button
                      key={g.emoji}
                      className={'reaction' + (g.mine ? ' is-mine' : '')}
                      onClick={() => onReact(m.id, g.emoji)}
                    >
                      <span>{g.emoji}</span>
                      {g.count > 1 && <span className="reaction__count">{g.count}</span>}
                    </button>
                  ))}
                </div>
              )}

              <button
                className="bubble__more"
                aria-label="Message actions"
                onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
              >
                <Icon name="more-horizontal" size={14} />
              </button>

              {menuFor === m.id && (
                <div className={'msg-menu' + (isMe ? ' msg-menu--me' : '')}>
                  <div className="msg-menu__reactions">
                    {REACTION_EMOJI.map((e) => (
                      <button key={e} className="msg-menu__reaction" onClick={() => onReact(m.id, e)}>{e}</button>
                    ))}
                  </div>
                  <div className="msg-menu__divider" />
                  <button className="msg-menu__action" onClick={() => { onReply(m); setMenuFor(null); }}>
                    <Icon name="reply" size={16} /> Reply
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MediaItem({ attachment, url }: { attachment: Attachment; url?: string }) {
  if (!url) return <div className="bubble__media-loading" aria-hidden="true" />;
  if (attachment.type === 'photo') return <img className="bubble__media-img" src={url} alt="" />;
  if (attachment.type === 'video') return <video className="bubble__media-vid" src={url} controls playsInline />;
  return <audio className="bubble__media-aud" src={url} controls />;
}

function quotedPreview(m: MessageRow): string {
  if (m.body && m.body.trim()) return m.body;
  const a = m.attachments;
  if (a && a.length) return a[0].type === 'photo' ? '📎 Photo' : a[0].type === 'video' ? '📎 Video' : '📎 Audio';
  return '';
}

interface ReactionGroup { emoji: string; count: number; mine: boolean; }
function groupReactions(rx: ReactionRow[], me: string): ReactionGroup[] {
  const byEmoji = new Map<string, ReactionGroup>();
  for (const r of rx) {
    const g = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.profile_id === me) g.mine = true;
    byEmoji.set(r.emoji, g);
  }
  return [...byEmoji.values()];
}

function ChatInputBar({
  draft, setDraft, onSend, inputRef, pending, onRemovePending, uploading, onAttach,
  replyTo, replyName, onCancelReply,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  pending: Pending[];
  onRemovePending: (i: number) => void;
  uploading: boolean;
  onAttach: (file: Blob, ext: string, type: MediaType) => void;
  replyTo: MessageRow | null;
  replyName: string;
  onCancelReply: () => void;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(120, el.scrollHeight) + 'px';
  }, [draft, inputRef]);

  function onFile(e: ChangeEvent<HTMLInputElement>, type: MediaType) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop() || (type === 'photo' ? 'jpg' : 'mp4');
    onAttach(file, ext, type);
    setAttachOpen(false);
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onAttach(new Blob(chunksRef.current, { type: 'audio/webm' }), 'webm', 'audio');
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setAttachOpen(false);
    } catch (e) {
      console.error('Mic unavailable', e);
    }
  }

  const canSend = (draft.trim().length > 0 || pending.length > 0) && !uploading;

  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    // Re-focus after React re-renders so the caret lands after the emoji.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function send() {
    setEmojiOpen(false);
    onSend();
  }

  return (
    <div className="thread__input-wrap">
      {replyTo && (
        <div className="thread__reply-preview">
          <Icon name="reply" size={14} />
          <span className="thread__reply-preview-text">
            Replying to <strong>{replyName}</strong> · {quotedPreview(replyTo)}
          </span>
          <button className="thread__reply-close" onClick={onCancelReply} aria-label="Cancel reply">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {(pending.length > 0 || uploading) && (
        <div className="thread__attach-tray">
          {pending.map((p, i) => (
            <div className="thread__attach" key={i}>
              {p.type === 'photo' ? <img src={p.localUrl} alt="" />
                : p.type === 'video' ? <video src={p.localUrl} muted />
                : <span className="thread__attach-aud"><Icon name="mic" size={16} /></span>}
              <button className="thread__attach-remove" onClick={() => onRemovePending(i)} aria-label="Remove">×</button>
            </div>
          ))}
          {uploading && <span className="thread__attach-uploading">Uploading…</span>}
        </div>
      )}

      <div className="thread__input">
        <div className="thread__attach-wrap">
          <button className="thread__input-icon" aria-label="Attach" onClick={() => { setEmojiOpen(false); setAttachOpen((o) => !o); }}>
            <Icon name="paperclip" size={18} />
          </button>
          {attachOpen && (
            <div className="thread__attach-menu">
              <button onClick={() => photoRef.current?.click()}><Icon name="image" size={16} /> Photo</button>
              <button onClick={() => videoRef.current?.click()}><Icon name="video" size={16} /> Video</button>
              <button className={recording ? 'is-recording' : ''} onClick={toggleRecord}>
                <Icon name="mic" size={16} /> {recording ? 'Stop' : 'Audio'}
              </button>
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'photo')} />
          <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => onFile(e, 'video')} />
        </div>
        <div className="thread__emoji-wrap">
          <button
            className={'thread__input-icon' + (emojiOpen ? ' is-active' : '')}
            aria-label="Emoji"
            onClick={() => { setAttachOpen(false); setEmojiOpen((o) => !o); }}
          >
            <Icon name="smile" size={18} />
          </button>
          {emojiOpen && <EmojiPicker onPick={insertEmoji} />}
        </div>
        <textarea
          ref={inputRef}
          className="thread__input-text"
          placeholder="Write something kind"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          rows={1}
        />
        <button
          className={'thread__send' + (canSend ? ' is-ready' : '')}
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
        >
          <Icon name={canSend ? 'arrow-up' : 'mic'} size={16} />
        </button>
      </div>
    </div>
  );
}
