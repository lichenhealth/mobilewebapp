import FilterRow from '../components/FilterRow';
import { useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTopBackFor } from '../lib/topBack';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import {
  loadChatList, loadUnreadCounts, ensureDirectChat, messagePreview,
  colorFor, monogramFor, formatRelative, KIND_LABEL, ChatVM, LICHEN_HEALTH_PROFILE_ID,
} from '../lib/chatApi';
import './Chat.css';
import { searchMessages, type MessageHit } from '../lib/chatApi';
import AssistantDoor from '../components/AssistantDoor';
import ChatConversation from '../components/ChatConversation';
import { mailEnabled, listMailAccounts, loadInbox, senderName as mailSender, type ThreadSummary } from '../lib/mailApi';
import '../components/IconRow.css';

export default function Chat() {
  const [query, setQuery] = useState('');
  // Search opens on press (founder 2026-10-06, "when you press search, it
  // opens a search tab") — the standing full-width bar is gone.
  const [searchOpen, setSearchOpen] = useState(false);
  const [chats, setChats] = useState<ChatVM[]>([]);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  // Desktop split-view: open a conversation beside the list instead of
  // navigating away to the mobile full-page thread. `?open=` keeps it
  // linkable/refreshable; below 1024px this stays unset and rows just
  // navigate to /chat/:id (ChatThread) as before.
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('open') || undefined,
  );
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
  // ACTING AS A SPACE, THIS IS THE SPACE'S INBOX (founder 2026-08-19:
  // "I don't just want to be the Help center for that space, I want to be
  // its identity"). The list REPLACES your personal one: the space's own
  // member room plus every conversation where the space is the party —
  // all the ways people have engaged it. Your own life is one toggle away.
  // ⚠ Wait for `ready` (the acting-as rule): until the persisted hat has
  // restored, the actor reads as the boot default "self" — scoping the
  // inbox on it would show a space's steward their personal inbox for a
  // beat (or worse, if the restore is retrying) and swap it underneath.
  const { actor, ready: actingReady } = useActing();
  const asSpace = actor.type === 'space' ? actor.id : undefined;
  const spaceName = actor.type === 'space' ? actor.name : '';

  // AN EMAIL OPENS BESIDE THE LIST TOO (founder 2026-11-17: "if I want to
  // see an email; have email selected as the filter on the left on
  // desktop"): ?mail=<account>:<thread> opens that thread in the pane, the
  // Email lens lit — the same shape a chat click-through takes.
  const [mailOpen, setMailOpen] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('mail') || undefined,
  );
  function openMail(key: string) {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setMailOpen(key); setSelectedId(undefined);
      const url = new URL(window.location.href);
      url.searchParams.set('mail', key); url.searchParams.delete('open');
      window.history.replaceState(null, '', url);
    } else {
      navigate(`/mail?thread=${encodeURIComponent(key)}`);
    }
  }
  function closeMail() {
    setMailOpen(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('mail');
    window.history.replaceState(null, '', url);
  }
  function openChat(id: string) {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSelectedId(id); setMailOpen(undefined);
      const url = new URL(window.location.href);
      url.searchParams.set('open', id); url.searchParams.delete('mail');
      window.history.replaceState(null, '', url);
    } else {
      navigate(`/chat/${id}`);
    }
  }
  function closeThread() {
    // A conversation reached FROM somewhere (a course's cohort chat, say)
    // closes back to there, not to the inbox — same `?from=` doctrine as
    // ChatThread's back button (founder 2026-08-15).
    const from = new URLSearchParams(window.location.search).get('from');
    if (from && from.startsWith('/')) { navigate(from); return; }
    setSelectedId(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    window.history.replaceState(null, '', url);
  }

  useEffect(() => {
    if (!me) return;
    let active = true;
    loadChatList(me).then((vms) => { if (active) { setChats(vms); setLoading(false); } });
    loadUnreadCounts().then((m) => { if (active) setUnread(m); });
    return () => { active = false; };
  }, [me]);

  const scoped = useMemo(() => (
    asSpace
      ? chats.filter((c) => c.spaceId === asSpace || c.party?.id === asSpace)
      : chats
  ), [chats, asSpace]);

  // THE MEDIUM LENSES (founder 2026-11-14: "an icon that shows mail, phone
  // and chat bubble, then just chat, then just phone, then just mail… by
  // default the all is selected and when you select one of the filters, it
  // de-selects the all"): [] = All. Multi-select; picking all three is All.
  // A CLICK-THROUGH PICKS ITS LENS (founder 2026-11-17: "when I click thru
  // to a chat from, say the brain… have it smart select to chats but bring
  // up the chat in question"): arriving with a chat open lights Chat;
  // arriving with an email open lights Email. Arrival only — a click on a
  // row inside the inbox never changes the lens the member chose.
  const [chanPick, setChan] = useState<Medium[]>(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get('mail') ? ['mail'] : q.get('open') ? ['chat'] : [];
  });
  // CHAT, NESTED UNDER INBOX (founder 2026-11-14: "chat arrow should open
  // chat as we used to have it...its just nested under inbox now"): the lit
  // Chat lens's › tab opens /chat?only=chat — the classic chat-only view,
  // titled Chat, no medium lenses, the TopBar ← walking back to the Inbox.
  const [sp] = useSearchParams();
  const chatOnly = sp.get('only') === 'chat';
  const chan: Medium[] = chatOnly ? ['chat'] : chanPick;
  useTopBackFor(() => navigate('/chat'), chatOnly);
  const pickChan = (m: Medium | 'all') => {
    if (m === 'all') { setChan([]); return; }
    setChan((cur) => {
      const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
      return next.length === MEDIA.length ? [] : next;
    });
  };
  const shows = (m: Medium) => chan.length === 0 || chan.includes(m);
  // Mail rides along for members who've connected inboxes (Lichen Mail — a
  // personal test today). Read live from Google; Lichen stores no content.
  const [mailRows, setMailRows] = useState<ThreadSummary[]>([]);
  const [mailState, setMailState] = useState<'off' | 'none' | 'ok' | 'err' | 'loading'>('loading');
  useEffect(() => {
    if (!me || !actingReady || asSpace) { setMailState('off'); return; }
    let live = true;
    void (async () => {
      if (!(await mailEnabled(me))) { if (live) setMailState('off'); return; }
      const accts = await listMailAccounts();
      if (!accts.length) { if (live) setMailState('none'); return; }
      try {
        const r = await loadInbox([], '');
        if (live) { setMailRows(r.threads); setMailState('ok'); }
      } catch { if (live) setMailState('err'); }
    })();
    return () => { live = false; };
  }, [me, actingReady, asSpace]);

  // THE INBOX TABS (founder 2026-11-14: "organized by person, group,
  // community, place, organization… kinda like gmail tabs"): every
  // conversation files under WHO it's with — a DM or help room under People,
  // a space's room (or a conversation where a space is the party) under that
  // space's kind. Tabs are presence-gated: only kinds you actually have show.
  const [tab, setTab] = useState('All');
  const scopedTabs = useMemo(() => {
    if (asSpace) return [] as string[];
    const have = new Set(scoped.map(inboxGroupOf));
    if (mailRows.length) have.add('People');
    const t = INBOX_TABS.filter((x) => have.has(x));
    return t.length > 1 ? ['All', ...t] : [];
  }, [scoped, asSpace]);
  const tabbed = useMemo(() => (
    tab === 'All' || !scopedTabs.includes(tab) ? scoped : scoped.filter((c) => inboxGroupOf(c) === tab)
  ), [scoped, tab, scopedTabs]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabbed;
    return tabbed.filter((c) =>
      c.title.toLowerCase().includes(q) ||
      (c.last?.body?.toLowerCase().includes(q) ?? false) ||
      c.members.some((m) => m.name.toLowerCase().includes(q)),
    );
  }, [query, tabbed]);

  // ALL = every correspondence in time order, each row wearing its medium
  // (founder: "so people can see the interplay of medium and message").
  type Item = { key: string; t: string; chat?: ChatVM; mail?: ThreadSummary };
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (shows('chat')) {
      for (const c of hits) {
        if (c.kind === 'help' && c.helpMemberId && c.helpMemberId !== me) continue;
        out.push({ key: 'c:' + c.id, t: c.last?.created_at ?? '', chat: c });
      }
    }
    const tabOk = tab === 'All' || tab === 'People' || !scopedTabs.includes(tab);
    if (shows('mail') && tabOk) {
      const q = query.trim().toLowerCase();
      for (const m of mailRows) {
        if (q && !(`${m.from} ${m.subject} ${m.snippet}`.toLowerCase().includes(q))) continue;
        out.push({ key: 'm:' + m.account_id + ':' + m.thread_id, t: m.date ? new Date(m.date).toISOString() : '', mail: m });
      }
    }
    return out.sort((a, b) => (b.t > a.t ? 1 : b.t < a.t ? -1 : 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, mailRows, chan, tab, scopedTabs, query, me]);

  // THE PANE IS NEVER EMPTY ON DESKTOP (founder 2026-11-14: "auto select the
  // top convo and show it on the right, so there's always content in the
  // box"): once per visit, the newest chat opens beside the list. Once —
  // closing the pane stays closed.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || selectedId || mailOpen || loading || !actingReady) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const first = items.find((it) => it.chat)?.chat;
    if (!first) return;
    autoOpened.current = true;
    openChat(first.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId, mailOpen, loading, actingReady]);

  return (
    <div className="chat">
      <div className="chat__list-pane">
      {/* THE SECTION-LANDING HEAD, CENTERED UNDER THE MARK (founder
          2026-10-12: "the messages detail should be under the message icon,
          why is it to the left?" — Drive's .myc__head grammar, the same
          centered title + explanation /currentcy adopted). */}
      <header className="myc__head chat__headc">
        <h1 className="myc__title"><span className="display-italic">{chatOnly ? 'Chat' : 'Inbox'}</span></h1>
        <p className="myc__sub">
          {asSpace ? `${spaceName} · ` : ''}{scoped.length} {scoped.length === 1 ? 'thread' : 'threads'}
        </p>
      </header>

      {/* AI BRAIN CONSISTENCY (founder 2026-10-06: "The search and brain
          should be top, left in chat") — the platform's doors grammar, and
          since 2026-10-12 the + sits WITH them ("For consistency in chat,
          let's have the plus be like it is everywhere else" — search · + ·
          brain, Home's order; a space still doesn't start DMs). */}
      <div className="chat__tools">
        <button
          className={'chat__tool-circle' + (searchOpen ? ' is-on' : '')}
          onClick={() => setSearchOpen((o) => { if (o) setQuery(''); return !o; })}
          aria-label="Search messages and people" data-tip="Search"
          aria-expanded={searchOpen}
        >
          <Icon name="search" size={15} />
        </button>
        {!asSpace && (
          <button className="chat__tool-circle" onClick={() => setPicking(true)} aria-label="New message" data-tip="New message">
            <Icon name="plus" size={15} />
          </button>
        )}
        <AssistantDoor section="chat" label="Your assistant — who's waiting on you" />
        {!asSpace && !chatOnly && (
          <div className="chat__media" role="group" aria-label="Show by medium">
            <button className={'chat__lens' + (chan.length === 0 ? ' is-on' : '')} onClick={() => pickChan('all')}
              aria-pressed={chan.length === 0} aria-label="All correspondence" data-tip="All">
              <Icon name="inbox" size={17} />
            </button>
            {MEDIA.map((m) => {
              const lens = (
                <button key={m} className={'chat__lens' + (chan.includes(m) ? ' is-on' : '') + (m === 'mail' ? ' tip-right' : '')}
                  onClick={() => pickChan(m)} aria-pressed={chan.includes(m)} aria-label={MEDIUM_LABEL[m]} data-tip={MEDIUM_LABEL[m]}>
                  <Icon name={MEDIUM_ICON[m]} size={16} />
                </button>
              );
              /* THE CIRCLE RULE (founder 2026-11-14): a lit medium lens grows
                 the peach › tab that walks into its own home — Email → Mail.
                 Chat's home IS this inbox, and texts have no home yet, so
                 they stay plain filters. */
              // Email → your consolidated Mail (shown to everyone: non-testers
              // land on Mail's honest coming-soon page — founder 2026-11-14,
              // "i'd like to offer that feature to users someday, so build it
              // into the UI now"); Chat → the classic chat-only view.
              const doorTo = m === 'mail' ? '/mail' : m === 'chat' ? '/chat?only=chat' : null;
              const door = doorTo && chan.includes(m);
              return door ? (
                <span key={m} className="icon-row__lenswrap">
                  {lens}
                  <button className="icon-row__door" onClick={() => navigate(doorTo)}
                    aria-label={m === 'mail' ? 'Open Mail' : 'Open Chat'} data-tip={m === 'mail' ? 'Open Mail' : 'Open Chat'}>
                    <Icon name="chevron-right" size={11} />
                  </button>
                </span>
              ) : lens;
            })}
          </div>
        )}
      </div>
      {scopedTabs.length > 0 && (
        <div className="chat__tabs"><FilterRow options={scopedTabs} value={scopedTabs.includes(tab) ? tab : 'All'} onChange={setTab} /></div>
      )}

      {searchOpen && (
      <div className="chat__search">
        <Icon name="search" size={16} />
        <input
          className="chat__search-input"
          placeholder="Search messages and people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && (
          <button className="chat__search-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      )}

      <div className="chat__list">
        {(loading || !actingReady) && <div className="chat__empty"><p>Loading your chats…</p></div>}

        {!loading && actingReady && asSpace && scoped.length === 0 && (
          <div className="chat__empty">
            <Icon name="message" size={20} />
            <p>Nobody has written to {spaceName} yet</p>
            <p className="chat__empty-sub">
              Its public page's Message door and its posts' chat doors all land here —
              every conversation where {spaceName} is the one being written to.
            </p>
          </div>
        )}
        {!loading && actingReady && !asSpace && chats.length === 0 && (
          <div className="chat__empty">
            <Icon name="message" size={20} />
            <p>No chats yet</p>
            <p className="chat__empty-sub">
              Start a direct message with the button up top, or chats appear here
              automatically for your communities, groups, places, organizations, and care team.
            </p>
          </div>
        )}

        {!loading && actingReady && chats.length > 0 && hits.length === 0 && msgHits.length === 0 && (
          <div className="chat__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
            <p className="chat__empty-sub">Try a different word, or a person's name.</p>
          </div>
        )}

        {msgHits.length > 0 && (
          <div className="chat__msghits">
            <p className="chat__msghits-head">In messages</p>
            {msgHits.filter((m) => !asSpace || scoped.some((c) => c.id === m.chat_id)).map((m) => {
              const room = scoped.find((c) => c.id === m.chat_id) ?? chats.find((c) => c.id === m.chat_id);
              return (
                <button
                  key={m.id}
                  className="chat__msghit"
                  onClick={() => openChat(m.chat_id)}
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

        {actingReady && items.map((it) => it.chat ? (
          <ConversationRow
            key={it.key}
            chat={it.chat}
            me={me}
            highlight={query}
            unread={unread.get(it.chat.id) ?? 0}
            active={it.chat.id === selectedId}
            onClick={() => openChat(it.chat!.id)}
            inSpaceInbox={!!asSpace}
            medium={!asSpace}
          />
        ) : it.mail ? (
          <MailRow key={it.key} m={it.mail} highlight={query}
            active={mailOpen === it.mail.account_id + ':' + it.mail.thread_id}
            onClick={() => openMail(it.mail!.account_id + ':' + it.mail!.thread_id)} />
        ) : null)}
        {actingReady && !loading && items.length === 0 && chan.length > 0 && (
          <div className="chat__empty">
            <Icon name={chan.length === 1 ? MEDIUM_ICON[chan[0]] : 'inbox'} size={20} />
            {chan.length === 1 && chan[0] === 'text' ? (
              <>
                <p>No texts in your inbox yet</p>
                <p className="chat__empty-sub">Sharing a text — or a screenshot of a thread — into Lichen, filed under the person it's with, is coming next.</p>
              </>
            ) : chan.includes('mail') && mailState !== 'ok' && mailState !== 'loading' ? (
              <>
                <p>{mailState === 'none' ? 'No email inbox connected yet' : mailState === 'err' ? 'Couldn’t reach your email just now' : 'Email isn’t in Lichen for members yet'}</p>
                <p className="chat__empty-sub">
                  {mailState === 'none' ? <button className="link-cue chat__emptylink" onClick={() => navigate('/mail')}>Connect an inbox in Mail ›</button>
                    : mailState === 'err' ? 'Try again in a moment, or open Mail directly.'
                    : 'It’s in a small test right now.'}
                </p>
              </>
            ) : (
              <p>Nothing here for that filter yet</p>
            )}
          </div>
        )}
        {/* THE DESK, apart from your life (founder 2026-08-19): a steward's
            help rooms sit under their own header, each named for the person
            being helped. Only stewards ever have rows here. */}
        {actingReady && hits.some((c) => c.kind === 'help' && c.helpMemberId && c.helpMemberId !== me) && (
          <>
            <p className="chat__desk-head">Help desk — you answer for Lichen Help</p>
            {hits.filter((c) => c.kind === 'help' && c.helpMemberId && c.helpMemberId !== me).map((c) => (
              <ConversationRow
                key={c.id}
                chat={c}
                me={me}
                highlight={query}
                unread={unread.get(c.id) ?? 0}
                active={c.id === selectedId}
                onClick={() => openChat(c.id)}
              />
            ))}
          </>
        )}
      </div>

      {picking && (
        <NewMessage
          me={me}
          onClose={() => setPicking(false)}
          onPick={async (otherId) => {
            try {
              const chatId = await ensureDirectChat(otherId);
              setPicking(false);
              openChat(chatId);
            } catch (e) {
              console.error(e);
              alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e)));
            }
          }}
        />
      )}
      </div>

      {/* Desktop split-view only (Chat.css hides/shows via the 1024px grid;
          not rendered at all on mobile since selectedId only ever gets set
          from openChat's desktop branch). */}
      {mailOpen && !selectedId && (
        <div className="chat__thread-pane chat__mail-pane">
          <div className="chat__mail-panehead">
            <span><Icon name="mail" size={14} /> Email</span>
            <button type="button" className="chat__mail-close" onClick={closeMail} aria-label="Close this email">×</button>
          </div>
          <iframe key={mailOpen} className="chat__mail-frame" title="Email thread"
            src={`/mail?thread=${encodeURIComponent(mailOpen)}&embed=1`} />
        </div>
      )}
      {selectedId && (
        <div className="chat__thread-pane">
          <ChatConversation
            chatId={selectedId} me={me} onBack={closeThread}
            // The pane read it — the list's pill must agree, immediately
            // (founder 2026-08-24: a "2" that survived sitting in the chat).
            onRead={(id) => setUnread((prev) => {
              if (!prev.get(id)) return prev;
              const next = new Map(prev); next.set(id, 0); return next;
            })}
          />
        </div>
      )}
    </div>
  );
}

type Medium = 'chat' | 'text' | 'mail';
const MEDIA: Medium[] = ['chat', 'text', 'mail'];
const MEDIUM_LABEL: Record<Medium, string> = { chat: 'Chat', text: 'Texts', mail: 'Email' };
const MEDIUM_ICON: Record<Medium, 'chat' | 'phone' | 'mail'> = { chat: 'chat', text: 'phone', mail: 'mail' };

/** WHICH MEDIUM, READ AT A GLANCE (founder 2026-11-17: "let's have the mail,
 *  chat, text icons be bigger, and maybe show up as a circle on the profile
 *  pic, not to the right - I want a better visual ability to scan what's an
 *  email, text or chat"): a ringed disc riding the avatar's lower-right. */
function MediumBadge({ m }: { m: Medium }) {
  return (
    <span className={'conv-row__mbadge conv-row__mbadge--' + m} aria-label={MEDIUM_LABEL[m]} title={MEDIUM_LABEL[m]}>
      <Icon name={MEDIUM_ICON[m]} size={13} />
    </span>
  );
}

/** An email thread in the Inbox, read live from the member's own Gmail. */
function MailRow({ m, highlight, onClick, active = false }: { m: ThreadSummary; highlight?: string; onClick: () => void; active?: boolean }) {
  const name = mailSender(m.from) || m.from;
  return (
    <button className={'conv-row' + (m.unread ? ' has-unread' : '') + (active ? ' is-active' : '')} onClick={onClick}>
      <div className="conv-row__avatar-stack">
        <Avatar id={m.from} name={name} size={48} />
        <MediumBadge m="mail" />
      </div>
      <div className="conv-row__body">
        <div className="conv-row__top">
          <span className="conv-row__name">
            {highlightText(name, highlight)}
            <span className="conv-row__muted"> · {m.account}</span>
          </span>
          <span className="conv-row__time">
            {m.date ? formatRelative(new Date(m.date).toISOString()) : ''}
          </span>
        </div>
        <div className="conv-row__bottom">
          <span className="conv-row__preview">{highlightText(m.subject || '(no subject)', highlight)}{m.snippet ? ' — ' + m.snippet : ''}</span>
        </div>
      </div>
    </button>
  );
}

const INBOX_TABS = ['People', 'Groups', 'Communities', 'Places', 'Organizations'];
const KIND_TAB: Record<string, string> = { group: 'Groups', community: 'Communities', place: 'Places', organization: 'Organizations' };
/** Which inbox tab a conversation files under: who it is WITH. */
function inboxGroupOf(c: ChatVM): string {
  if (c.kind in KIND_TAB) return KIND_TAB[c.kind];
  if ((c.kind === 'space_dm' || c.kind === 'suggestion') && c.party?.kind && c.party.kind in KIND_TAB) return KIND_TAB[c.party.kind];
  return 'People';
}

function ConversationRow({ chat, me, highlight, unread = 0, active = false, onClick, inSpaceInbox = false, medium = false }: { chat: ChatVM; me: string; highlight?: string; unread?: number; active?: boolean; onClick: () => void; inSpaceInbox?: boolean; medium?: boolean }) {
  const last = chat.last;
  const isDirect = chat.kind === 'direct';
  const isDM = isDirect || chat.kind === 'help'; // help rooms render DM-style (other member's avatar, no sender prefix)
  // A conversation WITH a space (founder 2026-08-17): the visitor's row wears
  // the space's logo; an admin's row wears the visitor's face and says which
  // space it's about. Sender prefixes stay on — WHO answered matters here.
  const party = (chat.kind === 'space_dm' || chat.kind === 'suggestion') ? chat.party : undefined;
  const iAmVisitor = !!party && party.visitorId === me;
  const senderName = last
    ? chat.members.find((m) => m.profile_id === last.sender_id)?.name.split(' ')[0]
    : undefined;
  const showSender = last && !isDM;

  return (
    <button className={'conv-row' + (unread > 0 ? ' has-unread' : '') + (active ? ' is-active' : '')} onClick={onClick}>
      <div className="conv-row__avatar-stack">
        <GroupAvatar chat={chat} me={me} />
        {medium && <MediumBadge m="chat" />}
      </div>
      <div className="conv-row__body">
        <div className="conv-row__top">
          <span className="conv-row__name">
            {highlightText(chat.title, highlight)}
            {!isDirect && chat.kind !== 'space_dm' && <span className="conv-row__muted"> ·{KIND_LABEL[chat.kind].toLowerCase()}</span>}
            {party && !iAmVisitor && !inSpaceInbox && <span className="conv-row__muted"> · via {party.name}</span>}
          </span>
          <span className="conv-row__time">
            {last ? formatRelative(last.created_at) : ''}
          </span>
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
  // A help room holds Lichen Health AND the assistant now, so it stacks like
  // any group rather than showing one face (founder 2026-08-16).
  const dmLike = chat.kind === 'direct';
  const single = chat.members.find((m) => m.profile_id !== me) ?? chat.members[0];

  // A SPACE'S OWN ROOM WEARS THE SPACE'S LOGO (founder 2026-08-25): the
  // member-face stack minus yourself is empty in a young room, which drew a
  // blank circle — and even full, the room's identity is the space. Since
  // 2026-10-21 that holds with NO photo too (founder: "get rid of 3 bubbles
  // … just have the profile bubble for the group") — Avatar's monogram is
  // the group's own bubble, never the member stack.
  if (chat.spaceId && ['organization', 'community', 'group', 'place'].includes(chat.kind)) {
    return <Avatar id={chat.spaceId} name={chat.roomSpaceName ?? chat.title} url={chat.roomSpaceAvatar} size={48} className="conv-row__avatar--party avatar--logo" />;
  }

  // THE ORANGE BRAIN IS THE ROOM (founder 2026-08-18): a help room's row
  // wears Lichen Health's avatar — its identity — from every side. The humans
  // who answer show on their own messages inside, ringed peach.
  if (chat.kind === 'help') {
    // A steward's desk row wears the HELPED MEMBER's face; your own help
    // room wears the desk's orange brain.
    if (chat.helpMemberId && chat.helpMemberId !== me) {
      const helped = chat.members.find((m) => m.profile_id === chat.helpMemberId);
      return <Avatar id={chat.helpMemberId} name={helped?.name ?? 'Member'} url={helped?.avatarUrl} size={48} className="conv-row__avatar--party" />;
    }
    const lh = chat.members.find((m) => m.profile_id === LICHEN_HEALTH_PROFILE_ID);
    return <Avatar id={LICHEN_HEALTH_PROFILE_ID} name="Lichen Health" url={lh?.avatarUrl} size={48} className="conv-row__avatar--party" />;
  }

  // A conversation WITH a space: the visitor sees the space's logo wearing the
  // answering admin's face; the admin sees the visitor.
  if ((chat.kind === 'space_dm' || chat.kind === 'suggestion') && chat.party) {
    const party = chat.party;
    if (party.visitorId === me) {
      const answerers = chat.members.filter((m) => m.profile_id !== party.visitorId);
      const one = answerers.length === 1 ? answerers[0] : null;
      return (
        <Avatar id={party.id} name={party.name} url={party.avatarUrl} size={48} className="conv-row__avatar--party avatar--logo"
          stewardFace={one ? { id: one.profile_id, name: one.name, url: one.avatarUrl } : undefined} />
      );
    }
    const visitor = chat.members.find((m) => m.profile_id === party.visitorId);
    return <Avatar id={visitor?.profile_id ?? 'v'} name={visitor?.name ?? 'Member'} url={visitor?.avatarUrl} size={48} className="conv-row__avatar--party" />;
  }

  // ONE FACE IS NOT A STACK (founder 2026-08-16: "melanie mentorship group
  // icon is off center and so is Lichen's as an org"). A two-person group
  // leaves exactly one face once your own is dropped, and it was still being
  // drawn in the 52px stack box at the 30px stacked size — small, and pinned
  // to that box's top-left instead of filling the avatar slot. Keep the logo
  // big until there are actually several to clump together, which is the
  // founder's own instinct in the same message.
  const others = chat.members.filter((m) => m.profile_id !== me);
  if (dmLike || others.length <= 1) {
    if (single?.avatarUrl) {
      return <img className="conv-row__avatar conv-row__avatar--img" src={single.avatarUrl} alt="" />;
    }
    const color = single ? colorFor(single.profile_id) : undefined;
    return (
      <div className="conv-row__avatar" style={color ? { background: color, color: 'var(--bone-warm)' } : undefined}>
        <span>{monogramFor(single?.name ?? chat.title)}</span>
      </div>
    );
  }

  // Your own face carries no information — you're in every chat you can see.
  // EXCEPT in a help room (founder 2026-08-18): its identity IS "Lichen Health
  // + Claude", so both responders show even to the steward signed in as one
  // of them — the member, the orange brain, the blue brain. Every party, in
  // every help room, from every side.
  const sample = others.slice(0, 3);
  return (
    <div className={`conv-row__group conv-row__group--${sample.length}`}>
      {sample.map((mem, i) => (
        mem.avatarUrl
          ? <img key={mem.profile_id} className="conv-row__group-bub" src={mem.avatarUrl} alt="" style={{ zIndex: 3 - i }} />
          : (
            <div
              key={mem.profile_id}
              className="conv-row__group-bub"
              style={{ zIndex: 3 - i, background: colorFor(mem.profile_id) }}
            >
              {monogramFor(mem.name)}
            </div>
          )
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
