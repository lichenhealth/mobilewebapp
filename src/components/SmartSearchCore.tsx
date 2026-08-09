import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import Avatar from './Avatar';
import LocationField from './LocationField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { GeoPoint } from '../lib/geoApi';
import { SERVICE_AREAS, CONTENT_TYPES, postAreas, type FeedPost, type ServiceArea, type ContentType } from '../lib/postsApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import { loadMyWeb, setInWeb } from '../lib/myceliumApi';
import { areaLabel } from '../lib/locationApi';
import { WeaveMark } from './WeaveMark';
import { postToAssistantFeed } from '../lib/assistantFeedApi';
import { aiDoorOn } from './AssistantDoor';
import { askAssistant, type AssistantAnswer } from '../lib/assistantApi';
import {
  parseQuery, runSmartSearch, emptyCriteria,
  type SearchCategory, type SearchCriteria, type ParsedSpan, type SmartResults,
  type EndorseDegree, type OfferKind, type WhoKind,
} from '../lib/smartSearch';
import './SmartSearch.css';

/** The reusable core of smart search (Figma 286-3407) + the manual criteria
 *  panel (286-2515) — sentence box with live-highlighted understood phrases,
 *  sliders button for the full panel, results incl. near-miss tier, and an
 *  AI-narrated summary card. Powers both the standalone /search route (a
 *  thin wrapper supplies scope from the URL, the back button, and the
 *  "search everywhere" escape hatch) and embedded, in-section search (e.g.
 *  Marketplace) — this component never reads the URL itself; all scope
 *  comes in as props, so embedding it can't accidentally leak or lose a
 *  section's own query-param scoping. */

export interface SmartSearchScope {
  spaceId?: string | null;
  memberId?: string | null;
  area?: ServiceArea | null;
  who?: WhoKind | null;
}

export interface SmartSearchCoreProps {
  scope?: SmartSearchScope;
  /** Pre-resolved scope name (skips the space/profile name lookup). */
  scopeLabel?: string;
  /** Omit to hide the "× everywhere" control entirely. */
  onClearScope?: () => void;
  /** Whether `scope` alone should count as enough intent to run a search.
   *  Default true (matches /search's own behavior). An embedded section's
   *  scope (e.g. area='marketplace') is always set, so it must pass
   *  `false` here or every open of the search box would fire a full search
   *  + assistant call before a keystroke. */
  scopeIsSignal?: boolean;
  /** A section's own current lens (offer/trust/category chips), additively
   *  folded into whatever the sentence/panel already say. */
  seed?: Partial<SearchCriteria>;
  /** Sizing modifier — fills the host's width instead of centering as a page. */
  embedded?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** AssistantDoor consent key (e.g. 'search', 'market'). Omit to disable
   *  the AI narration card entirely for this mount. */
  assistantSection?: string;
  /** Fires whenever "is this search doing anything" changes, so a host can
   *  hide its own feed while search is live. */
  onActiveChange?: (active: boolean) => void;
  onResults?: (r: SmartResults | null) => void;
}

interface MySpace { id: string; name: string; kind: string }
interface MemberLite { id: string; full_name: string | null }

interface Extras {
  /** 'all' = every topic included (the default — not a filter); an array is
   *  an explicit narrowing. Empty array = none picked yet = also no filter. */
  categoryIds: string[] | 'all';
  who: WhoKind[];
  spaceScope: string[];
  areas: ServiceArea[];
  contentTypes: ContentType[];
  offers: OfferKind[];
  priceMin: string; priceMax: string;
  online: boolean; inPerson: boolean;
  radiusMiles: number | null;
  anchorText: string; anchorGeo: GeoPoint | null;
  dateFrom: string; dateTo: string;
  hideConflicts: boolean;
  trustDegree: EndorseDegree | null; trustPerson: MemberLite | null;
  recDegree: EndorseDegree | null; recPerson: MemberLite | null;
}
const EMPTY_EXTRAS: Extras = {
  categoryIds: 'all', who: [], spaceScope: [], areas: [], contentTypes: [], offers: [],
  priceMin: '', priceMax: '',
  online: false, inPerson: false,
  radiusMiles: null, anchorText: '', anchorGeo: null,
  dateFrom: '', dateTo: '', hideConflicts: false,
  trustDegree: null, trustPerson: null,
  recDegree: null, recPerson: null,
};

const TRUST_DEGREE_LABELS: { value: EndorseDegree; label: string }[] = [
  { value: 'mine', label: 'Trusted (1st)' },
  { value: 'second', label: 'Trusted (2nd)' },
  { value: 'any', label: 'Anyone' },
];
const REC_DEGREE_LABELS: { value: EndorseDegree; label: string }[] = [
  { value: 'mine', label: 'Recommended (1st)' },
  { value: 'second', label: 'Recommended (2nd)' },
  { value: 'any', label: 'Anyone' },
];

