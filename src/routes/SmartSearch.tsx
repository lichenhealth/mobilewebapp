import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import LocationField from '../components/LocationField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { GeoPoint } from '../lib/geoApi';
import { SERVICE_AREAS, postAreas, type FeedPost, type ServiceArea } from '../lib/postsApi';
import { formatDateShort, localDate } from '../lib/conciergeApi';
import {
  parseQuery, runSmartSearch, emptyCriteria,
  type SearchCategory, type SearchCriteria, type ParsedSpan, type SmartResults,
} from '../lib/smartSearch';
import './SmartSearch.css';

/** Smart search (Figma 286-3407): write a plain sentence — "Free or low cost
 *  spiritual trainings and events recommended by people I trust, online and
 *  offline in the next six months" — and the recognized phrases light up
 *  peach. The sliders button opens the manual criteria panel; panel choices
 *  ADD to what the sentence says (edit the sentence to take something back). */

interface Extras {
  trusted: boolean; recommended: boolean;
  free: boolean; trade: boolean; paid: boolean;
  online: boolean; inPerson: boolean;
  areas: ServiceArea[];
  radiusMiles: number | null;
  anchorText: string; anchorGeo: GeoPoint | null;
  monthsAhead: number | null;
}
const EMPTY_EXTRAS: Extras = {
  trusted: false, recommended: false, free: false, trade: false, paid: false,
  online: false, inPerson: false, areas: [],
  radiusMiles: null, anchorText: '', anchorGeo: null, monthsAhead: null,
};

function merge(parsed: SearchCriteria, x: Extras): SearchCriteria {
  return {
    ...parsed,
    trusted: parsed.trusted || x.trusted,
    recommended: parsed.recommended || x.recommended,
    free: parsed.free || x.free,
    trade: parsed.trade || x.trade,
    paid: parsed.paid || x.paid,
    online: parsed.online || x.online,
    inPerson: parsed.inPerson || x.inPerson,
    areas: [...new Set([...parsed.areas, ...x.areas])],
    radiusMiles: x.radiusMiles ?? parsed.radiusMiles,
    anchorText: x.anchorGeo ? x.anchorText : parsed.anchorText,
    anchorGeo: x.anchorGeo,
    monthsAhead: x.monthsAhead ?? parsed.monthsAhead,
  };
}

function whenLine(p: FeedPost): string {
  const ev = p.linked_event;
  if (!ev) return '';
  if (ev.recurrence) return 'Recurring';
  const day = localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short' });
  return `${day} ${formatDateShort(ev.start_date)}`;
}

