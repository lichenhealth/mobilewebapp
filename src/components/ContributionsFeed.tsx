import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FeedCard from './FeedCard';
import { Icon, IconName } from './Icon';
import { ScopeEmpty } from './ScopeEscape';
import { aiDoorOn } from './AssistantDoor';
import { ensureDirectChat } from '../lib/chatApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { recurrenceLabel } from '../lib/recurrence';
import { minToLabel } from '../lib/calendarApi';
import {
  loadAuthorFeed, deletePost, postAreas, SERVICE_AREAS,
  type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend } from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import type { MyceliumSignals } from './EngagementFooter';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import './ContributionsFeed.css';
import { loadSpaceNames } from '../lib/postsApi';

// ALL / SOCIAL / ACTIONABLE RETIRED (founder 2026-08-07): the area circles
// below already say what this entity does, and a second row of abstract
// content words on top of them was noise. content_type stays in the database.

/** "when" eyebrow for event posts (same rendering as the Events feed). */
function whenLabel(p: FeedPost): string | undefined {
  const ev = p.linked_event;
  if (!ev) return undefined;
  if (ev.recurrence) return recurrenceLabel(ev.recurrence, ev.start_date);
  const day = localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short' });
  const date = ev.start_date === ev.end_date
    ? `${day} ${formatDateShort(ev.start_date)}`
    : `${formatDateShort(ev.start_date)} – ${formatDateShort(ev.end_date)}`;
  if (ev.all_day || ev.start_min == null) return date;
  return `${date} · ${minToLabel(ev.start_min)} – ${minToLabel(ev.end_min ?? ev.start_min)}`;
}

/** A profile IS a feed (Figma 286-16377 / 286-11770): the entity's stream
 *  under the standard content-type tabs, plus service-area icon toggles that
 *  only appear for areas present in the stream. People (profileId) show what
 *  they authored; spaces (spaceId) show their wall. `leading` prepends
 *  space-anatomy action circles (Chat, Members) to the icon row. */