function merge(parsed: SearchCriteria, x: Extras, cats: SearchCategory[]): SearchCriteria {
  // 'all' and empty both mean "no topic narrowing" — only a real subset filters.
  const sel = x.categoryIds;
  const pickedCats = (sel === 'all' || sel.length === 0 || sel.length === cats.length)
    ? [] : cats.filter((c) => sel.includes(c.id));
  const catIds = new Set(parsed.categories.map((c) => c.id));
  return {
    ...parsed,
    categories: [...parsed.categories, ...pickedCats.filter((c) => !catIds.has(c.id))],
    who: [...new Set([...parsed.who, ...x.who])],
    spaceScope: [...new Set([...parsed.spaceScope, ...x.spaceScope])],
    areas: [...new Set([...parsed.areas, ...x.areas])],
    contentTypes: [...new Set([...parsed.contentTypes, ...x.contentTypes])],
    offers: [...new Set([...parsed.offers, ...x.offers])],
    priceMin: x.priceMin !== '' ? Number(x.priceMin) : parsed.priceMin,
    priceMax: x.priceMax !== '' ? Number(x.priceMax) : parsed.priceMax,
    online: parsed.online || x.online,
    inPerson: parsed.inPerson || x.inPerson,
    radiusMiles: x.radiusMiles ?? parsed.radiusMiles,
    anchorText: x.anchorGeo ? x.anchorText : parsed.anchorText,
    anchorGeo: x.anchorGeo,
    dateFrom: x.dateFrom || parsed.dateFrom,
    dateTo: x.dateTo || parsed.dateTo,
    hideConflicts: parsed.hideConflicts || x.hideConflicts,
    trust: (x.trustDegree || x.trustPerson)
      ? { degree: x.trustDegree, personId: x.trustPerson?.id ?? null }
      : parsed.trust,
    rec: (x.recDegree || x.recPerson)
      ? { degree: x.recDegree, personId: x.recPerson?.id ?? null }
      : parsed.rec,
  };
}

/** A section's current lens (Phase 2, e.g. Marketplace's chips), additively
 *  folded on top of whatever the sentence/panel produced — same spirit as
 *  `merge()` above, just from a caller-supplied seed instead of the panel. */
function foldInSeed(c: SearchCriteria, seed?: Partial<SearchCriteria>): SearchCriteria {
  if (!seed) return c;
  const catIds = new Set(c.categories.map((cc) => cc.id));
  return {
    ...c,
    offers: seed.offers?.length ? [...new Set([...c.offers, ...seed.offers])] : c.offers,
    categories: seed.categories?.length
      ? [...c.categories, ...seed.categories.filter((sc) => !catIds.has(sc.id))]
      : c.categories,
    trust: (!c.trust.degree && !c.trust.personId && seed.trust) ? seed.trust : c.trust,
    rec: (!c.rec.degree && !c.rec.personId && seed.rec) ? seed.rec : c.rec,
  };
}

function whenLine(p: FeedPost): string {
  const ev = p.linked_event;
  if (!ev) return '';
  if (ev.recurrence) return 'Recurring';
  const day = localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short' });
  return `${day} ${formatDateShort(ev.start_date)}`;
}

function buildEscalateMessage(q: string, chips: string[]): string {
  const sentence = q.trim();
  if (sentence) return sentence;
  if (chips.length) return `I'm looking for: ${chips.join(', ')}.`;
  return 'Can you help me search?';
}

/** A collapsible panel section, mockup-style: checkbox-look header that shows
 *  whether the section is contributing filters, chevron to open. */
function Section({ label, active, open, onToggle, children }: {
  label: string; active: boolean; open: boolean; onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={'ssrch__sect' + (open ? ' is-open' : '')}>
      <button className="ssrch__sect-head" onClick={onToggle} aria-expanded={open}>
        <span className="ssrch__sect-label">
          {label}
          {/* peach dot = this section is narrowing the search right now */}
          {active && <span className="ssrch__sect-dot" aria-label="active" />}
        </span>
        <span className="ssrch__sect-chev" aria-hidden>
          <Icon name="chevron-right" size={13} />
        </span>
      </button>
      {open && <div className="ssrch__sect-body">{children}</div>}
    </div>
  );
}

// Per-criteria AI narration cache — module-level, not per-mount, so
// switching sections and back (or /search itself remounting on navigation)
// doesn't re-bill a query already answered this session.
const assistantCache = new Map<string, AssistantAnswer>();