export default function SmartSearch() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [q, setQ] = useState('');
  const [cats, setCats] = useState<SearchCategory[]>([]);
  const [extras, setExtras] = useState<Extras>(EMPTY_EXTRAS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [results, setResults] = useState<SmartResults | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const runRef = useRef(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('categories').select('id, name, domain');
      setCats((data as SearchCategory[] | null) ?? []);
    })();
  }, []);

  const { criteria: parsed, spans } = useMemo(
    () => (q.trim() ? parseQuery(q, cats) : { criteria: emptyCriteria(), spans: [] as ParsedSpan[] }),
    [q, cats],
  );
  const criteria = useMemo(() => merge(parsed, extras), [parsed, extras]);

  const hasSignal = q.trim().length >= 3
    || criteria.trusted || criteria.recommended || criteria.areas.length > 0
    || criteria.free || criteria.trade || criteria.paid || criteria.radiusMiles != null;

  // auto-grow the textarea with its content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
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

  const chips = useMemo(() => {
    const c = criteria;
    const out: string[] = [];
    if (c.trusted) out.push('people I trust');
    if (c.recommended) out.push('recommended by my mycelium');
    if (c.free) out.push('free / low cost');
    if (c.trade) out.push('trade');
    if (c.paid) out.push('paid');
    if (c.online && !c.inPerson) out.push('online');
    if (c.inPerson && !c.online) out.push('in person');
    if (c.online && c.inPerson) out.push('online + in person');
    if (c.radiusMiles != null) {
      out.push(`within ${c.radiusMiles} mi${c.anchorText ? ` of ${c.anchorText}` : c.nearMe ? ' of me' : ''}`);
    }
    if (c.monthsAhead != null) out.push(c.monthsAhead <= 1 ? 'this month' : `next ${c.monthsAhead} months`);
    for (const a of c.areas) out.push(SERVICE_AREAS.find((s) => s.value === a)?.label ?? a);
    for (const cat of c.categories) out.push(cat.name);
    return out;
  }, [criteria]);

  const areaPill = (a: ServiceArea) => criteria.areas.includes(a);
  const toggleExtra = (k: keyof Extras) => setExtras((x) => ({ ...x, [k]: !x[k] }));
  const toggleArea = (a: ServiceArea) => setExtras((x) => ({
    ...x, areas: x.areas.includes(a) ? x.areas.filter((v) => v !== a) : [...x.areas, a],
  }));

  const total = results ? results.people.length + results.posts.length + results.spaces.length : 0;

  return (
    <div className="ssrch">
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
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try: free spiritual trainings and events recommended by people I trust, within 25 miles of me, in the next six months…"
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
          <p className="ssrch__panel-h">Endorsement</p>
          <div className="ssrch__pills">
            <button className={'ssrch__pill' + (criteria.trusted ? ' is-on' : '')} onClick={() => toggleExtra('trusted')}>
              <Icon name="shield-user" size={13} /> People I trust
            </button>
            <button className={'ssrch__pill' + (criteria.recommended ? ' is-on' : '')} onClick={() => toggleExtra('recommended')}>
              <Icon name="thumbs-up" size={13} /> Recommended by my mycelium
            </button>
          </div>
          <p className="ssrch__panel-h">Cost & mode</p>
          <div className="ssrch__pills">
            <button className={'ssrch__pill' + (criteria.free ? ' is-on' : '')} onClick={() => toggleExtra('free')}>Free</button>
            <button className={'ssrch__pill' + (criteria.trade ? ' is-on' : '')} onClick={() => toggleExtra('trade')}>Trade</button>
            <button className={'ssrch__pill' + (criteria.paid ? ' is-on' : '')} onClick={() => toggleExtra('paid')}>Paid</button>
            <span className="ssrch__pill-gap" />
            <button className={'ssrch__pill' + (criteria.online ? ' is-on' : '')} onClick={() => toggleExtra('online')}>Online</button>
            <button className={'ssrch__pill' + (criteria.inPerson ? ' is-on' : '')} onClick={() => toggleExtra('inPerson')}>In person</button>
          </div>
          <p className="ssrch__panel-h">Looking in</p>
          <div className="ssrch__pills">
            {SERVICE_AREAS.map((a) => (
              <button key={a.value} className={'ssrch__pill' + (areaPill(a.value) ? ' is-on' : '')} onClick={() => toggleArea(a.value)}>
                {a.label}
              </button>
            ))}
          </div>
          <p className="ssrch__panel-h">Distance & time</p>
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
            <select
              className="ssrch__select"
              value={extras.monthsAhead ?? criteria.monthsAhead ?? ''}
              onChange={(e) => setExtras((x) => ({ ...x, monthsAhead: e.target.value ? Number(e.target.value) : null }))}
              aria-label="Time window"
            >
              <option value="">Anytime</option>
              <option value="1">This month</option>
              <option value="3">Next 3 months</option>
              <option value="6">Next 6 months</option>
              <option value="12">Next year</option>
            </select>
          </div>
          <LocationField
            className="ssrch__loc"
            value={extras.anchorText}
            geo={extras.anchorGeo}
            onChange={(t, g) => setExtras((x) => ({ ...x, anchorText: t, anchorGeo: g }))}
            placeholder="Measure distance from… (a town or address)"
          />
          <button className="ssrch__clear" onClick={() => setExtras(EMPTY_EXTRAS)}>Clear panel filters</button>
        </div>
      )}

      {searching && <p className="ssrch__status">Searching…</p>}
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
        </p>
      )}

      {results && results.people.length > 0 && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">People</h2>
          {results.people.map((p) => (
            <button key={p.id} className="ssrch__hit" onClick={() => navigate(`/members/${p.id}`)}>
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
                    {p.level === 'area' ? `Near ${p.place}` : p.place}
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
              <Icon name="chevron-right" size={14} />
            </button>
          ))}
        </section>
      )}

      {results && results.posts.length > 0 && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">Happenings & posts</h2>
          {results.posts.map((p) => (
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
          ))}
        </section>
      )}

      {results && results.spaces.length > 0 && (
        <section className="ssrch__sec">
          <h2 className="ssrch__h2">Organizations & places</h2>
          {results.spaces.map((s) => (
            <button key={s.id} className="ssrch__hit" onClick={() => navigate(`/spaces/${s.id}`)}>
              <span className="ssrch__hit-icon"><Icon name="location" size={16} /></span>
              <span className="ssrch__hit-body">
                <span className="ssrch__hit-name">
                  {s.name}
                  {s.trusted && <Icon name="shield-user" size={12} />}
                </span>
                <span className="ssrch__hit-sub">
                  {s.kind.charAt(0).toUpperCase() + s.kind.slice(1)}
                  {s.location && ` · ${s.location}`}
                  {s.distanceMi != null && ` · ~${Math.round(s.distanceMi)} mi`}
                </span>
                {s.recommenders.length > 0 && (
                  <span className="ssrch__hit-rec">
                    <Icon name="thumbs-up" size={11} /> Recommended by {s.recommenders.slice(0, 2).join(', ')}
                    {s.recommenders.length > 2 && ` +${s.recommenders.length - 2}`}
                  </span>
                )}
              </span>
              <Icon name="chevron-right" size={14} />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
