import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import AssistantComposer from '../components/AssistantComposer';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { CLAUDE_PROFILE_ID } from '../lib/chatApi';
import {
  loadAssistantFeed, postToAssistantFeed, loadThreadCounts,
  ASSISTANT_THREADS, threadLabel, type FeedPostRow,
} from '../lib/assistantFeedApi';
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
  // room, ?back= the way home to whatever sent you here.
  const [params, setParams] = useSearchParams();
  const thread = params.get('thread') || 'general';
  const back = params.get('back') || '';
  const [counts, setCounts] = useState<Record<string, number>>({});

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
          if ((row.thread ?? 'general') !== thread) return;   // another room's business
          setPosts((cur) => (cur.some((p) => p.id === row.id) ? cur : [...cur, row]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [me, thread]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? posts.filter((p) => p.body.toLowerCase().includes(needle)) : posts;
  }, [q, posts]);

  async function send(text: string) {
    // The realtime subscription above picks up both this insert and
    // Claude's reply — no need to refetch.
    await postToAssistantFeed(text, undefined, thread);
  }

  return (
    <div className="afeed">
      <button className="cmp__back" onClick={() => (back ? navigate(back) : navigate(-1))}>
        ← {back ? 'Back to manual mode' : 'Back'}
      </button>

      <header className="afeed__head">
        <Avatar id={CLAUDE_PROFILE_ID} name="Claude" url={avatars.claude} size={44} />
        <div className="afeed__head-text">
          <h1 className="afeed__title">Claude</h1>
          <p className="afeed__sub">
            {thread === 'general'
              ? 'Everything you’ve shared and asked — and it can draw on every room.'
              : `${threadLabel(thread)} — this room keeps that work together.`}
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

      {/* The rooms. General leads; a room with history shows its weight,
          and the rest stay available so work has somewhere to land. */}
      <div className="afeed__rooms h-scroll">
        {ASSISTANT_THREADS.map((t) => (
          <button
            key={t.id}
            className={'afeed__room' + (t.id === thread ? ' is-on' : '')}
            title={t.blurb}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('thread', t.id);
              setParams(next, { replace: true });
            }}
          >
            {t.label}
            {counts[t.id] ? <em>{counts[t.id]}</em> : null}
          </button>
        ))}
      </div>

      {/* Building your presence happens HERE, in the profile room, rather
          than off in a screen of its own (founder 2026-08-11). */}
      {thread === 'profile' && <SnapshotPanel back={back} onDone={() => void load()} />}

      <div className="afeed__list">
        {loading && <p className="afeed__muted">Loading…</p>}
        {!loading && visible.length === 0 && posts.length === 0 && (
          <p className="afeed__muted">Nothing here yet — say hello below, or share a post into this feed from anywhere on Lichen.</p>
        )}
        {!loading && visible.length === 0 && posts.length > 0 && (
          <p className="afeed__muted">No matches for &ldquo;{q}&rdquo;.</p>
        )}
        {visible.map((p) => {
          const shared = p.source_post_id ? sourcePosts.get(p.source_post_id) : null;
          return (
            <div className={'afeed__entry' + (p.author === 'claude' ? ' afeed__entry--claude' : '')} key={p.id}>
              <Avatar
                id={p.author === 'claude' ? CLAUDE_PROFILE_ID : me}
                name={p.author === 'claude' ? 'Claude' : 'You'}
                url={p.author === 'claude' ? avatars.claude : avatars.me}
                size={30}
              />
              <div className="afeed__entry-body">
                <div className="afeed__entry-meta">
                  <span className="afeed__entry-name">{p.author === 'claude' ? 'Claude' : 'You'}</span>
                  <span className="afeed__entry-time">{timeAgo(p.created_at)}</span>
                </div>
                {shared && (
                  <button className="afeed__ref" onClick={() => navigate(`/posts/${shared.id}`)}>
                    {shared.title || shared.body.slice(0, 60)}
                  </button>
                )}
                <p className="afeed__entry-text">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      <AssistantComposer onSend={send} placeholder="Say something…" />
    </div>
  );
}
