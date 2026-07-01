import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import FeedCard, { FeedCardProps } from '../components/FeedCard';
import FilterRow from '../components/FilterRow';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { FEED } from '../data/feed';
import {
  loadFeed, CONTENT_TYPES, SERVICE_AREAS,
  type FeedPost, type ServiceArea,
} from '../lib/postsApi';
import { postToCard } from '../lib/feedMapping';
import { ensureDirectChat } from '../lib/chatApi';
import {
  loadMyMycelium, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
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

const CONTENT_FILTERS = ['All', ...CONTENT_TYPES.map((c) => c.label)];
const CT_LABEL: Record<string, string> = Object.fromEntries(CONTENT_TYPES.map((c) => [c.value, c.label]));

type Item = {
  key: string;
  card: FeedCardProps;
  kind: Kind;
  contentLabel: string;       // matches a CONTENT_FILTERS entry
  area: ServiceArea | null;
};

// Demo cards (until your web fills with real posts), tagged so the filters bite.
const MOCK_META: { kind: Kind; contentLabel: string; area: ServiceArea | null }[] = [
  { kind: 'provider',     contentLabel: 'Social',      area: 'marketplace' },
  { kind: 'organization', contentLabel: 'Educational', area: 'courses' },
  { kind: 'provider',     contentLabel: 'Social',      area: 'people' },
  { kind: 'place',        contentLabel: 'Actionable',  area: 'food' },
];

export default function Mycelium() {
  const { type: urlSlug = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  async function messageAuthor(authorId: string) {
    try { navigate(`/chat/${await ensureDirectChat(authorId)}`); }
    catch (e) { console.error(e); }
  }

  const [content, setContent] = useState('All');
  const [kinds, setKinds] = useState<Kind[]>(() => {
    const k = URL_TO_KIND[urlSlug];
    return k ? [k] : [];
  });
  const [areas, setAreas] = useState<ServiceArea[]>([]);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});

  useEffect(() => {
    (async () => {
      const feed = await loadFeed();
      const [myc, recs] = await Promise.all([loadMyMycelium(), loadMyRecommendations()]);
      const ov = await loadEndorsements(feed, myc);
      setMyMyc(myc); setMyRecs(recs); setOverlays(ov); setPosts(feed);
    })();
  }, []);

  // Build the combined feed: real posts from entities in your mycelium, then demo cards.
  const items = useMemo<Item[]>(() => {
    const real: Item[] = posts
      .filter((p) => myMyc.has('profile:' + p.author_id))
      .map((p) => ({
        key: p.id,
        kind: 'person', // real author kinds light up once entities generalize
        contentLabel: CT_LABEL[p.content_type] ?? 'Social',
        area: p.service_area,
        card: {
          ...postToCard(p),
          trusted: myMyc.has('profile:' + p.author_id),
          recommended: myRecs.has(p.id),
          mycelium: overlays[p.id],
          availability: { trust: p.author_id !== user?.id },
          onTrust: (on: boolean) => { void setTrust('profile', p.author_id, on).catch(console.error); },
          onRecommend: (on: boolean) => { void setRecommend(p.id, on).catch(console.error); },
          onMessage: p.author_id !== user?.id ? () => messageAuthor(p.author_id) : undefined,
        },
      }));
    const mock: Item[] = FEED.map((card, i) => ({
      key: 'mock-' + i,
      card,
      ...MOCK_META[i % MOCK_META.length],
    }));
    return [...real, ...mock];
  }, [posts, myMyc, myRecs, overlays, user]);

  const visible = useMemo(
    () => items.filter((it) =>
      (content === 'All' || it.contentLabel === content) &&
      (kinds.length === 0 || kinds.includes(it.kind)) &&
      (areas.length === 0 || (it.area != null && areas.includes(it.area)))
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
          <span>Mycelium</span>
        </p>
        <h1 className="myc__title">Your Mycelium</h1>
        <p className="myc__sub">
          What your trusted web is sharing — filter by kind, area, or content.
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
            <p>Clear a filter, or trust more entities to grow your web.</p>
          </div>
        )}
      </section>
    </div>
  );
}
