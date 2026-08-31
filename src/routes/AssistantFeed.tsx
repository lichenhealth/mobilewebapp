import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import AssistantComposer from '../components/AssistantComposer';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { useTopIdentityFor } from '../lib/topIdentity';
import { supabase } from '../lib/supabase';
import { CLAUDE_PROFILE_ID } from '../lib/chatApi';
import {
  loadAssistantFeed, postToAssistantFeed, loadThreadCounts, loadProfileContext,
  loadSpaceContext, spaceIdOfThread, loadSectionPresence,
  ASSISTANT_THREADS, threadLabel, type FeedPostRow, type ProfileContext, type SpaceContext,
} from '../lib/assistantFeedApi';
import type { IconName } from '../components/Icon';
import { possessive } from '../lib/names';
import SnapshotPanel from '../components/SnapshotPanel';
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
  const { actor, ready: actingReady } = useActing();
  useEffect(() => {
    if (!actingReady) return;
    if (thread === 'profile' && actor.type === 'space') {
      const next = new URLSearchParams(params);
      next.set('thread', `space:${actor.id}`);
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
  // and reloads the moment a change lands. `?page=1` (the page builders'
  // Build-with-Claude door) opens it from the first paint, so arriving from
  // the website builder you land facing the website, not a bare chat.
  const [showPage, setShowPage] = useState(() => params.get('page') === '1');
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
  const [sourcePosts, setSourcePosts] = useState<Map<string, FeedPost>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [avatars, setAvatars] = useState<{ me?: string | null; claude?: string | null }>({});

  const load = async () => {
    if (!me) return;
    void loadThreadCounts(me).then(setCounts);
    const rows = await loadAssistantFeed(me, thread);
    setPosts(rows);
    setLoading(false);
    const sourceIds = [...new Set(rows.map((r) => r.source_post_id).filter((id): id is string => !!id))];
    if (sourceIds.length) {
      const sp = await loadPostsByIds(sourceIds);
      setSourcePosts(new Map(sp.map((p) => [p.id, p])));
    }
  };
  useEffect(() => { setLoading(true); void load(); }, [me, thread]);

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
          void loadThreadCounts(me).then(setCounts);
          if ((row.thread ?? 'general') !== thread) return;   // another thread's business
          setPosts((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
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
    return needle ? posts.filter((p) => p.body.toLowerCase().includes(needle)) : posts;
  }, [q, posts]);

  // THE THINKING WHEEL (founder 2026-08-22: "is he still thinking or is
  // there a bug?"). Derived, not tracked: if the thread's newest entry is
  // the member's and young, Claude is composing — show the pulse. If it's
  // the member's and stale, the reply was LOST (the trigger fires once, no
  // retry) — say so honestly instead of spinning forever. Derivation means
  // reloads and arriving from a brief's composer show the right state too.
  const THINKING_MS = 90_000;          // replies land well inside this
  const STALE_NOTE_MS = 60 * 60_000;   // older than an hour is just history
  const [nowTick, setNowTick] = useState(() => Date.now());
  const lastPost = posts[posts.length - 1];
  const lastIsMine = !!lastPost && lastPost.author === 'member';
  const lastAge = lastIsMine ? nowTick - new Date(lastPost.created_at).getTime() : Infinity;
  const thinking = lastIsMine && lastAge < THINKING_MS;
  const replyLost = lastIsMine && lastAge >= THINKING_MS && lastAge < STALE_NOTE_MS;
  useEffect(() => {
    if (!lastIsMine || lastAge >= STALE_NOTE_MS) return;
    const t = setInterval(() => setNowTick(Date.now()), 3000);
    return () => clearInterval(t);
  }, [lastIsMine, lastAge >= STALE_NOTE_MS, posts.length]);

  async function send(text: string, images?: string[]) {
    // The realtime subscription above picks up both this insert and
    // Claude's reply — no need to refetch.
    await postToAssistantFeed(text, undefined, thread, images);
  }

  return (
    <div className={'afeed' + (showPage && (thread === 'profile' || spaceId) ? ' afeed--paged' : '')}>
      <button className="cmp__back afeed__back" onClick={() => (back ? navigate(back) : navigate(-1))}>
        ← {back ? 'Back to manual mode' : 'Back'}
      </button>

      <header className="afeed__head">
        <Avatar id={CLAUDE_PROFILE_ID} name="Claude" url={avatars.claude} size={44} />
        <div className="afeed__head-text">
          <h1 className="afeed__title">{builderMode ? 'Public Profile Builder' : 'Claude'}</h1>
          <p className="afeed__sub">
            {builderMode
              ? `Build with Claude — ${possessive(sctx?.name ?? 'this space')} website changes beside the conversation.`
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
      {!builderMode && (
      <div className="afeed__threads h-scroll">
        {ASSISTANT_THREADS.map((t) => {
          const off = setup ? !setup[t.id] : false;
          return (
            <button
              key={t.id}
              className={'afeed__thread' + (t.id === thread ? ' is-on' : '') + (off ? ' is-off' : '')}
              title={`${t.label} — ${t.blurb}`}
              aria-label={t.label}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('thread', t.id);
                setParams(next, { replace: true });
              }}
            >
              <Icon name={t.icon as IconName} size={20} />
              {counts[t.id] ? <em>{counts[t.id]}</em> : null}
            </button>
          );
        })}
        {/* A space's build thread joins the rail while you're in it — a
            dynamic room, not one of the six standing ones; it wears the
            space's own face. */}
        {spaceId && (
          <button className="afeed__thread afeed__thread--space is-on" title={`Building ${possessive(sctx?.name ?? 'this space')} page`} aria-label={sctx?.name ?? 'This space'}>
            <Avatar id={spaceId} name={sctx?.name ?? 'This space'} url={sctx?.avatarUrl} size={44} />
            {counts[thread] ? <em>{counts[thread]}</em> : null}
          </button>
        )}
      </div>
      )}

      {/* Building your presence happens HERE, in the profile thread, rather
          than off in a screen of its own (founder 2026-08-11). */}
      {thread === 'profile' && (
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
          conversation shape the profile thread has, about the space. */}
      {spaceId && (
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
              {possessive(sctx?.name ?? 'The space')} page
            </button>
          </div>
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

      {/* The conversation stays put while the page shows above it — that's
          the point: ask here, watch it change there. (This carried a `hidden`
          attribute that never did anything, since .afeed__list's own
          `display: flex` beats the UA stylesheet's [hidden]. Seeing both is
          what's wanted, so the intent is now stated rather than mis-stated.) */}
      <div className="afeed__list">
        {loading && <p className="afeed__muted">Loading…</p>}
        {/* The greeting knows the section (founder 2026-08-31): an empty
            thread over an empty section offers to CREATE; over a section
            already holding their work, it welcomes them back. */}
        {!loading && visible.length === 0 && posts.length === 0 && (() => {
          const tdef = ASSISTANT_THREADS.find((t) => t.id === thread);
          const line = spaceId
            ? `Nothing here yet — tell me about ${sctx?.name ?? 'this space'} and we’ll build its page together.`
            : tdef && setup
              ? (setup[thread] ? tdef.welcome : tdef.emptyAsk)
              : 'Nothing here yet — say hello below, or share a post into this feed from anywhere on Lichen.';
          return <p className="afeed__muted">{line}</p>;
        })()}
        {!loading && visible.length === 0 && posts.length > 0 && (
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
                <div className="afeed__entry-meta">
                  {/* In a space's build thread the STEWARD speaks — the space
                      never talks to Claude itself (the chat rule: humans
                      answer for a space). Saying so is what keeps the CS hat
                      + your face from reading as a bug (founder 2026-08-22). */}
                  <span className="afeed__entry-name">
                    {p.author === 'claude' ? 'Claude'
                      : spaceId ? `You · steward of ${sctx?.name ?? 'this space'}` : 'You'}
                  </span>
                  <span className="afeed__entry-time">{timeAgo(p.created_at)}</span>
                </div>
                {shared && (
                  <button className="afeed__ref" onClick={() => navigate(`/posts/${shared.id}`)}>
                    {shared.title || shared.body.slice(0, 60)}
                  </button>
                )}
                {/* Pasted photos ride the entry (founder 2026-08-22). */}
                {(p.attachments?.length ?? 0) > 0 && (
                  <div className="afeed__entry-shots">
                    {p.attachments!.filter((a) => a.type === 'photo').map((a) => (
                      <img key={a.url} src={a.url} alt="" loading="lazy"
                        onClick={() => window.open(a.url, '_blank')} />
                    ))}
                  </div>
                )}
                {p.body && <p className="afeed__entry-text">{p.body}</p>}
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
          && (spaceId ? (sctx && !sctx.canEdit) : (ctx && !ctx.canEdit)) && (
          <div className="afeed__arm">{armOffer}</div>
        )}
      </div>

      {/* A door can arrive with its errand via ?ask= (the same prefill
          AssistantBrief carries): it lands unsent, so "write my home summary"
          can become "…and keep it under 100 words, mention the pasture"
          before it goes. Keyed so a new ?ask always lands even if the
          composer is already mounted. */}
      <AssistantComposer
        key={params.get('ask') ?? 'blank'}
        onSend={send}
        initialText={params.get('ask') ?? undefined}
        placeholder="Say something…"
        uploaderId={me || undefined}
      />
    </div>
  );
}
