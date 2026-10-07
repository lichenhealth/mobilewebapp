import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import AssistantComposer from '../components/AssistantComposer';
import { useAuth } from '../auth/AuthProvider';
import { useActing, type SpaceKind } from '../acting/ActingProvider';
import { useTopIdentityFor } from '../lib/topIdentity';
import { supabase } from '../lib/supabase';
import { CLAUDE_PROFILE_ID } from '../lib/chatApi';
import {
  loadAssistantFeed, postToAssistantFeed, loadThreadBadges, markThreadRead, loadThreadCursors,
  loadProfileContext, loadSpaceContext, spaceIdOfThread, spaceRoomOfThread, spaceThreadId,
  loadSectionPresence, groupConvos,
  ASSISTANT_THREADS, threadLabel, type FeedPostRow, type ProfileContext, type SpaceContext,
} from '../lib/assistantFeedApi';
import { setConsent } from '../lib/assistantConsentApi';
import type { IconName } from '../components/Icon';
import { possessive } from '../lib/names';
import { readDraft, publishDraft } from '../lib/pageDrafts';
import SnapshotPanel from '../components/SnapshotPanel';
import BuildModeSplit from '../components/BuildModeSplit';
import { ScrollHintRow } from '../components/ScrollHintRow';
import { loadPostsByIds, type FeedPost } from '../lib/postsApi';
import './AssistantFeed.css';

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** Your relationship with Claude, as a feed rather than a chat thread
 *  (founder, 2026-08-09: typing into a thread felt redundant with a
 *  relationship that's really about gathering context over time). Every
 *  door that used to open a Claude DM lands here instead. */
export default function AssistantFeed() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  // Rooms that mirror the platform (founder 2026-08-11) — ?thread= is the
  // thread, ?back= the way home to whatever sent you here.
  const [params, setParams] = useSearchParams();
  const thread = params.get('thread') || 'general';
  const back = params.get('back') || '';
  // A space's build thread (founder 2026-08-22): `space:<id>` — Build with
  // Claude on a space's builder lands here, ABOUT that space, instead of the
  // member's own profile thread.
  const spaceId = spaceIdOfThread(thread);
  // Which ROOM of the space (founder 2026-10-06): null = the build thread,
  // 'currentcy' = the space's own Current-cy room — same stream shape, no
  // page panels, the treasury on the table server-side.
  const spaceRoom = spaceRoomOfThread(thread);
  // CONVERSATIONS, THE EMAIL GRAMMAR (founder 2026-10-05: "it feels weird
  // to be dropped midway between two chat bubbles… dropped at a
  // chronological order (maybe most recent to oldest, like email) of only
  // chats that pertain to Marketplace"). A personal thread is a LIST of
  // conversations now, newest first; opening one shows just that exchange.
  // ?convo= carries the open conversation ('new' = a fresh one, composer
  // ready); no param + several conversations = the list. Space build
  // threads deliberately keep the continuous working-session stream.
  const convoParam = params.get('convo');
  const personal = !spaceId;
  // BUILDER MODE (founder 2026-08-31, third pass: even with the page beside
  // the chat, the six personal thread icons and the generic Claude header
  // made this read as "the Lichen profile build"). Arriving through a page
  // builder's Build-with-Claude door (`page=1`), this screen IS the Public
  // Profile Builder in its Claude mode: it says so in the header, and the
  // personal thread rail steps out — Back to manual mode is the one exit,
  // the same way the manual builder is a full screen with one way back.
  const builderMode = !!spaceId && params.get('page') === '1';

  // THE PROFILE THREAD FOLLOWS THE HAT (founder 2026-08-31, the same bug's
  // third face: acting as Countryman Stables, the profile thread showed
  // GALYN's page). /profile already redirects to the space's backstage while
  // a hat is on — the assistant's profile-management thread is the same door,
  // so wearing a space's hat it opens that space's BUILD thread instead of
  // the person's. One choke point: rail clicks, section brains, and direct
  // ?thread=profile arrivals all pass through here. Waits on acting `ready`
  // (the standing rule) so a boot-default "self" never decides. Beings stay
  // personal — a being's page is its steward's work, and build threads are
  // space-shaped server-side.
  const { actor, ready: actingReady, setActor } = useActing();
  useEffect(() => {
    if (!actingReady) return;
    if (thread === 'profile' && actor.type === 'space') {
      const next = new URLSearchParams(params);
      next.set('thread', `space:${actor.id}`);
      setParams(next, { replace: true });
    }
    // THE CURRENT-CY THREAD FOLLOWS THE HAT TOO (founder 2026-10-06, the
    // same rule as profile above): wearing a space's hat, the money room
    // is the SPACE's own Current-cy room, never the person's wallet thread.
    // Beings stay personal — a being holds no treasury room yet.
    if (thread === 'currentcy' && actor.type === 'space') {
      const next = new URLSearchParams(params);
      next.set('thread', spaceThreadId(actor.id, 'currentcy'));
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actingReady, actor, thread]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Which sections hold real content (founder 2026-08-31): an icon goes gray
  // until the member has something IN that section — the AI-off gray, minus
  // the slash: "it isn't turned off, it's just not been enlivened with
  // content" — and the thread's greeting offers to create instead of
  // welcoming back. null = still checking, and nothing is called empty
  // before we know. (The re-check effect lives below the posts state: it
  // watches Claude's replies so a post born IN the conversation lights the
  // icon the moment it lands.)
  const [setup, setSetup] = useState<Record<string, boolean> | null>(null);
  // Your page beside Claude (founder 2026-08-11: "toggle between their
  // public profile and claude to speak to claude about what to change").
  // The page is the real thing in an iframe, so it always shows the truth —
  // and reloads the moment a change lands. The split no longer auto-opens
  // (founder 2026-08-31: "the split screen is too busy") — previewing lives
  // in a NEW TAB now, via the Preview button under Claude's edits.
  const [showPage, setShowPage] = useState(false);
  const [pageNonce, setPageNonce] = useState(0);

  // The receipt of what Claude is working from, at the top of the profile
  // thread — its own inputs, so there's no mystery about what it knows.
  const [ctx, setCtx] = useState<ProfileContext | null>(null);
  useEffect(() => {
    if (!me || thread !== 'profile') { setCtx(null); return; }
    let live = true;
    void loadProfileContext(me).then((c) => { if (live) setCtx(c); });
    return () => { live = false; };
  }, [me, thread, pageNonce]);
  // The space-side twin of the receipt above, for a space's build thread.
  const [sctx, setSctx] = useState<SpaceContext | null>(null);
  useEffect(() => {
    if (!me || !spaceId) { setSctx(null); return; }
    let live = true;
    void loadSpaceContext(me, spaceId).then((c) => { if (live) setSctx(c); });
    return () => { live = false; };
  }, [me, spaceId, pageNonce]);

  // WHOSE SCREEN IS THIS (founder 2026-08-28: "it shows me in the top right,
  // versus countryman stables, but in the chat it shows me as steward").
  // A space's build thread is one of ITS screens — every write here lands on
  // its page — so it wears the space's mark. The right-hand chip is a
  // different question and stays: it says who you are ACTING as, and the
  // honest answer is yourself, stewarding.
  useTopIdentityFor(spaceId && sctx
    ? { id: spaceId, name: sctx.name, avatarUrl: sctx.avatarUrl, kind: 'space' }
    : null);

  // "Let me change it directly" flips the hand-that-writes switch IN PLACE
  // (founder 2026-08-22: the old link navigated to /profile#privacy — while
  // wearing a space's hat that landed on the PERSON's admin page, pure
  // identity whiplash). One flag covers their own page and pages they
  // steward; a one-line confirm keeps it deliberate.
  const [armConfirm, setArmConfirm] = useState(false);
  const [arming, setArming] = useState(false);
  async function armEditing() {
    if (!me) return;
    setArming(true);
    try {
      await supabase.from('profiles').update({ assistant_can_edit: true }).eq('id', me);
      setArmConfirm(false);
      setPageNonce((n) => n + 1);   // both context cards reload on this
    } finally { setArming(false); }
  }
  const armOffer = armConfirm ? (
    <p className="afeed__ctx-off">
      I&rsquo;ll make changes myself and name every one — your page, and pages you
      steward. You can switch this off anytime in Privacy.{' '}
      <button className="afeed__ctx-link" disabled={arming} onClick={() => void armEditing()}>
        {arming ? 'Switching on…' : 'Yes, let Claude edit'}
      </button>{' '}
      <button className="afeed__ctx-link" onClick={() => setArmConfirm(false)}>
        Not now
      </button>
    </p>
  ) : (
    <p className="afeed__ctx-off">
      Ask and I&rsquo;ll write you a draft to paste in.{' '}
      <button className="afeed__ctx-link" onClick={() => setArmConfirm(true)}>
        Let me change it directly
      </button>{' '}
      and I&rsquo;ll make the change myself, and tell you exactly what I did.
    </p>
  );

  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  // THE CONVERSATION OPENS AT ITS NEWEST WORDS (founder 2026-09-09; the
  // effect itself lives below, after viewEntries exists). On open/switch:
  // an instant snap to the foot. On a new entry arriving: follow it — but
  // only when the reader is already near the foot or the newest entry is
  // their own send, so someone scrolled up reading history is never
  // yanked. The LIST never scrolls — newest sits at the top, email's way.
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const feedSeen = useRef(0);
  const [sourcePosts, setSourcePosts] = useState<Map<string, FeedPost>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [avatars, setAvatars] = useState<{ me?: string | null; claude?: string | null }>({});
  // Every thread's read cursor as of load — frozen, so opening one
  // conversation doesn't silently clear the others' pills (the cursors
  // themselves still bump). A map because General's list spans ALL threads
  // now (founder 2026-10-06) and each row measures against its own.
  const [cursors, setCursors] = useState<Record<string, number>>({});
  // General is the HISTORY LOG: every personal thread's rows ride here so
  // its list can show every conversation, section-labeled. Other threads
  // keep allRows === their own rows.
  const [allRows, setAllRows] = useState<FeedPostRow[]>([]);
  const [seenConvos, setSeenConvos] = useState<Set<string>>(new Set());
  // Auto-opens are STATE, not URL (no history step for a decision the
  // member didn't make): one conversation → straight in; none → a fresh
  // one; several → the list, which is the whole point.
  const [autoConvo, setAutoConvo] = useState<string | null>(null);
  useEffect(() => { setAutoConvo(null); setSeenConvos(new Set()); }, [thread]);
  const openConvo = personal ? (convoParam ?? autoConvo) : null;
  const openConvoRef = useRef<string | null>(null);
  useEffect(() => { openConvoRef.current = openConvo; }, [openConvo]);

  const load = async () => {
    if (!me) return;
    const all = await loadAssistantFeed(me, thread === 'general' ? undefined : thread);
    const rows = thread === 'general' ? all.filter((r) => r.thread === 'general') : all;
    setPosts(rows);
    setAllRows(thread === 'general' ? all.filter((r) => !spaceIdOfThread(r.thread)) : rows);
    if (personal) setCursors(await loadThreadCursors().catch(() => ({})));
    setLoading(false);
    // A personal thread's cursor bumps when a CONVERSATION opens (the
    // effect below) — arriving on the list leaves the pills telling the
    // truth. A space build thread is one continuous exchange, so opening
    // it still counts as seeing it.
    if (!personal) await markThreadRead(thread).catch(() => {});
    void loadThreadBadges(me).then(setCounts);
    const sourceIds = [...new Set(rows.map((r) => r.source_post_id).filter((id): id is string => !!id))];
    if (sourceIds.length) {
      const sp = await loadPostsByIds(sourceIds);
      setSourcePosts(new Map(sp.map((p) => [p.id, p])));
    }
  };
  useEffect(() => { setLoading(true); void load(); }, [me, thread]);

  // CONVERSATIONS, derived (personal threads): one shared grouping
  // (groupConvos). General groups over EVERY personal thread's rows — the
  // history log (founder 2026-10-06: "The general brain should cover all
  // conversations"); section threads carry only their own.
  const convos = useMemo(
    () => (personal ? groupConvos(thread === 'general' ? allRows : posts) : []),
    [personal, thread, allRows, posts]);

  // Opened or arrived: pick the right first view once the rows are in.
  // A door's errand (?ask= prefill, ?build=1) opens a conversation ONCE —
  // consumed, so "← All conversations" afterwards really shows the list.
  const doorUsed = useRef('');
  useEffect(() => {
    if (!personal || loading || convoParam || autoConvo) return;
    if ((params.get('ask') || params.get('build') === '1') && doorUsed.current !== thread) {
      doorUsed.current = thread;
      setAutoConvo(params.get('ask') ? 'new' : (convos[0]?.id ?? 'new'));
      return;
    }
    if (convos.length === 0) setAutoConvo('new');
    else if (convos.length === 1 && convos[0].thread === thread) setAutoConvo(convos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal, loading, convoParam, autoConvo, convos.length, thread]);

  // Opening a conversation IS seeing it: bump the thread cursor, refresh
  // the rail badges, and remember this one as seen so its own pill drops
  // while the frozen cursorAt keeps the other pills honest.
  useEffect(() => {
    if (!personal || loading || !openConvo || openConvo === 'new' || !me) return;
    setSeenConvos((cur) => (cur.has(openConvo) ? cur : new Set(cur).add(openConvo)));
    void markThreadRead(thread).then(() => loadThreadBadges(me)).then(setCounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personal, loading, openConvo, me, thread]);

  const listMode = personal && !openConvo && !loading;
  const viewEntries = useMemo(() => {
    if (!personal) return posts;
    if (!openConvo) return [];
    if (openConvo === 'new') return [];
    return posts.filter((p) => (p.convo_id ?? 'loose') === openConvo);
  }, [personal, posts, openConvo]);
  const convoUnread = (c: { id: string; thread: string; entries: FeedPostRow[] }): number => {
    if (seenConvos.has(c.id)) return 0;
    const cursorAt = cursors[c.thread] ?? 0;
    const lastMine = Math.max(0, ...c.entries.filter((e) => e.author === 'member').map((e) => +new Date(e.created_at)));
    const floor = cursorAt > 0
      ? Math.max(cursorAt, lastMine)
      : Math.max(lastMine, Date.now() - 7 * 86_400_000);
    return c.entries.filter((e) => e.author === 'claude' && +new Date(e.created_at) > floor).length;
  };

  useEffect(() => { feedSeen.current = 0; }, [thread, openConvo]);
  useEffect(() => {
    if (loading || listMode || viewEntries.length === 0) return;
    const first = feedSeen.current === 0;
    const grew = viewEntries.length > feedSeen.current;
    feedSeen.current = viewEntries.length;
    if (!first && !grew) return;
    const end = feedEndRef.current;
    if (!end) return;
    const nearFoot = end.getBoundingClientRect().top - window.innerHeight < 600;
    const lastIsMine = viewEntries[viewEntries.length - 1]?.author === 'member';
    if (first) end.scrollIntoView({ block: 'end' });
    else if (nearFoot || lastIsMine) end.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [loading, listMode, viewEntries, thread, openConvo]);

  // THE DRAFT'S STATE, FOR THE BUTTONS (founder 2026-08-31): a Claude reply
  // that edited a page carries a page_edit marker, and the newest such reply
  // wears Preview + Publish. Whether a draft still EXISTS decides which —
  // published (or discarded) elsewhere, the buttons say "see it live"
  // instead of offering to publish nothing.
  const lastPageEdit = (() => {
    // Scans the entries ON SCREEN — in a conversation view, buttons never
    // hang on a reply the member isn't looking at.
    for (let i = viewEntries.length - 1; i >= 0; i--) {
      const p = viewEntries[i];
      if (p.author !== 'claude') continue;
      const mark = (p.attachments ?? []).find((a) => a.type === 'page_edit');
      if (mark && mark.type === 'page_edit') return { postId: p.id, mark };
    }
    return null;
  })();
  const [chatDraft, setChatDraft] = useState<'has' | 'none' | null>(null);
  const [pubBusy, setPubBusy] = useState(false);
  const [pubErr, setPubErr] = useState('');
  useEffect(() => {
    setPubErr('');
    if (!lastPageEdit) { setChatDraft(null); return; }
    let live = true;
    void readDraft(lastPageEdit.mark.subject, lastPageEdit.mark.id)
      .then((d) => { if (live) setChatDraft(d ? 'has' : 'none'); })
      .catch(() => { if (live) setChatDraft(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPageEdit?.postId]);
  const editPageUrl = (draft: boolean) => {
    if (!lastPageEdit) return '';
    const { subject, id: sid, tab } = lastPageEdit.mark;
    const base = subject === 'space' ? `/spaces/${sid}` : `/members/${sid}`;
    return `${base}?preview=1${draft ? '&draft=1' : ''}${tab ? `&ptab=${encodeURIComponent(tab)}` : ''}`;
  };
  async function publishFromChat() {
    if (!lastPageEdit) return;
    setPubBusy(true); setPubErr('');
    try {
      const res = await publishDraft(lastPageEdit.mark.subject, lastPageEdit.mark.id);
      if (res.ok) setChatDraft('none');
      else setPubErr(res.error ?? 'Could not publish.');
    } finally { setPubBusy(false); }
  }

  // THE TREASURY DOOR (founder 2026-10-06: "link to the Ai assistant in
  // countryman stable's account, which it will switch you to and then drop
  // you in their current-cy chat"). The button flips the hat IN PLACE (the
  // never-navigate-to-a-personal-page-mid-act rule) and lands in the
  // space's own Current-cy room. The consent variant first turns the named
  // switch back on — the PERSON taps; the server only ever offered.
  const [doorBusy, setDoorBusy] = useState(false);
  const [doorErr, setDoorErr] = useState('');
  async function enterTreasury(att: Extract<NonNullable<FeedPostRow['attachments']>[number], { type: 'space_thread' | 'space_consent' }>) {
    if (doorBusy) return;
    setDoorBusy(true); setDoorErr('');
    try {
      if (att.type === 'space_consent') {
        if (att.which === 'member') {
          // Their own per-space switch: all-on is the absence of rows, so
          // turning back on DELETES — awaited here, so the room's first
          // message never races the consent it rides on.
          const { error } = await supabase.from('assistant_consent').delete()
            .match({ profile_id: me, scope_type: 'space', scope_id: att.id });
          if (error) throw error;
          setConsent('space', att.id, true);   // keep the local cache honest
        } else {
          // The space's own switch — steward-flippable (they are one, the
          // server checked before offering this door).
          const { error } = await supabase.from('spaces')
            .update({ assistant_enabled: true }).eq('id', att.id);
          if (error) throw error;
        }
      }
      const { data } = await supabase.from('spaces').select('avatar_url').eq('id', att.id).maybeSingle();
      setActor({
        type: 'space', id: att.id, name: att.name,
        kind: att.kind as SpaceKind,
        avatarUrl: (data as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      });
      const next = new URLSearchParams(params);
      next.set('thread', spaceThreadId(att.id, 'currentcy'));
      next.delete('convo'); next.delete('page'); next.delete('ask');
      setParams(next);   // a push — stepping into the space's room IS a step
    } catch (e) {
      console.error(e);
      setDoorErr('Could not open the room — try once more.');
    } finally { setDoorBusy(false); }
  }

  // ENLIVENED IN THE MOMENT (founder 2026-08-31: "once the conversation
  // generates an actual content post to the section, even if done via the
  // claude builder, it goes from gray to darker gray"): re-check section
  // presence on every Claude reply, since a reply is when created content
  // would have just landed. Six head-count reads — cheap enough to re-ask.
  const claudeReplies = posts.filter((p) => p.author === 'claude').length;
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadSectionPresence(me).then((s) => { if (live) setSetup(s); }).catch(() => {});
    return () => { live = false; };
  }, [me, claudeReplies]);

  useEffect(() => {
    if (!me) return;
    void supabase.from('profiles').select('id, avatar_url').in('id', [me, CLAUDE_PROFILE_ID])
      .then(({ data }) => {
        const rows = (data as { id: string; avatar_url: string | null }[] | null) ?? [];
        setAvatars({
          me: rows.find((r) => r.id === me)?.avatar_url,
          claude: rows.find((r) => r.id === CLAUDE_PROFILE_ID)?.avatar_url,
        });
      });
  }, [me]);

  // Realtime: Claude's reply lands without a manual refresh.
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel(`assistant-feed:${me}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'assistant_feed_posts', filter: `profile_id=eq.${me}` },
        (payload) => {
          const row = payload.new as FeedPostRow;
          if ((row.thread ?? 'general') !== thread) {
            // Another thread's business — the rail's badge speaks, and
            // General's history log stays live (it lists every thread).
            if (thread === 'general' && !spaceIdOfThread(row.thread)) {
              setAllRows((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
            }
            void loadThreadBadges(me).then(setCounts);
            return;
          }
          // Landing in the CONVERSATION on screen: you're seeing it, so the
          // cursor follows and no badge ever claims it later. Landing in
          // another conversation of this thread — list or elsewhere — the
          // pill is exactly what should speak.
          const seeing = !spaceId
            ? openConvoRef.current !== null && openConvoRef.current === (row.convo_id ?? 'loose')
            : true;
          if (seeing) void markThreadRead(thread).then(() => loadThreadBadges(me)).then(setCounts).catch(() => {});
          else void loadThreadBadges(me).then(setCounts);
          setPosts((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
          setAllRows((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
          // Claude has just spoken in a page-building thread (yours or a
          // space's) — reload the frame beside the conversation so you SEE
          // the change rather than being told about it.
          if ((thread === 'profile' || spaceId) && row.author === 'claude') setPageNonce((n) => n + 1);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [me, thread]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? viewEntries.filter((p) => p.body.toLowerCase().includes(needle)) : viewEntries;
  }, [q, viewEntries]);
  // The list searches CONVERSATIONS — title or any words inside.
  const visibleConvos = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return convos;
    return convos.filter((c) => c.title.toLowerCase().includes(needle)
      || c.entries.some((e) => e.body.toLowerCase().includes(needle)));
  }, [q, convos]);

  // THE THINKING WHEEL (founder 2026-08-22: "is he still thinking or is
  // there a bug?"). Derived, not tracked: if the thread's newest entry is
  // the member's and young, Claude is composing — show the pulse. If it's
  // the member's and stale, the reply was LOST (the trigger fires once, no
  // retry) — say so honestly instead of spinning forever. Derivation means
  // reloads and arriving from a brief's composer show the right state too.
  const THINKING_MS = 90_000;          // replies land well inside this
  const STALE_NOTE_MS = 60 * 60_000;   // older than an hour is just history
  const [nowTick, setNowTick] = useState(() => Date.now());
  const lastPost = viewEntries[viewEntries.length - 1];
  const lastIsMine = !!lastPost && lastPost.author === 'member';
  const lastAge = lastIsMine ? nowTick - new Date(lastPost.created_at).getTime() : Infinity;
  const thinking = lastIsMine && lastAge < THINKING_MS;
  const replyLost = lastIsMine && lastAge >= THINKING_MS && lastAge < STALE_NOTE_MS;
  useEffect(() => {
    if (!lastIsMine || lastAge >= STALE_NOTE_MS) return;
    const t = setInterval(() => setNowTick(Date.now()), 3000);
    return () => clearInterval(t);
  }, [lastIsMine, lastAge >= STALE_NOTE_MS, viewEntries.length]);

  async function send(text: string, images?: string[]) {
    // YOUR OWN MESSAGE NEVER RIDES THE WEBSOCKET (founder 2026-10-05: "I
    // just typed to you and it disappeared" — the insert succeeded, but the
    // screen waited for the realtime echo, and a dropped socket showed
    // nothing). Append the stored row directly; the realtime handler's
    // id-dedup makes its later echo a no-op. Claude's reply still arrives
    // by realtime, with the honest reply-lost note as its backstop.
    //
    // CONVERSATIONS: continuing the open one carries its id; a fresh one
    // ('new', or a legacy loose bucket) mints — and the URL then names the
    // real conversation (replace, not push: becoming real isn't a step).
    // Space build threads stay one continuous stream (convo null).
    const continuing = personal && openConvo && openConvo !== 'new' && openConvo !== 'loose'
      ? openConvo : undefined;
    const row = await postToAssistantFeed(text, undefined, thread, images,
      personal ? continuing : null);
    setPosts((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
    setAllRows((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
    if (personal && row.convo_id && convoParam !== row.convo_id) {
      const next = new URLSearchParams(params);
      next.set('convo', row.convo_id);
      setParams(next, { replace: true });
    }
  }

  return (
    <div className={'afeed' + (showPage && (thread === 'profile' || spaceId) ? ' afeed--paged' : '')}>
      {builderMode ? (
        /* A TRUE TOGGLE, FROZEN (founder 2026-09-09: "let's have a toggle
           back to manual mode frozen in the upper bar, instead of the
           inconsistency now where building with claude disappears the
           manual mode button" — with Back to profile frozen above it, since
           the thread's scroll history gets long). Same segmented control as
           the manual builder, Claude side lit; the manual side switches. */
        <div className="afeed__buildhead">
          <div className="afeed__buildbar">
            <button className="btn" onClick={() => navigate(`/spaces/${spaceId}?manage=1`)}>
              ← Back to profile
            </button>
          </div>
          <BuildModeSplit
            mode="claude"
            back={back ?? `/spaces/${spaceId}?manage=1&build=public`}
            space={{ id: spaceId!, name: sctx?.name ?? 'this space' }}
          />
        </div>
      ) : (
        <button className="cmp__back afeed__back" onClick={() => (back ? navigate(back) : navigate(-1))}>
          ← {back ? 'Back to manual mode' : 'Back'}
        </button>
      )}

      <header className="afeed__head">
        <Avatar id={CLAUDE_PROFILE_ID} name="Claude" url={avatars.claude} size={44} />
        <div className="afeed__head-text">
          <h1 className="afeed__title">{builderMode ? 'Public Profile Builder' : 'Claude'}</h1>
          {/* The assistant's PROFILE, same grammar as the brief screen
              (founder 2026-09-13: every assistant surface wears the identity
              + the gray blurb — "the profile and chat blurb"). */}
          {!builderMode && <p className="afeed__eyebrow">Your Lichen Partner</p>}
          <p className="afeed__sub">
            {builderMode
              ? `Build with Claude — ${possessive(sctx?.name ?? 'this space')} website changes beside the conversation.`
              : spaceRoom === 'currentcy'
              ? `${possessive(sctx?.name ?? 'This space')} Current-cy room — its treasury, its moves, kept with the ${sctx?.kind ?? 'space'}.`
              : spaceId
              ? `${possessive(sctx?.name ?? 'This space')} build thread — its page, its story, kept with the ${sctx?.kind ?? 'space'}.`
              : thread === 'general'
              ? 'Everything you’ve shared and asked — the whole weave, drawing on every thread.'
              : `The ${threadLabel(thread)} thread — this is where that work stays woven together.`}
          </p>
        </div>
        <button
          className={'afeed__search-btn' + (searchOpen ? ' is-on' : '')}
          onClick={() => setSearchOpen((o) => !o)}
          aria-expanded={searchOpen}
          aria-label="Search this feed"
        >
          <Icon name="search" size={16} />
        </button>
      </header>

      {searchOpen && (
        <div className="afeed__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your history with Claude…"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear">
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      )}

      {/* The threads as SECTION DOORS (founder 2026-08-31: "replace the text
          boxes with the icons for each space"): each thread wears its
          section's own mark — the circle grammar, "a circle is something you
          open" — with its message tally at the upper right, TopBar-badge
          style. A section with nothing in it yet reads GRAY until it's set
          up; General is always lit, it's the front door. */}
      {/* The rail SAYS it scrolls now (founder 2026-10-05, circling the
          eighth icon cut at the phone's edge: "have the same scroll prompt
          as homepage, so people know to toggle") — ScrollHintRow in hide
          mode, the icon-circle grammar: no half-cut icon, a chevron BUTTON
          marking each direction that has more. ⚠ Run scripts/check-rows.mjs
          after touching this row. */}
      {!builderMode && (
      <ScrollHintRow className="afeed__threads h-scroll" ariaLabel="Assistant threads">
        {ASSISTANT_THREADS.map((t) => {
          const off = setup ? !setup[t.id] : false;
          return (
            <button
              key={t.id}
              className={'afeed__thread' + (t.id === thread ? ' is-on' : '') + (off ? ' is-off' : '')}
              title={`${t.label} — ${t.blurb}`}
              aria-label={t.label}
              onClick={() => {
                // A PUSH, never a replace (founder 2026-10-05: replace
                // destroyed the history entry holding the thread you were
                // just conversing in, so Back landed before the assistant
                // entirely and the conversation read as deleted). Back now
                // returns to the thread you left, words intact.
                const next = new URLSearchParams(params);
                next.set('thread', t.id);
                next.delete('convo');   // a fresh thread opens on ITS view
                setParams(next);
              }}
            >
              <Icon name={t.icon as IconName} size={20} />
              {/* No badge on the thread that's on screen — you're reading it. */}
              {t.id !== thread && counts[t.id] ? <em>{counts[t.id]}</em> : null}
            </button>
          );
        })}
        {/* A space's build thread joins the rail while you're in it — a
            dynamic room, not one of the six standing ones; it wears the
            space's own face. */}
        {spaceId && (
          <button className="afeed__thread afeed__thread--space is-on" title={spaceRoom === 'currentcy' ? `${possessive(sctx?.name ?? 'this space')} Current-cy room` : `Building ${possessive(sctx?.name ?? 'this space')} page`} aria-label={sctx?.name ?? 'This space'}>
            <Avatar id={spaceId} name={sctx?.name ?? 'This space'} url={sctx?.avatarUrl} size={44} />
            {/* Its thread is the one on screen — no badge on what you're reading. */}
          </button>
        )}
      </ScrollHintRow>
      )}

      {/* Building your presence happens HERE, in the profile thread, rather
          than off in a screen of its own (founder 2026-08-11). The working
          panels belong to a CONVERSATION — the list stays a clean list. */}
      {thread === 'profile' && !listMode && (
        <>
          <div className="afeed__split">
            <button
              className={'afeed__split-side' + (!showPage ? ' is-on' : '')}
              onClick={() => setShowPage(false)}
            >
              Talk to Claude
            </button>
            <button
              className={'afeed__split-side' + (showPage ? ' is-on' : '')}
              onClick={() => { setShowPage(true); setPageNonce((n) => n + 1); }}
            >
              Your page
            </button>
          </div>
          {showPage ? (
            // The page beside the conversation, the way this session works:
            // ask, and watch it change. The frame is the REAL page, keyed on
            // pageNonce so it reloads the moment Claude reports an edit.
            // Only from the desktop breakpoint up — a whole page squeezed
            // into a phone-width frame teaches nobody anything, so small
            // screens get the honest door instead.
            <div className="afeed__page">
              <iframe
                className="afeed__page-frame"
                key={pageNonce}
                src={`/members/${me}?preview=1&embed=1`}
                title="Your public page"
              />
              <div className="afeed__page-foot">
                <button
                  className="afeed__page-refresh"
                  onClick={() => setPageNonce((n) => n + 1)}
                >
                  Refresh
                </button>
                <button
                  className="afeed__page-refresh"
                  onClick={() => window.open(`/members/${me}?preview=1`, '_blank')}
                >
                  Open in a new tab
                </button>
              </div>
              <p className="afeed__page-note afeed__page-note--wide">
                This is your page as visitors see it. Tell Claude what to change
                and it updates here.
              </p>
              <p className="afeed__page-note afeed__page-note--narrow">
                A whole page doesn&rsquo;t fit beside a conversation on a phone —
                open it in its own tab and flip between the two.
              </p>
            </div>
          ) : (
            <>
              {ctx && (
                <div className="afeed__ctx">
                  <p className="afeed__ctx-lead">
                    What I&rsquo;m working from{ctx.canEdit ? '' : ' — I can suggest, but not change anything yet'}:
                  </p>
                  <ul className="afeed__ctx-list">
                    <li>
                      <span>Tagline</span>
                      {ctx.tagline ? <em>&ldquo;{ctx.tagline}&rdquo;</em> : <em className="afeed__ctx-none">none yet</em>}
                    </li>
                    <li>
                      <span>Story</span>
                      {ctx.storyWords
                        ? <em>{ctx.storyWords} words{ctx.homeSummary ? ', with its own Home welcome' : ', Home opens with its first two paragraphs'}</em>
                        : <em className="afeed__ctx-none">nothing written</em>}
                    </li>
                    <li>
                      <span>What you offer</span>
                      {ctx.categories.length
                        ? <em>{ctx.categories.join(', ')}</em>
                        : <em className="afeed__ctx-none">nothing picked</em>}
                    </li>
                    <li>
                      <span>Contact</span>
                      {ctx.contactFilled.length
                        ? <em>{ctx.contactFilled.join(', ')}{ctx.contactEmpty.length ? ` · empty: ${ctx.contactEmpty.join(', ')}` : ''}</em>
                        : <em className="afeed__ctx-none">all empty</em>}
                    </li>
                  </ul>
                  {!ctx.canEdit && armOffer}
                </div>
              )}
              <SnapshotPanel back={back} openInitially={params.get('build') === '1'} onDone={() => { void load(); setPageNonce((n) => n + 1); }} />
            </>
          )}
        </>
      )}

      {/* A SPACE'S build thread (founder 2026-08-22): the same page-beside-
          conversation shape the profile thread has, about the space. The
          Current-cy room skips all of it — a money room has no page pane,
          no context card, no edit tools (founder 2026-10-06). */}
      {spaceId && !spaceRoom && (
        <>
          {/* In builder mode the split is gone (founder 2026-08-31: "too
              busy") — Preview under Claude's replies opens the page in its
              own tab instead. */}
          {!builderMode && (
          <div className="afeed__split">
            <button
              className={'afeed__split-side' + (!showPage ? ' is-on' : '')}
              onClick={() => setShowPage(false)}
            >
              Talk to Claude
            </button>
            <button
              className={'afeed__split-side' + (showPage ? ' is-on' : '')}
              onClick={() => { setShowPage(true); setPageNonce((n) => n + 1); }}
            >
              {possessive(sctx?.name ?? 'The space')} page
            </button>
          </div>
          )}
          {showPage ? (
            <div className="afeed__page">
              <iframe
                className="afeed__page-frame"
                key={pageNonce}
                src={`/spaces/${spaceId}?preview=1&embed=1`}
                title={`${possessive(sctx?.name ?? 'The space')} public page`}
              />
              <div className="afeed__page-foot">
                <button className="afeed__page-refresh" onClick={() => setPageNonce((n) => n + 1)}>
                  Refresh
                </button>
                <button className="afeed__page-refresh" onClick={() => window.open(`/spaces/${spaceId}?preview=1`, '_blank')}>
                  Open in a new tab
                </button>
              </div>
              <p className="afeed__page-note afeed__page-note--wide">
                This is the page as visitors see it.
              </p>
              <p className="afeed__page-note afeed__page-note--narrow">
                A whole page doesn&rsquo;t fit beside a conversation on a phone —
                open it in its own tab and flip between the two.
              </p>
            </div>
          ) : sctx && (
            <div className="afeed__ctx">
              <p className="afeed__ctx-lead">
                What I&rsquo;m working from{sctx.canEdit ? '' : ' — I can suggest, but not change anything yet'}:
              </p>
              <ul className="afeed__ctx-list">
                <li>
                  <span>Tagline</span>
                  {sctx.tagline ? <em>&ldquo;{sctx.tagline}&rdquo;</em> : <em className="afeed__ctx-none">none yet</em>}
                </li>
                <li>
                  <span>Story</span>
                  {sctx.storyWords
                    ? <em>{sctx.storyWords} words{sctx.homeSummary ? ', with its own Home welcome' : ', Home opens with its first two paragraphs'}</em>
                    : <em className="afeed__ctx-none">nothing written</em>}
                </li>
                <li>
                  <span>Description</span>
                  {sctx.hasDescription ? <em>written</em> : <em className="afeed__ctx-none">none yet</em>}
                </li>
                <li>
                  <span>Contact</span>
                  {sctx.contactFilled.length
                    ? <em>{sctx.contactFilled.join(', ')}{sctx.contactEmpty.length ? ` · empty: ${sctx.contactEmpty.join(', ')}` : ''}</em>
                    : <em className="afeed__ctx-none">all empty</em>}
                </li>
              </ul>
              {!sctx.aiEnabled ? (
                <p className="afeed__ctx-off">
                  {sctx.name} has its assistant switched off, so nothing here is
                  read or written for it. Its stewards can turn that back on in
                  Admin&nbsp;&rarr;&nbsp;Privacy.
                </p>
              ) : !sctx.isAdmin ? (
                <p className="afeed__ctx-off">
                  You&rsquo;re not a steward of {sctx.name} — I can help you take
                  part in it, but its page belongs to its admins.
                </p>
              ) : !sctx.canEdit && armOffer}
            </div>
          )}
        </>
      )}

      {/* THE LIST OF CONVERSATIONS (founder 2026-10-05: the email grammar —
          "a chronological order, most recent to oldest, of only chats that
          pertain to Marketplace"). Each row is one exchange, titled by its
          own first words — the self-organizing part she liked, kept. */}
      {listMode && (
        <div className="afeed__convos">
          <button className="afeed__convo-newbtn" onClick={() => {
            const next = new URLSearchParams(params);
            next.set('convo', 'new');
            setParams(next);
          }}>
            ⊕ New conversation
          </button>
          {loading && <p className="afeed__muted">Loading…</p>}
          {!loading && visibleConvos.length === 0 && q.trim() !== '' && (
            <p className="afeed__muted">No conversations match &ldquo;{q}&rdquo;.</p>
          )}
          {visibleConvos.map((c) => {
            const unread = convoUnread(c);
            return (
              <button className="afeed__convo" key={c.id} onClick={() => {
                // A foreign-thread row (General's history log) opens IN its
                // own thread — the conversation lives where it was formed.
                const next = new URLSearchParams(params);
                if (c.thread !== thread) next.set('thread', c.thread);
                next.set('convo', c.id);
                setParams(next);
              }}>
                <div className="afeed__convo-main">
                  {c.thread !== thread && (
                    <span className="afeed__convo-tag">{threadLabel(c.thread)}</span>
                  )}
                  <p className="afeed__convo-title">{c.title}</p>
                  <p className="afeed__convo-snippet">
                    {(c.last.author === 'claude' ? 'Claude: ' : 'You: ')
                      + ((c.last.body || '').trim().replace(/\s+/g, ' ') || 'a photo').slice(0, 90)}
                  </p>
                </div>
                <div className="afeed__convo-side">
                  <span className="afeed__convo-when">{timeAgo(c.last.created_at)}</span>
                  {unread > 0 && <em className="afeed__convo-pill">{unread}</em>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* The way back to the list — only when there IS a list behind you. */}
      {!listMode && personal && openConvo && convos.length > 1 && (
        <button className="afeed__convoback" onClick={() => {
          const next = new URLSearchParams(params);
          next.delete('convo');
          setParams(next);
          setAutoConvo(null);
        }}>
          ← All {threadLabel(thread)} conversations
        </button>
      )}

      {/* The conversation stays put while the page shows above it — that's
          the point: ask here, watch it change there. (This carried a `hidden`
          attribute that never did anything, since .afeed__list's own
          `display: flex` beats the UA stylesheet's [hidden]. Seeing both is
          what's wanted, so the intent is now stated rather than mis-stated.) */}
      {!listMode && (
      <div className="afeed__list">
        {loading && <p className="afeed__muted">Loading…</p>}
        {/* The greeting knows the section (founder 2026-08-31): an empty
            thread over an empty section offers to CREATE; over a section
            already holding their work, it welcomes them back. */}
        {!loading && visible.length === 0 && posts.length === 0 && (() => {
          const tdef = ASSISTANT_THREADS.find((t) => t.id === thread);
          const line = spaceRoom === 'currentcy'
            ? `Nothing here yet — ask about ${possessive(sctx?.name ?? 'this space')} treasury, its moves, or how it could earn more Current.`
            : spaceId
            ? `Nothing here yet — tell me about ${sctx?.name ?? 'this space'} and we’ll build its page together.`
            : tdef && setup
              ? (setup[thread] ? tdef.welcome : tdef.emptyAsk)
              : 'Nothing here yet — say hello below, or share a post into this feed from anywhere on Lichen.';
          return <p className="afeed__muted">{line}</p>;
        })()}
        {!loading && openConvo === 'new' && posts.length > 0 && (
          <p className="afeed__muted">A fresh conversation — say what&rsquo;s next.</p>
        )}
        {!loading && q.trim() !== '' && visible.length === 0 && viewEntries.length > 0 && (
          <p className="afeed__muted">No matches for &ldquo;{q}&rdquo;.</p>
        )}
        {visible.map((p) => {
          const shared = p.source_post_id ? sourcePosts.get(p.source_post_id) : null;
          return (
            <div className={'afeed__entry' + (p.author === 'claude' ? ' afeed__entry--claude' : '')} key={p.id}>
              {/* In a space's build thread, your entries wear the SPACE's
                  logo with your face as the small peach-ringed dot — the
                  steward-face idiom space chats already use (founder
                  2026-08-22: "the countryman logo and my face as a smaller
                  dot"). The space never speaks itself; you speak for it. */}
              {p.author !== 'claude' && spaceId ? (
                <Avatar
                  id={spaceId}
                  name={sctx?.name ?? 'This space'}
                  url={sctx?.avatarUrl}
                  size={30}
                  stewardFace={{ id: me, name: 'You', url: avatars.me }}
                />
              ) : (
                <Avatar
                  id={p.author === 'claude' ? CLAUDE_PROFILE_ID : me}
                  name={p.author === 'claude' ? 'Claude' : 'You'}
                  url={p.author === 'claude' ? avatars.claude : avatars.me}
                  size={30}
                />
              )}
              <div className="afeed__entry-body">
                {/* The chat grammar, everywhere (founder 2026-09-13: "make
                    that update everything"): the speaker's name + role above
                    the run, the time inside the bubble, and your OWN entries
                    unlabeled — a peach bubble on the right already says it's
                    you, the way chat does. In a space's build thread the
                    STEWARD speaks — the space never talks to Claude itself
                    (the chat rule: humans answer for a space), so that label
                    stays (founder 2026-08-22). */}
                {(p.author === 'claude' || spaceId) && (
                  <div className="afeed__entry-meta">
                    <span className="afeed__entry-name">
                      {p.author === 'claude' ? 'Claude' : 'You'}
                    </span>
                    <span className="afeed__entry-role">
                      · {p.author === 'claude' ? 'AI Assistant' : `steward of ${sctx?.name ?? 'this space'}`}
                    </span>
                  </div>
                )}
                {shared && (
                  <button className="afeed__ref" onClick={() => navigate(`/posts/${shared.id}`)}>
                    {shared.title || shared.body.slice(0, 60)}
                  </button>
                )}
                {/* Pasted photos ride the entry (founder 2026-08-22). */}
                {(p.attachments ?? []).some((a) => a.type === 'photo') && (
                  <div className="afeed__entry-shots">
                    {(p.attachments ?? []).flatMap((a) => (a.type === 'photo' ? [a] : [])).map((a) => (
                      <img key={a.url} src={a.url} alt="" loading="lazy"
                        onClick={() => window.open(a.url, '_blank')} />
                    ))}
                  </div>
                )}
                {p.body && (
                  <p className="afeed__entry-text">
                    {p.body}
                    {/* Time rides INSIDE the bubble, lower right — the chat
                        grammar (founder 2026-09-13). */}
                    <span className="afeed__entry-when">{timeAgo(p.created_at)}</span>
                  </p>
                )}
                {!p.body && (
                  <span className="afeed__entry-when afeed__entry-when--bare">{timeAgo(p.created_at)}</span>
                )}
                {/* PREVIEW AND PUBLISH LIVE IN THE TEXT (founder 2026-08-31):
                    the newest reply that edited the page carries the doors.
                    Preview opens a NEW TAB on the draft, landed on the tab
                    the edit touched; Publish makes the draft live. Once
                    published (here or in the builder), the row says so. */}
                {lastPageEdit?.postId === p.id && chatDraft && (
                  <div className="afeed__pubrow">
                    {chatDraft === 'has' ? (
                      <>
                        <span className="afeed__pubstate">In the draft — not live yet</span>
                        <button className="afeed__publink" type="button"
                          onClick={() => window.open(editPageUrl(true), '_blank')}>
                          ↗ Preview
                        </button>
                        <button className="afeed__pubbtn" type="button" disabled={pubBusy}
                          onClick={() => void publishFromChat()}>
                          {pubBusy ? 'Publishing…' : 'Publish changes'}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="afeed__pubstate afeed__pubstate--live">Published ✓</span>
                        <button className="afeed__publink" type="button"
                          onClick={() => window.open(editPageUrl(false), '_blank')}>
                          ↗ See it live
                        </button>
                      </>
                    )}
                    {pubErr && <span className="afeed__puberr">{pubErr}</span>}
                  </div>
                )}
                {/* THE TREASURY + CONSENT DOORS (founder 2026-10-06): a reply
                    that verified a handoff carries the button that switches
                    the hat and opens the space's Current-cy room; a reply
                    that hit a consent switch carries the turn-it-back-on
                    offer instead — the person taps, nothing flips itself. */}
                {p.author === 'claude' && (p.attachments ?? [])
                  .flatMap((a) => (a.type === 'space_thread' || a.type === 'space_consent' ? [a] : []))
                  .map((a) => (
                    <div className="afeed__pubrow" key={`${p.id}:${a.type}:${a.id}`}>
                      <button className="afeed__pubbtn" type="button" disabled={doorBusy}
                        onClick={() => void enterTreasury(a)}>
                        {doorBusy ? 'Opening…'
                          : a.type === 'space_consent'
                          ? (a.which === 'member'
                            ? `Turn AI back on for you in ${a.name} & open its Current-cy room`
                            : `Turn ${possessive(a.name)} assistant back on & open its Current-cy room`)
                          : `Open ${possessive(a.name)} Current-cy room →`}
                      </button>
                      {doorErr && <span className="afeed__puberr">{doorErr}</span>}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
        {thinking && (
          <div className="afeed__entry afeed__entry--claude" aria-live="polite">
            <Avatar id={CLAUDE_PROFILE_ID} name="Claude" url={avatars.claude} size={30} />
            <div className="afeed__entry-body">
              <div className="afeed__entry-meta">
                <span className="afeed__entry-name">Claude</span>
                <span className="afeed__entry-role">· AI Assistant</span>
              </div>
              <p className="afeed__thinking" aria-label="Claude is thinking">
                <span /><span /><span />
              </p>
            </div>
          </div>
        )}
        {replyLost && (
          <p className="afeed__lost">
            No reply arrived — something hiccuped on my end, and I won&rsquo;t
            answer this one late. Say it again and I&rsquo;ll take another run.
          </p>
        )}

        {/* THE PERMISSION LIVES WHERE THE ASKING HAPPENS (founder 2026-08-28:
            "if you want claude to build it, you're signaling you want claude
            to have edit access"). This offer already existed — buried in the
            context card above the conversation — so a member who asked Claude
            to change their page was told no while the yes sat off-screen.
            Asking IS the signal; the consent belongs next to it.

            The two-step confirm is kept exactly as it was, and the model
            still cannot grant itself anything: it can say it lacks the
            switch, and the person taps. A model that could arm its own write
            access would make the consent worthless. */}
        {!loading && visible.length > 0
          && (spaceId ? (!spaceRoom && sctx && !sctx.canEdit) : (ctx && !ctx.canEdit)) && (
          <div className="afeed__arm">{armOffer}</div>
        )}
      </div>
      )}

      {/* A door can arrive with its errand via ?ask= (the same prefill
          AssistantBrief carries): it lands unsent, so "write my home summary"
          can become "…and keep it under 100 words, mention the pasture"
          before it goes. Keyed so a new ?ask always lands even if the
          composer is already mounted. The list carries no composer — a new
          exchange starts through its own ⊕ door, email's way. */}
      {!listMode && !(personal && loading) && (
      <AssistantComposer
        key={params.get('ask') ?? 'blank'}
        onSend={send}
        initialText={params.get('ask') ?? undefined}
        placeholder="Say something…"
        uploaderId={me || undefined}
      />
      )}
      <div ref={feedEndRef} aria-hidden="true" />
    </div>
  );
}
