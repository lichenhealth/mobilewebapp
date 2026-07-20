import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import {
  loadPost, deletePost, postAreas, SERVICE_AREAS, type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './PostPage.css';

/** Where each service area lives — the frozen bar's "relevant places" doors. */
const AREA_HOME: Partial<Record<ServiceArea, string>> = {
  marketplace: '/market', courses: '/courses', library: '/library',
  events: '/events', work: '/work', places: '/places',
  art: '/art', food: '/food',
};

/** The post's own page (Figma 286-6331/286-6469): the full read — complete
 *  body, full-height media — under a FROZEN action bar: back, the areas the
 *  post lives in, and its engagement actions, pinned while you read. */
export default function PostPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { promptSaved, openPicker } = useCollect();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [ready, setReady] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState<MyceliumSignals | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setReady(false);
    (async () => {
      const p = await loadPost(postId);
      if (!live) return;
      if (p?.linked_event_id) { navigate(`/events/${p.id}`, { replace: true }); return; }
      setPost(p);
      if (p && me) {
        const [{ web, vouched: myc }, recs, saves] = await Promise.all([
          loadMyWeb(), loadMyRecommendations(), loadMySaved(),
        ]);
        const ov = await loadEndorsements([p], myc);
        if (!live) return;
        setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves);
        setOverlay(ov[p.id]);
      }
      setReady(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, me]);

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/home');
  };

  if (!ready) {
    return <div className="postp"><p className="postp__muted">Loading…</p></div>;
  }
  if (!post) {
    return (
      <div className="postp">
        <button className="cmp__back" onClick={back}><Icon name="arrow-left" size={14} /> Back</button>
        <p className="postp__muted">This post isn&rsquo;t here anymore.</p>
      </div>
    );
  }

  const p = post;
  const saved = mySaves.has('post:' + p.id);
  const recommended = myRecs.has('post:' + p.id);
  const areas = postAreas(p).filter((a) => AREA_HOME[a]);

  return (
    <div className="postp">
      {/* Frozen bar: back to where you were + the areas this post lives in +
          its actions — pinned below the TopBar while the body scrolls. */}
      <div className="postp__pin">
        <button className="cmp__back postp__back" onClick={back}>
          <Icon name="arrow-left" size={14} /> Back
        </button>
        <div className="postp__doors">
          {areas.map((a) => (
            <button className="postp__door" key={a} onClick={() => navigate(AREA_HOME[a]!)}>
              {SERVICE_AREAS.find((s) => s.value === a)?.label ?? a}
            </button>
          ))}
        </div>
        {me && (
          <div className="postp__acts">
            <button
              className={'postp__act' + (recommended ? ' is-on' : '')}
              aria-label={recommended ? 'Withdraw recommendation' : 'Recommend'}
              onClick={() => {
                const next = !recommended;
                setMyRecs((cur) => {
                  const n = new Set(cur);
                  if (next) n.add('post:' + p.id); else n.delete('post:' + p.id);
                  return n;
                });
                void setRecommend('post', p.id, next).catch(console.error);
              }}
            >
              <Icon name="thumbs-up" size={16} />
            </button>
            <button
              className={'postp__act' + (saved ? ' is-on' : '')}
              aria-label={saved ? 'Unsave' : 'Save'}
              onClick={() => {
                const next = !saved;
                setMySaves((cur) => {
                  const n = new Set(cur);
                  if (next) n.add('post:' + p.id); else n.delete('post:' + p.id);
                  return n;
                });
                void setSaved('post', p.id, next).then(() => { if (next) promptSaved(p.id); }).catch(console.error);
              }}
            >
              <Icon name="bookmark" size={16} />
            </button>
          </div>
        )}
      </div>

      <FeedCard
        {...postToCard(p, me || undefined)}
        {...weaveProps(p, myWebSet, me || undefined)}
        expanded
        trusted={myMyc.has('profile:' + p.author_id)}
        recommended={recommended}
        mycelium={overlay}
        availability={{ trust: !!me && p.author_id !== me }}
        onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
        onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
        saved={saved}
        onSave={(on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); }}
        extraMenuItems={me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined}
        viewerIsAuthor={p.author_id === me}
        onEdit={() => navigate(`/compose?post=${p.id}`)}
        onDelete={() => { void deletePost(p.id).then(back).catch(console.error); }}
        onHide={me ? () => { void setHidden(p.id, true).then(back).catch(console.error); } : undefined}
        onMessage={me && p.author_id !== me ? async () => {
          try { navigate(`/chat/${await ensureDirectChat(p.author_id)}`); } catch (e) { console.error(e); }
        } : undefined}
        onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
      />
    </div>
  );
}