export default function SmartSearchCore({
  scope, scopeLabel, onClearScope, scopeIsSignal = true, seed, embedded,
  autoFocus = true, placeholder, assistantSection, onActiveChange, onResults,
}: SmartSearchCoreProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  // Your web, for the 1-click weave mark on people/space hits.
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadMyWeb().then(({ web }) => { if (live) setMyWebSet(web); });
    return () => { live = false; };
  }, [me]);

  // Scope comes in as a prop now — /search's wrapper reads it from the URL,
  // an embedded caller passes its own section/member/space directly.
  const scopeSpaceId = scope?.spaceId ?? null;
  const scopeMemberId = scope?.memberId ?? null;
  const scopeArea = scope?.area ?? null;
  const scopeWho = scope?.who ?? null;
  const hasScope = !!(scopeSpaceId || scopeMemberId || scopeArea || scopeWho);
  const [resolvedScopeName, setResolvedScopeName] = useState('');
  const scopeName = scopeLabel || resolvedScopeName;

  useEffect(() => {
    if (scopeLabel) return; // caller already knows the name
    if (!scopeSpaceId && !scopeMemberId) { setResolvedScopeName(''); return; }
    let live = true;
    (async () => {
      if (scopeSpaceId) {
        const { data } = await supabase.from('spaces').select('name').eq('id', scopeSpaceId).maybeSingle();
        if (live) setResolvedScopeName((data as { name: string } | null)?.name ?? 'this space');
      } else if (scopeMemberId) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', scopeMemberId).maybeSingle();
        if (live) setResolvedScopeName((data as { full_name: string | null } | null)?.full_name ?? 'this member');
      }
    })();
    return () => { live = false; };
  }, [scopeSpaceId, scopeMemberId, scopeLabel]);

  const [q, setQ] = useState('');
  const [cats, setCats] = useState<SearchCategory[]>([]);
  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [extras, setExtras] = useState<Extras>(EMPTY_EXTRAS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openSects, setOpenSects] = useState<Set<string>>(new Set());
  const [topicQ, setTopicQ] = useState('');
  const [trustQ, setTrustQ] = useState('');
  const [recQ, setRecQ] = useState('');
  const [results, setResults] = useState<SmartResults | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runRef = useRef(0);

  // The Assistant card: one narration per settled search. The cache means
  // fiddling back to an earlier criteria combination never re-bills.
  const [assistant, setAssistant] = useState<AssistantAnswer | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [escalating, setEscalating] = useState(false);
  const assistantDead = useRef(false);   // fn absent/unconfigured → stop asking
  const assistantAlive = useRef(false);  // answered once → thinking state may show
  const assistantRun = useRef(0);

  useEffect(() => {
    (async () => {
      const [catRes, aliasRes, spRes, memRes] = await Promise.all([
        supabase.from('categories').select('id, name, domain').order('name'),
        // Aliases are other words for the SAME category (founder 2026-08-06),
        // so search understands a member's own vocabulary without the filter
        // list growing. Absent pre-migration — the query just returns nothing.
        supabase.from('category_aliases').select('alias, category_id'),
        me ? supabase.from('space_members').select('spaces(id, name, kind)').eq('profile_id', me)
          : Promise.resolve({ data: [] }),
        supabase.from('profiles').select('id, full_name').order('full_name').limit(500),
      ]);
      const baseCats = (catRes.data as SearchCategory[] | null) ?? [];
      const byId = new Map(baseCats.map((c) => [c.id, c]));
      const aliasCats = (((aliasRes.data as { alias: string; category_id: string }[] | null) ?? [])
        .map((a) => {
          const c = byId.get(a.category_id);
          return c ? { ...c, name: a.alias } : null;
        }).filter((c): c is SearchCategory => !!c));
      // The real names first, so an exact name still wins the longest match.
      setCats([...baseCats, ...aliasCats]);
      setMySpaces((((spRes.data as { spaces: MySpace | null }[] | null) ?? [])
        .map((r) => r.spaces).filter((s): s is MySpace => !!s)));
      setMembers(((memRes.data as MemberLite[] | null) ?? []).filter((m) => m.id !== me));
    })();
  }, [me]);

  const { criteria: parsed, spans } = useMemo(
    () => (q.trim() ? parseQuery(q, cats, members) : { criteria: emptyCriteria(), spans: [] as ParsedSpan[] }),
    [q, cats, members],
  );
  // What the SENTENCE/PANEL/seed contributed, before scope is folded in —
  // this, not the final criteria, is what hasSignal below checks. Scope
  // (e.g. area='marketplace') is always present once embedded, so if
  // hasSignal looked at post-scope criteria, an always-on scopeIsSignal={false}
  // would still leak "there's an area filter" as a signal and auto-run on
  // open — caught live: opening Marketplace's search fired a real search +
  // assistant call before a single keystroke.
  const preScope = useMemo(() => foldInSeed(merge(parsed, extras, cats), seed),
    [parsed, extras, cats, seed]);
  const criteria = useMemo(() => {
    const c = { ...preScope };
    if (scopeSpaceId && !c.spaceScope.includes(scopeSpaceId)) c.spaceScope = [...c.spaceScope, scopeSpaceId];
    if (scopeMemberId) c.authorScope = scopeMemberId;
    if (scopeArea && !c.areas.includes(scopeArea)) c.areas = [...c.areas, scopeArea];
    if (scopeWho && !c.who.includes(scopeWho)) c.who = [...c.who, scopeWho];
    return c;
  }, [preScope, scopeSpaceId, scopeMemberId, scopeArea, scopeWho]);

  const hasSignal = (scopeIsSignal && hasScope) || q.trim().length >= 3
    || !!preScope.trust.degree || !!preScope.trust.personId
    || !!preScope.rec.degree || !!preScope.rec.personId
    || preScope.areas.length > 0 || preScope.categories.length > 0
    || preScope.who.length > 0 || preScope.spaceScope.length > 0
    || preScope.offers.length > 0 || preScope.radiusMiles != null;

  useEffect(() => { onActiveChange?.(hasSignal); }, [hasSignal, onActiveChange]);

  // auto-grow the textarea with its content. Deferred to the next animation
  // frame — measuring scrollHeight synchronously on mount can race the
  // browser's own layout pass (caught live: the box briefly lays out near
  // 0 width before settling, and a long placeholder wrapped into ~100 lines
  // at that width bakes a huge inline height in that never gets remeasured
  // since this effect only re-runs when `q` changes).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
    return () => cancelAnimationFrame(raf);
  }, [q]);

  // debounced run
  useEffect(() => {
    if (!hasSignal) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const run = ++runRef.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await runSmartSearch(criteria, me);
        if (runRef.current === run) { setResults(r); setSearching(false); }
      } catch (e) {
        console.warn('smart search:', e);
        if (runRef.current === run) setSearching(false);
      }
    }, 500);
    return () => window.clearTimeout(t);
    // criteria is derived — stringify to keep the effect honest without loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(criteria), hasSignal, me]);

  useEffect(() => { onResults?.(results); }, [results, onResults]);

  // Assistant narration: waits for the search to settle, then asks once per
  // distinct criteria combination. Silent when the feature isn't configured,
  // this section's AI door is off, or no assistantSection was given at all.
  useEffect(() => {
    if (!results || !me || assistantDead.current || !assistantSection || !aiDoorOn(assistantSection)) {
      setAssistant(null); setAssistantBusy(false); return;
    }
    const key = JSON.stringify({ q: q.trim(), c: criteria });
    const cached = assistantCache.get(key);
    if (cached) { setAssistant(cached); setAssistantBusy(false); return; }
    const run = ++assistantRun.current;
    setAssistant(null);
    setAssistantBusy(assistantAlive.current);
    const t = window.setTimeout(async () => {
      const a = await askAssistant(q.trim(), chips, criteria, results);
      if (!a.available && !a.capped) assistantDead.current = true;
      else { assistantAlive.current = true; assistantCache.set(key, a); }
      if (assistantRun.current === run) { setAssistant(a.available ? a : null); setAssistantBusy(false); }
    }, 1800);
    return () => { window.clearTimeout(t); if (assistantRun.current === run) setAssistantBusy(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, me, assistantSection]);

  // the highlight mirror: raw text split into plain/understood segments
  const segments = useMemo(() => {
    const out: { text: string; hit: boolean }[] = [];
    let pos = 0;
    for (const s of spans) {
      if (s.start > pos) out.push({ text: q.slice(pos, s.start), hit: false });
      out.push({ text: q.slice(s.start, s.end), hit: true });
      pos = s.end;
    }
    if (pos < q.length) out.push({ text: q.slice(pos), hit: false });
    return out;
  }, [q, spans]);

  const spaceName = (id: string) => mySpaces.find((s) => s.id === id)?.name ?? 'a group';
  const chips = useMemo(() => {
    const c = criteria;
    const out: string[] = [];
    if (c.trust.personId) out.push(`trusted by ${members.find((m) => m.id === c.trust.personId)?.full_name ?? 'someone'}`);
    else if (c.trust.degree) out.push(c.trust.degree === 'mine' ? 'trusted (1st)' : c.trust.degree === 'second' ? 'trusted (2nd)' : 'trusted by anyone');
    if (c.rec.personId) out.push(`recommended by ${members.find((m) => m.id === c.rec.personId)?.full_name ?? 'someone'}`);
    else if (c.rec.degree) out.push(c.rec.degree === 'mine' ? 'recommended (1st)' : c.rec.degree === 'second' ? 'recommended (2nd)' : 'recommended by anyone');
    for (const o of c.offers) out.push(o === 'gift' ? 'free / gift' : o);
    if (c.priceMin != null || c.priceMax != null) {
      out.push(`$${c.priceMin ?? 0}–${c.priceMax != null ? '$' + c.priceMax : 'up'}`);
    }
    if (c.online && !c.inPerson) out.push('online');
    if (c.inPerson && !c.online) out.push('in person');
    if (c.online && c.inPerson) out.push('online + in person');
    if (c.authorScope && !scopeMemberId) {
      out.push(`from ${members.find((m) => m.id === c.authorScope)?.full_name ?? 'a member'}`);
    }
    for (const w of c.who) out.push(w);
    for (const id of c.spaceScope) out.push(`in ${spaceName(id)}`);
    if (c.radiusMiles != null) {
      out.push(`within ${c.radiusMiles} mi${c.anchorText ? ` of ${c.anchorText}` : c.nearMe ? ' of me' : ''}`);
    }
    if (c.dateFrom || c.dateTo) out.push(`${c.dateFrom ?? 'now'} → ${c.dateTo ?? 'anytime'}`);
    if (c.hideConflicts) out.push('fits my calendar');
    for (const a of c.areas) out.push(SERVICE_AREAS.find((s) => s.value === a)?.label ?? a);
    for (const ct of c.contentTypes) out.push(CONTENT_TYPES.find((s) => s.value === ct)?.label ?? ct);
    if (c.categories.length > 6) out.push(`${c.categories.length} topics`);
    else for (const cat of c.categories) out.push(cat.name);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, members, mySpaces]);

  const toggleSect = (k: string) => setOpenSects((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const toggleIn = <T,>(list: T[], v: T): T[] => list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const topicHits = topicQ.trim()
    ? cats.filter((c) => c.name.toLowerCase().includes(topicQ.trim().toLowerCase()))
    : cats;
  const memberHits = (needle: string) => {
    const n = needle.trim().toLowerCase();
    if (n.length < 2) return [];
    return members.filter((m) => (m.full_name ?? '').toLowerCase().includes(n)).slice(0, 5);
  };

  const SCOPE_GROUPS: { label: string; kind: string }[] = [
    { label: 'Communities', kind: 'community' },
    { label: 'Groups', kind: 'group' },
    { label: 'Organizations', kind: 'organization' },
    { label: 'Places', kind: 'place' },
  ];

  const total = results
    ? results.people.length + results.posts.length + results.spaces.length + results.nearPosts.length
    : 0;

  const assistantKey = JSON.stringify({ q: q.trim(), c: criteria });
  const assistDismissed = dismissedKeys.has(assistantKey);

  async function askDeeper() {
    if (!me || escalating) return;
    setEscalating(true);
    try {
      await postToAssistantFeed(buildEscalateMessage(q, chips));
      navigate('/assistant/feed');
    } catch {
      setEscalating(false);
    }
  }

  const postRow = (p: FeedPost) => (
    <button
      key={p.id}
      className="ssrch__hit"
      onClick={() => navigate(p.linked_event_id
        ? `/events/${p.id}`
        : p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
    >
      <span className="ssrch__hit-icon">
        <Icon name={postAreas(p).includes('events') ? 'rsvp' : 'sparkle'} size={16} />
      </span>
      <span className="ssrch__hit-body">
        <span className="ssrch__hit-name">{p.title || p.body.slice(0, 60)}</span>
        <span className="ssrch__hit-sub">
          {(p.author_space?.name || p.author?.full_name) ?? 'A member'}
          {whenLine(p) && ` · ${whenLine(p)}`}
          {p.event_mode && ` · ${p.event_mode === 'free' ? 'Free' : p.event_mode === 'trade' ? 'Trade' : 'Paid'}`}
        </span>
        {p.title && p.body && <span className="ssrch__hit-loc">{p.body.slice(0, 90)}</span>}
      </span>
      <Icon name="chevron-right" size={14} />
    </button>
  );

  const endorsePicker = (
    which: 'trust' | 'rec',
    degree: EndorseDegree | null, person: MemberLite | null,
    query: string, setQuery: (s: string) => void,
  ) => (
    <>
      <div className="ssrch__pills">
        {(which === 'trust' ? TRUST_DEGREE_LABELS : REC_DEGREE_LABELS).map((d) => (
          <button
            key={d.value}
            className={'ssrch__pill' + (degree === d.value ? ' is-on' : '')}
            onClick={() => setExtras((x) => which === 'trust'
              ? { ...x, trustDegree: x.trustDegree === d.value ? null : d.value }
              : { ...x, recDegree: x.recDegree === d.value ? null : d.value })}
          >
            {d.label}
          </button>
        ))}
      </div>
      {person ? (
        <span className="ssrch__personpick">
          @{person.full_name ?? 'Member'}
          <button
            className="ssrch__personpick-x"
            onClick={() => setExtras((x) => which === 'trust' ? { ...x, trustPerson: null } : { ...x, recPerson: null })}
            aria-label="Clear person"
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ) : (
        <input
          className="ssrch__personq"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@ a specific member…"
        />
      )}
      {!person && memberHits(query).length > 0 && (
        <div className="ssrch__personlist">
          {memberHits(query).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setExtras((x) => which === 'trust' ? { ...x, trustPerson: m } : { ...x, recPerson: m });
                setQuery('');
              }}
            >
              {m.full_name ?? 'Member'}
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={'ssrch' + (embedded ? ' ssrch--embed' : '')}>
      {hasScope && (
        <div className="ssrch__scope">
          <Icon name="search" size={12} />
          <span>
            Searching {scopeMemberId ? `${scopeName || 'this member'}’s contributions`
              : scopeSpaceId ? `within ${scopeName || 'this space'}`
              : scopeWho ? 'people'
              : SERVICE_AREAS.find((a) => a.value === scopeArea)?.label ?? scopeArea}
          </span>
          {onClearScope && (
            <button className="ssrch__scope-x" onClick={onClearScope} aria-label="Search everywhere instead">
              <Icon name="close" size={11} /> everywhere
            </button>
          )}
        </div>
      )}
      <div className="ssrch__boxwrap">
        <div className="ssrch__box">
          <div className="ssrch__mirror" aria-hidden>
            {segments.map((s, i) => s.hit
              ? <mark key={i} className="ssrch__mark">{s.text}</mark>
              : <span key={i}>{s.text}</span>)}
            {'​'}
          </div>
          <textarea
            ref={inputRef}
            className="ssrch__input"
            value={q}
            rows={1}
            autoFocus={autoFocus}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder ?? 'Try: free spiritual trainings and events recommended by people I trust, within 25 miles of me, in the next six months…'}
          />
        </div>
        <button
          className={'ssrch__sliders' + (panelOpen ? ' is-on' : '')}
          onClick={() => setPanelOpen((o) => !o)}
          aria-label="Search filters"
        >
          <Icon name="sliders" size={16} />
        </button>
      </div>

      {chips.length > 0 && (
        <div className="ssrch__chips">
          <span className="ssrch__chips-label">Understood:</span>
          {chips.map((c) => <span key={c} className="ssrch__chip">{c}</span>)}
        </div>
      )}

      {panelOpen && (
        <div className="ssrch__panel">
          <div className="ssrch__panel-top">
            <button
              className="ssrch__clear"
              onClick={() => { setExtras(EMPTY_EXTRAS); setTopicQ(''); setTrustQ(''); setRecQ(''); }}
            >
              Reset
            </button>
            <span className="ssrch__ai" title="Your AI assistant will join search here">
              <Icon name="sparkle" size={12} /> Include AI · coming soon
            </span>
          </div>
          <p className="ssrch__panel-hint">
            Everything is included until you narrow it — open a section to pick less.
          </p>

          <Section
            label="Topics"
            active={parsed.categories.length > 0
              || (extras.categoryIds !== 'all' && extras.categoryIds.length > 0 && extras.categoryIds.length < cats.length)}
            open={openSects.has('topics')}
            onToggle={() => toggleSect('topics')}
          >
            <div className="ssrch__topics-top">
              <label className="ssrch__check ssrch__check--tight">
                <input
                  type="checkbox"
                  checked={extras.categoryIds === 'all'}
                  onChange={() => setExtras((x) => ({ ...x, categoryIds: x.categoryIds === 'all' ? [] : 'all' }))}
                />
                Select all
              </label>
              <input
                className="ssrch__personq ssrch__topics-q"
                value={topicQ}
                onChange={(e) => setTopicQ(e.target.value)}
                placeholder="Filter topics…"
              />
            </div>
            <div className="ssrch__topics">
              {topicHits.map((c) => {
                const fromSentence = parsed.categories.some((x) => x.id === c.id);
                const on = extras.categoryIds === 'all' || extras.categoryIds.includes(c.id)
                  || fromSentence;
                return (
                  <label key={c.id} className={'ssrch__topic' + (on ? ' is-on' : '')}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={fromSentence}
                      onChange={() => setExtras((x) => ({
                        ...x,
                        // Unchecking while everything is selected = keep the rest.
                        categoryIds: x.categoryIds === 'all'
                          ? cats.filter((cc) => cc.id !== c.id).map((cc) => cc.id)
                          : toggleIn(x.categoryIds, c.id),
                      }))}
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
          </Section>

          <Section
            label="Who"
            active={criteria.who.length > 0}
            open={openSects.has('who')}
            onToggle={() => toggleSect('who')}
          >
            <div className="ssrch__pills">
              {(['people', 'providers', 'organizations', 'places'] as WhoKind[]).map((w) => (
                <button
                  key={w}
                  className={'ssrch__pill' + (criteria.who.includes(w) ? ' is-on' : '')}
                  onClick={() => setExtras((x) => ({ ...x, who: toggleIn(x.who, w) }))}
                >
                  {w.charAt(0).toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>
          </Section>

          <Section
            label="My circles"
            active={criteria.spaceScope.length > 0}
            open={openSects.has('scope')}
            onToggle={() => toggleSect('scope')}
          >
            {mySpaces.length === 0 && <p className="ssrch__muted">You haven&rsquo;t joined any organizations, communities, groups, or places yet.</p>}
            {SCOPE_GROUPS.map((g) => {
              const rows = mySpaces.filter((s) => s.kind === g.kind);
              if (!rows.length) return null;
              return (
                <div key={g.kind}>
                  <p className="ssrch__panel-h">{g.label}</p>
                  <div className="ssrch__pills">
                    {rows.map((s) => (
                      <button
                        key={s.id}
                        className={'ssrch__pill' + (criteria.spaceScope.includes(s.id) ? ' is-on' : '')}
                        onClick={() => setExtras((x) => ({ ...x, spaceScope: toggleIn(x.spaceScope, s.id) }))}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Section>

          <Section
            label="What"
            active={criteria.contentTypes.length > 0 || criteria.areas.length > 0}
            open={openSects.has('what')}
            onToggle={() => toggleSect('what')}
          >
            <p className="ssrch__panel-h">Kind of post</p>
            <div className="ssrch__pills">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  className={'ssrch__pill' + (criteria.contentTypes.includes(ct.value) ? ' is-on' : '')}
                  onClick={() => setExtras((x) => ({ ...x, contentTypes: toggleIn(x.contentTypes, ct.value) }))}
                >
                  {ct.label}
                </button>
              ))}
            </div>
            <p className="ssrch__panel-h">Looking in</p>
            <div className="ssrch__pills">
              {SERVICE_AREAS.map((a) => (
                <button
                  key={a.value}
                  className={'ssrch__pill' + (criteria.areas.includes(a.value) ? ' is-on' : '')}
                  onClick={() => setExtras((x) => ({ ...x, areas: toggleIn(x.areas, a.value) }))}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Section>

          <Section
            label="How"
            active={criteria.offers.length > 0 || criteria.priceMin != null || criteria.priceMax != null}
            open={openSects.has('how')}
            onToggle={() => toggleSect('how')}
          >
            <div className="ssrch__pills">
              {([['gift', 'Gift / Free'], ['trade', 'Trade'], ['rent', 'Rent'], ['lend', 'Lend'], ['borrow', 'Borrow'], ['iso', 'ISO'], ['buy', 'Buy']] as [OfferKind, string][]).map(([k, label]) => (
                <button
                  key={k}
                  className={'ssrch__pill' + (criteria.offers.includes(k) ? ' is-on' : '')}
                  onClick={() => setExtras((x) => ({ ...x, offers: toggleIn(x.offers, k) }))}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ssrch__row">
              <input
                className="ssrch__personq"
                type="number" min="0" inputMode="numeric"
                value={extras.priceMin}
                onChange={(e) => setExtras((x) => ({ ...x, priceMin: e.target.value }))}
                placeholder="Min $"
              />
              <input
                className="ssrch__personq"
                type="number" min="0" inputMode="numeric"
                value={extras.priceMax}
                onChange={(e) => setExtras((x) => ({ ...x, priceMax: e.target.value }))}
                placeholder="Max $"
              />
            </div>
          </Section>

          <Section
            label="Where"
            active={criteria.online || criteria.inPerson || criteria.radiusMiles != null}
            open={openSects.has('where')}
            onToggle={() => toggleSect('where')}
          >
            <div className="ssrch__pills">
              <button className={'ssrch__pill' + (criteria.online ? ' is-on' : '')} onClick={() => setExtras((x) => ({ ...x, online: !x.online }))}>Online</button>
              <button className={'ssrch__pill' + (criteria.inPerson ? ' is-on' : '')} onClick={() => setExtras((x) => ({ ...x, inPerson: !x.inPerson }))}>In person</button>
            </div>
            <div className="ssrch__row">
              <select
                className="ssrch__select"
                value={extras.radiusMiles ?? criteria.radiusMiles ?? ''}
                onChange={(e) => setExtras((x) => ({ ...x, radiusMiles: e.target.value ? Number(e.target.value) : null }))}
                aria-label="Distance"
              >
                <option value="">Any distance</option>
                {[5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>Within {n} mi</option>)}
              </select>
            </div>
            <LocationField
              className="ssrch__loc"
              value={extras.anchorText}
              geo={extras.anchorGeo}
              onChange={(t, g) => setExtras((x) => ({ ...x, anchorText: t, anchorGeo: g }))}
              placeholder="Measure distance from… (a town or address)"
            />
          </Section>

          <Section
            label="When"
            active={!!criteria.dateFrom || !!criteria.dateTo || criteria.hideConflicts}
            open={openSects.has('when')}
            onToggle={() => toggleSect('when')}
          >
            <div className="ssrch__row">
              <label className="ssrch__datelbl">From
                <input
                  className="ssrch__personq" type="date"
                  value={extras.dateFrom}
                  onChange={(e) => setExtras((x) => ({ ...x, dateFrom: e.target.value }))}
                />
              </label>
              <label className="ssrch__datelbl">To
                <input
                  className="ssrch__personq" type="date"
                  value={extras.dateTo}
                  onChange={(e) => setExtras((x) => ({ ...x, dateTo: e.target.value }))}
                />
              </label>
            </div>
            <label className="ssrch__check">
              <input
                type="checkbox"
                checked={extras.hideConflicts}
                onChange={(e) => setExtras((x) => ({ ...x, hideConflicts: e.target.checked }))}
              />
              Hide events that clash with my calendar
            </label>
          </Section>

          <Section
            label="Trusted by"
            active={!!criteria.trust.degree || !!criteria.trust.personId}
            open={openSects.has('trust')}
            onToggle={() => toggleSect('trust')}
          >
            {endorsePicker('trust', extras.trustDegree ?? parsed.trust.degree, extras.trustPerson, trustQ, setTrustQ)}
          </Section>

          <Section
            label="Recommended by"
            active={!!criteria.rec.degree || !!criteria.rec.personId}
            open={openSects.has('rec')}
            onToggle={() => toggleSect('rec')}
          >
            {endorsePicker('rec', extras.recDegree ?? parsed.rec.degree, extras.recPerson, recQ, setRecQ)}
          </Section>

          <div className="ssrch__panel-actions">
            <button className="btn" onClick={() => { setExtras(EMPTY_EXTRAS); setTopicQ(''); setTrustQ(''); setRecQ(''); }}>Reset</button>
            <button className="btn btn-primary" onClick={() => setPanelOpen(false)}>Apply</button>
          </div>
        </div>
      )}

      {searching && <p className="ssrch__status">Searching…</p>}
      {!searching && results && (assistantBusy || assistant) && !assistDismissed && (
        <div className="ssrch__assist">
          <span className="ssrch__assist-mark"><Icon name="sparkle" size={14} /></span>
          <span className="ssrch__assist-body">
            <span className="ssrch__assist-eyebrow">Assistant</span>
            {assistantBusy && <span className="ssrch__assist-text ssrch__assist-text--thinking">Reading the results&hellip;</span>}
            {!assistantBusy && assistant?.capped && (
              <span className="ssrch__assist-text">
                The assistant is resting until tomorrow — plain search keeps working.
              </span>
            )}
            {!assistantBusy && assistant?.text && (
              <>
                <span className="ssrch__assist-text">{assistant.text}</span>
                <span className="ssrch__assist-actions">
                  <button className="ssrch__assist-more" onClick={() => void askDeeper()} disabled={escalating}>
                    {escalating ? 'Opening…' : 'Ask about this →'}
                  </button>
                </span>
              </>
            )}
          </span>
          <button
            className="ssrch__assist-x"
            onClick={() => setDismissedKeys((s) => new Set(s).add(assistantKey))}
            aria-label="Dismiss"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {results?.anchorMissing && (
        <p className="ssrch__status">Couldn&rsquo;t place &ldquo;{criteria.anchorText ?? 'your location'}&rdquo; — distance filter skipped.</p>
      )}
      {!searching && results && total === 0 && (
        <p className="ssrch__status">Nothing matched — try widening the distance or dropping a filter.</p>
      )}
      {!hasSignal && (
        <p className="ssrch__hint">
          Write what you&rsquo;re looking for the way you&rsquo;d say it to a friend. Phrases like
          <em> people I trust</em>, <em>recommended</em>, <em>free</em>, <em>within 25 miles of&hellip;</em> and
          <em> in the next six months</em> become live filters — they light up when understood.
          Or open the sliders for the full criteria panel.
        </p>
      )}

      {results && results.people.length > 0 && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">People</h2>
          {results.people.map((p) => (
            // div, not button: the weave mark inside is its own control
            <div
              key={p.id}
              className="ssrch__hit"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.weave-mark')) return;
                navigate(`/members/${p.id}`);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/members/${p.id}`); }}
            >
              <Avatar id={p.id} name={p.full_name ?? 'Member'} url={p.avatar_url} size={40} />
              <span className="ssrch__hit-body">
                <span className="ssrch__hit-name">
                  {p.full_name ?? 'Member'}
                  {p.trusted && <Icon name="shield-user" size={12} />}
                </span>
                {(p.headline || p.categoryNames.length > 0) && (
                  <span className="ssrch__hit-sub">{p.headline || p.categoryNames.join(' · ')}</span>
                )}
                {(p.place || p.distanceMi != null) && (
                  <span className="ssrch__hit-loc">
                    <Icon name="location" size={11} />
                    {p.level !== 'exact' ? areaLabel(p.place) : p.place}
                    {p.distanceMi != null && ` · ~${Math.round(p.distanceMi)} mi`}
                  </span>
                )}
                {p.recommenders.length > 0 && (
                  <span className="ssrch__hit-rec">
                    <Icon name="thumbs-up" size={11} /> Recommended by {p.recommenders.slice(0, 2).join(', ')}
                    {p.recommenders.length > 2 && ` +${p.recommenders.length - 2}`}
                  </span>
                )}
              </span>
              {me && p.id !== me && (
                <WeaveMark
                  on={myWebSet.has('profile:' + p.id)}
                  onToggle={(on) => { void setInWeb('profile', p.id, on).catch(console.error); }}
                  entityName={p.full_name ?? 'this member'}
                  size={20}
                />
              )}
              <Icon name="chevron-right" size={14} />
            </div>
          ))}
        </section>
      )}

      {results && (results.posts.length > 0 || results.nearPosts.length > 0) && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">Happenings & posts</h2>
          {results.posts.map(postRow)}
          {results.posts.length === 0 && (
            <p className="ssrch__near-lead">Nothing matched every word — here&rsquo;s what came close.</p>
          )}
          {/* Second tier: matched some of your words, not all (founder
              2026-07-28) — precision first, adjacency still offered. */}
          {results.nearPosts.length > 0 && (
            <>
              <p className="ssrch__near-head">
                Close, but not everything you asked for
              </p>
              {results.nearPosts.map(postRow)}
            </>
          )}
        </section>
      )}

      {results && results.spaces.length > 0 && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">Organizations & places</h2>
          {results.spaces.map((s) => (
            <div
              key={s.id}
              className="ssrch__hit"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.weave-mark')) return;
                navigate(`/spaces/${s.id}`);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/spaces/${s.id}`); }}
            >
              <span className="ssrch__hit-icon"><Icon name="location" size={16} /></span>
              <span className="ssrch__hit-body">
                <span className="ssrch__hit-name">
                  {s.addressMatch && s.location ? <>{s.location} — <strong>{s.name.toUpperCase()}</strong></> : s.name}
                  {s.trusted && <Icon name="shield-user" size={12} />}
                </span>
                <span className="ssrch__hit-sub">
                  {s.kind.charAt(0).toUpperCase() + s.kind.slice(1)}
                  {!s.addressMatch && s.location && ` · ${s.location}`}
                  {s.distanceMi != null && ` · ~${Math.round(s.distanceMi)} mi`}
                </span>
                {s.recommenders.length > 0 && (
                  <span className="ssrch__hit-rec">
                    <Icon name="thumbs-up" size={11} /> Recommended by {s.recommenders.slice(0, 2).join(', ')}
                    {s.recommenders.length > 2 && ` +${s.recommenders.length - 2}`}
                  </span>
                )}
              </span>
              {me && (
                <WeaveMark
                  on={myWebSet.has('space:' + s.id)}
                  onToggle={(on) => { void setInWeb('space', s.id, on).catch(console.error); }}
                  entityName={s.name}
                  size={20}
                />
              )}
              <Icon name="chevron-right" size={14} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
