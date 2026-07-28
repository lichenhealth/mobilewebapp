import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import FeedCard, { FeedCardProps } from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import {
  loadFeed, deletePost, postAreas, SERVICE_AREAS,
  type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import { ensureDirectChat } from '../lib/chatApi';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { useCollect } from '../collections/CollectPrompt';
import { setHidden } from '../lib/hiddenApi';
import { useAuth } from '../auth/AuthProvider';
import './Mycelium.css';

// Entity kinds — multi-select, like the marketplace mode filters.
type Kind = 'person' | 'provider' | 'organization' | 'place';
const KINDS: { type: Kind; label: string; icon: IconName }[] = [
  { type: 'person',       label: 'People',    icon: 'profile' },
  { type: 'provider',     label: 'Providers', icon: 'store' },
  { type: 'organization', label: 'Orgs',      icon: 'user-multiple' },
  { type: 'place',        label: 'Places',    icon: 'location' },
];
const URL_TO_KIND: Record<string, Kind | undefined> = {
  people: 'person', providers: 'provider', organizations: 'organization', places: 'place',
};

// Social or Actionable (founder 2026-07-28) — legacy types read as Social.
const CONTENT_FILTERS = ['All', 'Social', 'Actionable'];
const CT_LABEL: Record<string, string> = { actionable: 'Actionable' };

type Item = {
  key: string;
  card: FeedCardProps;
  kind: Kind;
  contentLabel: string;       // matches a CONTENT_FILTERS entry
  areas: ServiceArea[];       // a post can live in several areas
};

export default function Mycelium() {
  const { type: urlSlug = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  const [content, setContent] = useState('All');
  // Lenses default ALL-ON (founder, 2026-07-16, media-lens grammar): you see
  // everything until you deselect to narrow. A /mycelium/<kind> URL starts
  // narrowed to that kind.
  const [kinds, setKinds] = useState<Kind[]>(() => {
    const k = URL_TO_KIND[urlSlug];
    return k ? [k] : KINDS.map((x) => x.type);
  });
  const [areas, setAreas] = useState<ServiceArea[]>(() => SERVICE_AREAS.map((a) => a.value));

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [myWeb, setMyWeb] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    (async () => {
      const feed = await loadFeed();
      const [{ web, vouched }, recs, saves] = await Promise.all([loadMyWeb(), loadMyRecommendations(), loadMySaved()]);
      const ov = await loadEndorsements(feed, vouched);
      setMyWeb(web); setMyMyc(vouched); setMyRecs(recs); setMySaves(saves); setOverlays(ov); setPosts(feed);
    })();
  }, []);

  // The feed: real posts from entities in your mycelium.
  const items = useMemo<Item[]>(() => {
    return posts
      // Authors in your WEB (person or the space they posted as — membership,
      // vouched or not) — and always your own posts, so what you share to your
      // mycelium shows in your own web.
      .filter((p) =>
        myWeb.has('profile:' + p.author_id)
        || (p.author_space_id != null && myWeb.has('space:' + p.author_space_id))
        || p.author_id === user?.id)
      .map((p) => ({
        key: p.id,
        kind: 'person', // real author kinds light up once entities generalize
        contentLabel: CT_LABEL[p.content_type] ?? 'Social',
        areas: postAreas(p),
        card: {
          ...postToCard(p, user?.id),
          ...weaveProps(p, myWeb, user?.id),
          trusted: myMyc.has('profile:' + p.author_id),
          recommended: myRecs.has('post:' + p.id),
          mycelium: overlays[p.id],
          availability: { trust: p.author_id !== user?.id },
          onTrust: (on: boolean) => { void setTrust('profile', p.author_id, on).catch(console.error); },
          onRecommend: (on: boolean) => { void setRecommend('post', p.id, on).catch(console.error); },
          saved: mySaves.has('post:' + p.id),
          onSave: (on: boolean) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); },
          extraMenuItems: user ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : undefined,
          viewerIsAuthor: p.author_id === user?.id,
          onManage: p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined,
          onEdit: !p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined,
          onDelete: !p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onHide: user ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined,
          onMessage: p.author_id !== user?.id ? () => messageAuthor(p.author_id) : undefined,
          onOpen: () => navigate(postOpenPath(p)),
          onAuthor: () => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`),
        },
      }));
  }, [posts, myWeb, myMyc, myRecs, mySaves, overlays, user, promptSaved, openPicker]);

  const visible = useMemo(
    () => items.filter((it) =>
      (content === 'All' || it.contentLabel === content) &&
      kinds.includes(it.kind) &&
      it.areas.some((a) => areas.includes(a))
    ),
    [items, content, kinds, areas]
  );

  const toggleKind = (k: Kind) =>
    setKinds((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]);

  return (
    <div className="myc">
      <header className="myc__head">
        <p className="myc__crumb">
          <Icon name="sparkle" size={11} />
          {/* "My-celium" (founder 2026-07-25): the name carries the point —
              this is YOUR specific network. Display-only; routes and DB
              tables keep the plain spelling. */}
          <span>My-celium</span>
        </p>
        <h1 className="myc__title">Your My-celium</h1>
        <p className="myc__sub">
          What your web is sharing — filter by kind, area, or content.
        </p>
      </header>

      {/* Content-type (single-select) */}
      <FilterRow options={CONTENT_FILTERS} value={content} onChange={setContent} />

      {/* Entity kind (multi-select) */}
      <div className="myc__kinds h-scroll">
        {KINDS.map((k) => {
          const on = kinds.includes(k.type);
          return (
            <button
              key={k.type}
              className={'myc__kind' + (on ? ' is-on' : '')}
              onClick={() => toggleKind(k.type)}
              aria-pressed={on}
            >
              <span className="myc__kind-circle"><Icon name={k.icon} size={13} /></span>
              <span className="myc__kind-label">{k.label}</span>
            </button>
          );
        })}
      </div>

      {/* Service-area lens (multi-select) */}
      <div className="myc__areas h-scroll" role="toolbar" aria-label="Service areas">
        {SERVICE_AREAS.map((a) => {
          const on = areas.includes(a.value);
          return (
            <button
              key={a.value}
              className={'myc__area' + (on ? ' is-on' : '')}
              onClick={() => toggleArea(a.value)}
              aria-pressed={on}
              aria-label={a.label}
              title={a.label}
            >
              <Icon name={a.icon} size={18} />
            </button>
          );
        })}
        {/* Door, not a lens: the whole web as a browsable directory */}
        <button
          className="myc__area myc__area--door"
          onClick={() => navigate('/mycelium/directory')}
          aria-label="Your web — directory"
          title="Your web — directory"
        >
          <Icon name="health" size={18} />
        </button>
      </div>

      <p className="myc__count">
        <span className="myc__count-n">{visible.length}</span>{' '}
        {visible.length === 1 ? 'post' : 'posts'}
      </p>

      <section className="myc__feed">
        {visible.map((it) => <FeedCard key={it.key} {...it.card} />)}
        {visible.length === 0 && (
          <div className="myc__empty">
            <span className="display-italic">Nothing matches.</span>
            <p>Clear a filter, or weave more people and places into your web.</p>
          </div>
        )}
      </section>
    </div>
  );
}
