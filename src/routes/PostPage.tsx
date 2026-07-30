import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import SiteHeader from '../components/SiteHeader';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { loadTrustWeb, trustPathTo, namesFor } from '../lib/trustPath';
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
import { loadSpaceNames } from '../lib/postsApi';

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
  // The mutual-friend line at the decision moment (founder 2026-07-28).
  const [trustLine, setTrustLine] = useState<string | undefined>(undefined);
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());
  const me = user?.id ?? '';
  const { promptSaved, openPicker } = useCollect();

  const [post, setPost] = useState<FeedPost | null>(null);
  // Provenance names for this one post.
  useEffect(() => {
    const ids = post?.audience_space_ids ?? [];
    if (!ids.length) return;
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [post?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [ready, setReady] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlay, setOverlay] = useState<MyceliumSignals | undefined>(undefined);

  useEffect(() => {
    if (!user?.id || !post) { setTrustLine(undefined); return; }
    let live = true;
    void (async () => {
      const web = await loadTrustWeb(user.id);
      const hit = post.author_space_id
        ? trustPathTo(web, 'space', post.author_space_id)
        : trustPathTo(web, 'profile', post.author_id);
      if (!hit || !live) return;
      if (hit.degree === 'mine') { setTrustLine(post.author_id === user.id ? undefined : 'Someone you trust'); return; }
      const names = hit.via ? await namesFor([hit.via]) : new Map();
      if (live) setTrustLine(hit.via && names.get(hit.via)
        ? `Trusted by ${names.get(hit.via)} — someone you trust`
        : 'Trusted by someone you trust');
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, post?.id]);

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

  // Signed-out readers get the website chrome (founder 2026-07-30).
  useEffect(() => {
    if (me) return;
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, [me]);

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
    <>
    {!me && <SiteHeader />}
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
        {...postToCard(p, me || undefined, spaceNames)}
        trustLine={trustLine}
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
          try { navigate(`/chat/${await ensureDirectChat(p.author_id)}?about=${p.id}`); } catch (e) { console.error(e); }
        } : undefined}
        onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
      />

      {/* Visual style, stage 1: what the listing photo looks like, in the
          controlled vocabulary — helps a seeker feel whether it's their
          aesthetic before a single message is sent. */}
      {Array.isArray((p.details as { styleTags?: string[] })?.styleTags) &&
        ((p.details as { styleTags: string[] }).styleTags.length > 0) && (
        <div className="postp__style">
          {(p.details as { styleTags: string[] }).styleTags.map((t) => (
            <span className="postp__style-tag" key={t}>{t}</span>
          ))}
        </div>
      )}

      {/* The growth loop (founder 2026-07-29): a signed-out reader who
          liked what they read gets the door, right where they finished. */}
      {!user && (
        <section className="postp__join">
          <p className="postp__join-lead">This lives on <strong>Lichen</strong>.</p>
          <p className="postp__join-sub">
            A member-run network for care, work, offerings and a fairer
            economy — where trust is a path through real relationships, not a
            star rating. Lichen grows by invitation; introduce yourself and a
            real person writes back.
          </p>
          <div className="postp__join-acts">
            <button className="btn btn-primary" onClick={() => navigate('/signup')}>Request an invitation</button>
            <button className="btn" onClick={() => navigate('/about')}>What is Lichen?</button>
          </div>
        </section>
      )}
    </div>
    </>
  );
}