export default function ContributionsFeed({ profileId, spaceId, me, leading = [], afterGap = [], assistantSection, assistantOff, trailing = [], hideAreas = [], entityName, feedDoor, listHidden, interactive = true }: {
  profileId?: string;
  spaceId?: string;
  me: string;
  /** Circles BEFORE the hairline: search, add — the doors that are about you
   *  acting, not about this entity (founder 2026-08-05). */
  leading?: { icon: IconName; label: string; onClick: () => void }[];
  /** Circles right AFTER the hairline, ahead of the area lenses — the
   *  entity's own rooms (Chat). */
  afterGap?: { icon: IconName; label: string; onClick: () => void }[];
  /** When set, an assistant door closes the leading group — quiet when this
   *  section's consent is off, exactly like Home's brain. */
  assistantSection?: string;
  /** This profile or space has opted out of the assistant (founder
   *  2026-08-05). The door still opens — a member always reaches their own
   *  assistant — it just reads as switched off for everyone who visits. */
  assistantOff?: boolean;
  /** Far-right action circles AFTER the area icons — Members sits at the end
   *  of every space row, mirroring Home's Directory-at-the-far-right
   *  (founder 2026-07-25). */
  trailing?: { icon: IconName; label: string; onClick: () => void }[];
  /** Area lenses to leave out because a trailing door already opens that
   *  section properly — a space's Events tab beats an events-only filter,
   *  and two identical circles side by side read as a bug. */
  hideAreas?: string[];
  /** The entity's display name — lets a single area lens read as a PLACE:
   *  tap Library on Melanie's profile and the feed declares "Melanie's
   *  Library" (destination feeling, no navigation cost — founder 2026-07-19). */
  entityName?: string;
  /** A Feed door in Home's exact slot — right after the hairline, before the
   *  area lenses, lit peach when `here` (founder 2026-08-11: the newsfeed
   *  circle lives in the icon row on every profile, like Home/My-celium's).
   *  `onClick` brings the feed tab back when you've wandered to another. */
  feedDoor?: { here: boolean; onClick: () => void };
  /** Row-only mode: the icon row stays up as the profile's section switcher
   *  while another tab (About, Services) owns the content below. */
  listHidden?: boolean;
  /** False when rendering for the open web (a guest, or the owner
   *  previewing as one — founder 2026-08-11): cards read-only, no member
   *  actions. The doors themselves are the CALLER's to strip. */
  interactive?: boolean;
}) {
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());

  // Provenance names: the spaces these posts were routed into.
  useEffect(() => {
    const ids = posts.flatMap((p) => p.audience_space_ids ?? []);
    if (!ids.length) { setSpaceNames(new Map()); return; }
    let live = true;
    void loadSpaceNames(ids).then((m) => { if (live) setSpaceNames(m); });
    return () => { live = false; };
  }, [posts]);
  const [ready, setReady] = useState(false);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const feed = await loadAuthorFeed({ profileId, spaceId });
      const [{ web, vouched: myc }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, myc);
      if (!live) return;
      setPosts(feed); setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setReady(true);
    })();
    return () => { live = false; };
  }, [profileId, spaceId]);

  // Only offer toggles for areas this entity actually contributes to —
  // an icon appears the moment the first post lands in that area — and in
  // HOME's icon-row order, so every profile reads the same (founder
  // 2026-07-25): Marketplace · Events · Work · Education · Food · Creative ·
  // Places · Library.
  const HOME_ORDER: ServiceArea[] = ['marketplace', 'events', 'work', 'courses', 'food', 'art', 'places', 'library', 'people'];
  // Off when the owner has opted out, or when the viewer has switched this
  // section off for themselves. Either way the door still opens.
  const aiOn = !assistantOff && !!assistantSection && aiDoorOn(assistantSection);

  const areasPresent = useMemo(() => {
    const present = new Set<ServiceArea>();
    posts.forEach((p) => postAreas(p).forEach((a) => present.add(a)));
    return SERVICE_AREAS.filter((a) => present.has(a.value) && !hideAreas.includes(a.value))
      .sort((a, b) => HOME_ORDER.indexOf(a.value) - HOME_ORDER.indexOf(b.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  // An entity's area icon opens the REAL section, scoped to it ("Melanie's
  // Courses", "Pine Valley Grange's Marketplace" — founder 2026-07-24/25:
  // every area with a section of its own opens that section, never a search
  // hand-off; only sectionless areas (places) fall back to scoped search.
  const SECTION_ROUTES: Partial<Record<ServiceArea, string>> = {
    courses: '/courses', library: '/library', work: '/work', art: '/art',
    food: '/food', marketplace: '/market', events: '/events',
  };
  const scopeQS = profileId ? `member=${profileId}` : `space=${spaceId}`;
  const areaDest = (a: ServiceArea) => {
    const route = SECTION_ROUTES[a];
    return route ? `${route}?${scopeQS}` : `/search?${scopeQS}&area=${a}`;
  };
  const onArea = (a: ServiceArea) => {
    if (profileId || spaceId) navigate(areaDest(a));
    else toggleArea(a);
  };

  const visible = useMemo(() => {
    return posts.filter((p) => (areas.length === 0 || postAreas(p).some((a) => areas.includes(a))));
  }, [posts, areas]);

  async function messageAuthor(otherId: string) {
    const chatId = await ensureDirectChat(otherId);
    navigate(`/chat/${chatId}`);
  }

  if (!ready) return <p className="cfeed__empty">Loading…</p>;
  // Space anatomy (Chat/Members) stays visible even before the first post.
  if (posts.length === 0 && leading.length === 0 && afterGap.length === 0) {
    return (
      <ScopeEmpty
        icon="newsfeed" section="Feed" who={entityName || 'them'}
        to="/home" label="Visit the Lichen feed"
      />
    );
  }

  return (
    <div className="cfeed">
      {(leading.length > 0 || trailing.length > 0 || areasPresent.length > 0 || !!feedDoor) && (
        <div className="cfeed__areas h-scroll">
          {leading.map((l) => (
            <button key={l.label} className="cfeed__area" onClick={l.onClick}>
              <span className="cfeed__area-circle"><Icon name={l.icon} size={14} /></span>
              <span className="cfeed__area-label">{l.label}</span>
            </button>
          ))}
          {assistantSection && (
            <button
              className={'cfeed__area cfeed__area--ai' + (aiOn ? '' : ' is-ai-off')}
              onClick={() => navigate(`/assistant?section=${assistantSection}`)}
              title={aiOn
                ? 'Your assistant — a briefing for this part of your Lichen life'
                : assistantOff
                  ? 'This one works without the assistant. Your own is still a tap away.'
                  : 'You’ve switched the assistant off for this section. Tap to change that.'}
            >
              <span className="cfeed__area-circle">
                <Icon name="brain" size={14} />
                {!aiOn && <span className="cfeed__area-slash" aria-hidden />}
              </span>
              <span className="cfeed__area-label">AI</span>
            </button>
          )}
          {(leading.length > 0 || assistantSection)
            && (!!feedDoor || afterGap.length > 0 || areasPresent.length > 0 || trailing.length > 0)
            && <span className="cfeed__area-gap" />}
          {feedDoor && (
            <button
              className={'cfeed__area cfeed__area--feed' + (feedDoor.here ? ' is-here' : '')}
              onClick={feedDoor.onClick}
              title={feedDoor.here ? 'You’re on the feed' : 'Back to the feed'}
            >
              <span className="cfeed__area-circle"><Icon name="newsfeed" size={14} /></span>
              <span className="cfeed__area-label">Feed</span>
            </button>
          )}
          {afterGap.map((l) => (
            <button key={l.label} className="cfeed__area" onClick={l.onClick}>
              <span className="cfeed__area-circle"><Icon name={l.icon} size={14} /></span>
              <span className="cfeed__area-label">{l.label}</span>
            </button>
          ))}
          {areasPresent.map((a) => (
            <button
              key={a.value}
              className={'cfeed__area' + (!profileId && areas.includes(a.value) ? ' is-active' : '')}
              onClick={() => onArea(a.value)}
            >
              <span className="cfeed__area-circle"><Icon name={a.icon} size={14} /></span>
              <span className="cfeed__area-label">{a.label}</span>
            </button>
          ))}
          {trailing.map((l) => (
            <button key={l.label} className="cfeed__area" onClick={l.onClick}>
              <span className="cfeed__area-circle"><Icon name={l.icon} size={14} /></span>
              <span className="cfeed__area-label">{l.label}</span>
            </button>
          ))}
        </div>
      )}

      {!listHidden && entityName && areas.length === 1 && (
        <h2 className="cfeed__shelf">
          {entityName}&rsquo;s <span className="display-italic">
            {areasPresent.find((a) => a.value === areas[0])?.label ?? areas[0]}
          </span>
        </h2>
      )}

      {!listHidden && <div className="cfeed__list">
        {posts.length === 0 && (
          <ScopeEmpty
            icon="newsfeed" section="Feed" who={entityName || 'them'}
            to="/home" label="Visit the Lichen feed"
          />
        )}
        {posts.length > 0 && visible.length === 0 && <p className="cfeed__empty">Nothing here under these filters.</p>}
        {visible.map((p) => (
          <FeedCard
            key={p.id}
            {...postToCard(p, me, spaceNames)}
            {...weaveProps(p, myWebSet, me)}
            eyebrow={whenLabel(p) ?? postToCard(p, me, spaceNames).eyebrow}
            onOpen={() => navigate(postOpenPath(p))}
            onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
            trusted={interactive && myMyc.has('profile:' + p.author_id)}
            recommended={interactive && myRecs.has('post:' + p.id)}
            mycelium={interactive ? overlays[p.id] : undefined}
            // On the open web every Lichen action grays out rather than
            // vanishing (founder 2026-08-11: "grayed out unless someone
            // logs in") — the page reads as a real Lichen page you could
            // join, not a stripped one.
            availability={interactive
              ? { trust: !!me && p.author_id !== me }
              : { trust: false, recommend: false, share: false, save: false, chat: false }}
            onTrust={interactive ? (on) => { void setTrust('profile', p.author_id, on).catch(console.error); } : undefined}
            onRecommend={interactive ? (on) => { void setRecommend('post', p.id, on).catch(console.error); } : undefined}
            saved={interactive && mySaves.has('post:' + p.id)}
            onSave={interactive ? (on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); } : undefined}
            extraMenuItems={interactive && me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined}
            viewerIsAuthor={interactive && p.author_id === me}
            onManage={interactive && p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
            onEdit={interactive && !p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
            onDelete={interactive && !p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onHide={interactive && me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
            onMessage={interactive && me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
          />
        ))}
      </div>}
    </div>
  );
}
