import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import SiteHeader from '../components/SiteHeader';
import FeedCard from '../components/FeedCard';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { loadTrustWeb, loadTrustEdgesFor, trustPathTo, namesFor } from '../lib/trustPath';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { listBudgetPostIds, addBudgetPost, removeBudgetPost } from '../lib/budgetApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import {
  loadPost, deletePost, postAreas, SERVICE_AREAS, type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { postToCard, weaveProps, postOpenPath } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import './PostPage.css';
import { loadSpaceNames } from '../lib/postsApi';
import ExchangePanel from '../components/ExchangePanel';
import ListingTile from '../components/ListingTile';
import { loadRelatedGifts, giftMode } from '../lib/relatedGifts';

/** Where each service area lives — the frozen bar's "relevant places" doors. */
const AREA_HOME: Partial<Record<ServiceArea, string>> = {
  marketplace: '/market', courses: '/courses', library: '/library',
  events: '/events', work: '/work', places: '/places',
  art: '/art', food: '/food', travel: '/travel',
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
  const [myBudget, setMyBudget] = useState<Set<string>>(new Set());
  // EVERY TAP ON THE ACTION CIRCLES SPEAKS (founder 2026-10-21, tapping the
  // lit bolt: "When I click on it, nothing happens" — it was toggling her
  // budget silently): a short receipt under the row names what just changed
  // and doors to where it lives, then steps away.
  const [actNote, setActNote] = useState<{ text: string; to?: { label: string; path: string } } | null>(null);
  const noteTimer = useRef<number | null>(null);
  useEffect(() => () => { if (noteTimer.current) window.clearTimeout(noteTimer.current); }, []);
  const [overlay, setOverlay] = useState<MyceliumSignals | undefined>(undefined);

  useEffect(() => {
    // Trust stays person-only (founder 2026-08-07) — a space-authored post
    // has no trust path, only its author (a person) can.
    if (!user?.id || !post || post.author_space_id) { setTrustLine(undefined); return; }
    let live = true;
    void (async () => {
      const web = await loadTrustWeb(user.id);
      // mycelium's RLS only returns MY OWN edges now — fetch the author's
      // own edges too, scoped to just this one post, for the 2-hop check.
      const extra = await loadTrustEdgesFor([{ type: 'profile', id: post.author_id }]);
      const hit = trustPathTo({ ...web, edges: [...web.edges, ...extra] }, 'profile', post.author_id);
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
        const [{ web, vouched: myc }, recs, saves, budg] = await Promise.all([
          loadMyWeb(), loadMyRecommendations(), loadMySaved(), listBudgetPostIds(me),
        ]);
        const ov = await loadEndorsements([p], { web, vouched: myc });
        if (!live) return;
        setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves);
        setMyBudget(budg);
        setOverlay(ov[p.id]);
      }
      setReady(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, me]);

  // MORE GIFTS FOR YOU (founder 2026-10-23): on a gift's page, other gifts
  // the viewer qualifies for, most relevant first — deterministic ranking,
  // see relatedGifts.ts. Loads after the post so the read never blocks it.
  const [related, setRelated] = useState<FeedPost[]>([]);
  useEffect(() => {
    setRelated([]);
    if (!post || !giftMode(post)) return;
    let live = true;
    void loadRelatedGifts(post, me || null)
      .then((rows) => { if (live) setRelated(rows); })
      .catch(console.error);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id, me]);

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
        <PageHead onBack={back} />
        <p className="postp__muted">This post isn&rsquo;t here anymore.</p>
      </div>
    );
  }

  const p = post;
  const saved = mySaves.has('post:' + p.id);
  const budgeted = myBudget.has(p.id);
  const recommended = myRecs.has('post:' + p.id);
  const speak = (text: string, to?: { label: string; path: string }) => {
    setActNote({ text, to });
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setActNote(null), 6000);
  };
  const areas = postAreas(p).filter((a) => AREA_HOME[a]);
  const isMarket = postAreas(p).includes('marketplace') && !p.linked_event_id;
  // TRAVEL IS AN EXCHANGE (founder 2026-10-06): a ride or a stay gets the
  // same exchange door and facts panel a marketplace listing gets — the
  // SF-apartment-for-French-villa trade closes here, not in a DM.
  const isTravel = postAreas(p).includes('travel') && !p.linked_event_id;

  // The five fields Compose has written since 2026-07-28 with no reader.
  const d = (p.details ?? {}) as Record<string, unknown>;
  const CONDITION: Record<string, string> = {
    new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair',
  };
  const FULFILMENT: Record<string, string> = {
    pickup: 'Pick up', deliver: 'Delivered', ship: 'Shipped', in_store: 'In store', digital: 'Digital',
  };
  const listOf = (v: unknown, map: Record<string, string>) =>
    Array.isArray(v) ? (v as string[]).map((x) => map[x] ?? x).join(' · ') : '';
  const when = [d.availFrom, d.availTo].filter(Boolean) as string[];
  const route = [d.routeFrom, d.routeTo].filter((x) => typeof x === 'string' && x) as string[];
  const facts: { label: string; value: string }[] = [
    { label: 'Kind', value: d.travelKind === 'ride' ? 'Ride / transport' : d.travelKind === 'flight' ? 'Flight' : d.travelKind === 'stay' ? 'Stay / place' : '' },
    { label: 'Route', value: route.join(' → ') },
    { label: 'Vehicle', value: typeof d.vehicle === 'string' ? d.vehicle : '' },
    { label: 'Seats', value: typeof d.seats === 'number' ? String(d.seats) : '' },
    { label: 'Sleeps', value: typeof d.sleeps === 'number' ? String(d.sleeps) : '' },
    { label: 'Condition', value: listOf(d.condition, CONDITION) },
    {
      label: when.length === 2 ? 'Available' : 'Available',
      value: when.length === 2 ? `${when[0]} – ${when[1]}` : (when[0] ?? ''),
    },
    {
      // No label — the values say it themselves (founder 2026-10-23: "The
      // gray text is redundant so let's get rid of it").
      label: '',
      value: [listOf(d.fulfillment, FULFILMENT),
        d.deliverRadiusMi ? `within ${d.deliverRadiusMi} mi` : '']
        .filter(Boolean).join(' · '),
    },
    { label: 'Payment', value: (d.paymentPlan as string) ?? '' },
  ].filter((f) => f.value);
  // THE TERMS LEAD (founder 2026-10-23: "the conditions should be in the
  // post … right below the gift and then the description. Conditions of
  // sale, gift, lend, etc should always sit before description, in case they
  // change someone's interest"): the facts fold into the card as plain
  // lines, between the mode line and the words.
  const condLines = (isMarket || isTravel)
    ? facts.map((f) => (f.label ? `${f.label}: ${f.value}` : f.value))
    : [];

  return (
    <>
    {!me && <SiteHeader />}
    <div className="postp">
      {/* Frozen bar: back to where you were + the areas this post lives in +
          its actions — pinned below the TopBar while the body scrolls. */}
      <div className="postp__pin">
        <PageHead onBack={back} />
        <div className="postp__doors">
          {areas.map((a) => (
            <button className="postp__door" key={a} onClick={() => navigate(AREA_HOME[a]!)}>
              {SERVICE_AREAS.find((s) => s.value === a)?.label ?? a}
            </button>
          ))}
        </div>
        {/* The top-right action circles RETIRED 2026-10-21 (founder: "the
            recommend is at the bottom, so is the drive, so they don't need
            to be top right?") — the card's own footer carries Recommend /
            Share / Save / Budget / Chat, once. */}
      </div>
      <FeedCard
        {...postToCard(p, me || undefined, spaceNames)}
        trustLine={trustLine}
        {...weaveProps(p, myWebSet, me || undefined)}
        expanded
        conditions={condLines.length > 0 ? condLines : undefined}
        trusted={myMyc.has('profile:' + p.author_id)}
        recommended={recommended}
        mycelium={overlay}
        availability={{ trust: !!me && p.author_id !== me }}
        onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
        onRecommend={(on) => {
          void setRecommend('post', p.id, on).catch(console.error);
          speak(on ? 'Recommended ✓ — your network can see you stand behind it.' : 'Recommendation withdrawn.');
        }}
        saved={saved}
        onSave={(on) => {
          void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error);
          speak(on ? 'Saved to your Drive ✓' : 'Removed from your Drive.',
            on ? { label: 'Open Drive', path: '/drive' } : undefined);
        }}
        budgeted={budgeted}
        onBudget={me ? (on) => {
          setMyBudget((cur) => {
            const n = new Set(cur);
            if (on) n.add(p.id); else n.delete(p.id);
            return n;
          });
          void (on ? addBudgetPost(me, p.id) : removeBudgetPost(me, p.id)).catch(console.error);
          speak(on
            ? 'On your Budget ✓ — a planning note in Current-cy with its live price. Not a purchase.'
            : 'Off your budget.',
            on ? { label: 'See your budget', path: '/currentcy' } : undefined);
        } : undefined}
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

      {/* The receipt for the footer's actions — names what just changed and
          doors to where it lives, then steps away (founder 2026-10-21:
          "When I click on it, nothing happens"). */}
      {actNote && (
        <p className="postp__actnote" role="status">
          {actNote.text}
          {actNote.to && (
            <>
              {' '}
              <button className="postp__actnote-go link-cue" onClick={() => navigate(actNote.to!.path)}>
                {actNote.to.label} ›
              </button>
            </>
          )}
        </p>
      )}

      {/* THE EXCHANGE (founder 2026-08-05). A marketplace listing finally has
          a door forward that isn't a pasted URL: ask for it, then a live strip
          showing what it's waiting on. */}
      {(isMarket || isTravel) && me && (
        <ExchangePanel post={p} me={me} />
      )}

      {/* The physical facts moved INTO the card (founder 2026-10-23: "the
          conditions should be in the post, not a separate one") — see
          condLines above; the separate labeled card is gone. */}

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

      {/* MORE GIFTS FOR YOU (founder 2026-10-23: "a gray line and then list
          all other gift items that the person qualifies for … so they can
          keep scrolling … in order of most relevant to least relevant"):
          only gifts whose targeting the viewer meets, ranked by the
          same-shirts → same-family → any-gift ladder. */}
      {related.length > 0 && (
        <section className="postp__moregifts">
          <p className="postp__moregifts-lead">More gifts for you</p>
          <div className="tile-grid">
            {related.map((rp) => (
              <ListingTile
                key={rp.id}
                post={rp}
                offer="Gift"
                modeIcons={['gift']}
                onOpen={() => navigate(postOpenPath(rp))}
              />
            ))}
          </div>
        </section>
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
