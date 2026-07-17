import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN, geocodeSuggest, type GeoPoint, type GeoSuggestion } from '../lib/geoApi';
import { supabase } from '../lib/supabase';
import { areaLabel } from '../lib/locationApi';
import { Icon } from '../components/Icon';
import { ScrollHintRow } from '../components/ScrollHintRow';
import LocationField from '../components/LocationField';
import { useAuth } from '../auth/AuthProvider';
import { colorFor, monogramFor } from '../lib/chatApi';
import { formatDateShort, localDate, todayISO } from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import { recurrenceLabel } from '../lib/recurrence';
import { loadFeed, postAreas, type FeedPost } from '../lib/postsApi';
import {
  loadMappableSpaces, listMyAdminSpaces, setSpaceLocation, createSpaceWithLocation,
  type MappableSpace, type SpaceKind,
} from '../lib/spacesApi';
import { loadMappableMembers, type MappableMember } from '../lib/locationApi';
import './MapView.css';

mapboxgl.accessToken = MAPBOX_TOKEN;

interface EventPin { post: FeedPost; lat: number; lng: number }

function whenLabel(p: FeedPost): string {
  const ev = p.linked_event;
  if (!ev) return '';
  if (ev.recurrence) return recurrenceLabel(ev.recurrence, ev.start_date);
  const day = localDate(ev.start_date).toLocaleDateString(undefined, { weekday: 'short' });
  const date = ev.start_date === ev.end_date
    ? `${day} ${formatDateShort(ev.start_date)}`
    : `${formatDateShort(ev.start_date)} – ${formatDateShort(ev.end_date)}`;
  if (ev.all_day || ev.start_min == null) return date;
  return `${date} · ${minToLabel(ev.start_min)}`;
}

const KIND_LABEL: Record<SpaceKind, string> = {
  place: 'Place', organization: 'Organization', community: 'Community', group: 'Group',
};

type LayerKey = 'events' | 'places' | 'orgs' | 'communities' | 'groups' | 'people';
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'places', label: 'Places' },
  { key: 'orgs', label: 'Orgs' },
  { key: 'communities', label: 'Communities' },
  { key: 'groups', label: 'Groups' },
  { key: 'people', label: 'People' },
];
const KIND_LAYER: Record<SpaceKind, LayerKey> = {
  place: 'places', organization: 'orgs', community: 'communities', group: 'groups',
};

export default function MapView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [eventPins, setEventPins] = useState<EventPin[]>([]);
  const [spacePins, setSpacePins] = useState<MappableSpace[]>([]);
  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    events: true, places: true, orgs: true, communities: true, groups: true, people: true,
  });
  const [peoplePins, setPeoplePins] = useState<MappableMember[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const reloadSpaces = useCallback(async () => {
    setSpacePins(await loadMappableSpaces());
  }, []);

  // ── data: upcoming in-person events + pinned places/orgs ──────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const today = todayISO();
      const [feed, spaces, people] = await Promise.all([loadFeed(), loadMappableSpaces(), loadMappableMembers()]);
      const mappable = feed
        .filter((p) => postAreas(p).includes('events'))
        .filter((p) => {
          const ev = p.linked_event;
          if (!ev || ev.lat == null || ev.lng == null) return false;
          return !!ev.recurrence || (ev.end_date ?? ev.start_date) >= today;
        })
        .map((p) => ({ post: p, lat: p.linked_event!.lat!, lng: p.linked_event!.lng! }));
      if (live) { setEventPins(mappable); setSpacePins(spaces); setPeoplePins(people); setReady(true); }
    })();
    return () => { live = false; };
  }, []);

  const visibleEvents = useMemo(() => (layers.events ? eventPins : []), [eventPins, layers]);
  const visibleSpaces = useMemo(
    () => spacePins.filter((s) => layers[KIND_LAYER[s.kind]]),
    [spacePins, layers],
  );
  const visiblePeople = useMemo(() => (layers.people ? peoplePins : []), [peoplePins, layers]);

  // ── map init (once) ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;   // StrictMode double-mount guard
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-98.5, 39.8],   // continental US until pins arrive
      zoom: 3.4,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, trackUserLocation: false }),
      'top-right',
    );
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const flyTo = useCallback((lng: number, lat: number, zoom = 13, markerKey?: string) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lng, lat], zoom, duration: 900 });
    if (markerKey) {
      const marker = markersRef.current.get(markerKey);
      if (marker && !marker.getPopup()?.isOpen()) marker.togglePopup();
    }
  }, []);

  // ── markers follow the visible pin sets ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    const next = new Map<string, mapboxgl.Marker>();

    const makePopup = (rows: { cls: string; text: string }[], action?: { label: string; onClick: () => void }) => {
      const el = document.createElement('div');
      el.className = 'mapv__popup';
      rows.filter((r) => r.text).forEach((r) => {
        const p = document.createElement('p');
        p.className = r.cls;
        p.textContent = r.text;
        el.appendChild(p);
      });
      if (action) {
        const btn = document.createElement('button');
        btn.className = 'mapv__popup-open';
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        el.appendChild(btn);
      }
      return new mapboxgl.Popup({ offset: 26, closeButton: false, maxWidth: '260px' }).setDOMContent(el);
    };

    visibleEvents.forEach(({ post, lat, lng }) => {
      const el = document.createElement('button');
      el.className = 'mapv__pin';
      el.setAttribute('aria-label', post.title ?? 'Event');
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: post.title || 'Event' },
            { cls: 'mapv__popup-when', text: whenLabel(post) },
            { cls: 'mapv__popup-loc', text: typeof post.details?.location === 'string' ? post.details.location : '' },
          ],
          { label: 'Open event', onClick: () => navigate(`/events/${post.id}`) },
        ))
        .addTo(map);
      next.set(`evt:${post.id}`, marker);
    });

    visibleSpaces.forEach((s) => {
      const el = document.createElement('button');
      el.className = 'mapv__pin mapv__pin--space';
      el.setAttribute('aria-label', s.name);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([s.lng!, s.lat!])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: s.name },
            { cls: 'mapv__popup-when', text: KIND_LABEL[s.kind] },
            { cls: 'mapv__popup-loc', text: s.location ?? '' },
          ],
          { label: 'View profile', onClick: () => navigate(`/spaces/${s.id}`) },
        ))
        .addTo(map);
      next.set(`spc:${s.id}`, marker);
    });

    visiblePeople.forEach((m) => {
      if (m.lat == null || m.lng == null) return; // state-level: findable, not pinnable
      const name = m.full_name ?? 'Member';
      const el = document.createElement('button');
      el.className = 'mapv__pin mapv__pin--person';
      el.setAttribute('aria-label', name);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([m.lng, m.lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: name },
            { cls: 'mapv__popup-when', text: m.level !== 'exact' ? 'Member · approximate' : 'Member' },
            { cls: 'mapv__popup-loc', text: (m.level !== 'exact' ? areaLabel(m.place) : m.place) ?? '' },
          ],
          { label: 'View profile', onClick: () => navigate(`/members/${m.id}`) },
        ))
        .addTo(map);
      next.set(`usr:${m.id}`, marker);
    });

    markersRef.current = next;

    if (next.size > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      visibleEvents.forEach(({ lat, lng }) => bounds.extend([lng, lat]));
      visibleSpaces.forEach((s) => bounds.extend([s.lng!, s.lat!]));
      visiblePeople.forEach((m) => { if (m.lat != null && m.lng != null) bounds.extend([m.lng, m.lat]); });
      map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 600 });
    }
  }, [visibleEvents, visibleSpaces, visiblePeople, navigate]);

  const totalPins = eventPins.length + spacePins.length + peoplePins.length;

  return (
    <div className="mapv">
      {/* Controls live ABOVE the map (founder mockup): + · search · layer pills */}
      <div className="mapv__bar">
        <div className="mapv__add-wrap">
          <button
            className={'mapv__bar-btn' + (sheetOpen ? ' is-on' : '')}
            onClick={() => { setSheetOpen((o) => !o); setSearchOpen(false); }}
            aria-label="Add a place"
          >
            <Icon name="plus" size={16} />
          </button>
          {sheetOpen && (
            <AddPlaceSheet
              me={me}
              onClose={() => setSheetOpen(false)}
              onSaved={async (geo) => {
                await reloadSpaces();
                if (geo) flyTo(geo.lng, geo.lat, 13);
              }}
            />
          )}
        </div>
        <button
          className={'mapv__bar-btn' + (searchOpen ? ' is-on' : '')}
          onClick={() => setSearchOpen((o) => !o)}
          aria-label="Search the map"
        >
          <Icon name="search" size={16} />
        </button>
        <ScrollHintRow className="mapv__layers h-scroll" role="toolbar" ariaLabel="Map layers">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              className={'mapv__layer' + (layers[l.key] ? ' is-on' : '')}
              onClick={() => setLayers((cur) => ({ ...cur, [l.key]: !cur[l.key] }))}
            >
              {l.label}
            </button>
          ))}
        </ScrollHintRow>
      </div>

      {searchOpen && (
        <MapSearch
          events={eventPins}
          spaces={spacePins}
          people={peoplePins}
          onFly={flyTo}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <div className="mapv__frame">
        <div ref={mapEl} className="mapv__map" />
        {ready && totalPins === 0 && (
          <div className="mapv__empty">
            <Icon name="maps" size={20} />
            <p>Nothing on the map yet — add a place with the + button, or pick a real address when you post an event.</p>
          </div>
        )}
      </div>

    </div>
  );
}

/** Search v1 — finds what's mappable: pins by name, anywhere via geocoding.
 *  This overlay is where the two full search modes mount later (freeform
 *  smart queries + the Advanced Search criteria panel — CLAUDE.md thread #4). */
function MapSearch({ events, spaces, people, onFly, onClose }: {
  events: EventPin[];
  spaces: MappableSpace[];
  people: MappableMember[];
  onFly: (lng: number, lat: number, zoom?: number, markerKey?: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [geoRows, setGeoRows] = useState<GeoSuggestion[]>([]);
  // Members/spaces that MATCH but have no pin — they still deserve to be
  // found (founder, 2026-07-17); their row says so and opens the profile.
  interface OffMapHit { type: 'profile' | 'space'; id: string; name: string; sub: string }
  const [offMap, setOffMap] = useState<OffMapHit[]>([]);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const t = q.trim();
    if (t.length < 3) { setGeoRows([]); setOffMap([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      const [geo, profs, sps] = await Promise.all([
        geocodeSuggest(t),
        supabase.from('profiles').select('id, full_name').ilike('full_name', `%${t}%`).limit(5),
        supabase.from('spaces').select('id, name, kind').ilike('name', `%${t}%`).limit(5),
      ]);
      setGeoRows(geo);
      const pinnedPeople = new Set(people.map((m) => m.id));
      const pinnedSpaces = new Set(spaces.filter((s) => s.lat != null && s.lng != null).map((s) => s.id));
      setOffMap([
        ...((profs.data ?? []) as { id: string; full_name: string | null }[])
          .filter((p) => !pinnedPeople.has(p.id))
          .map((p) => ({ type: 'profile' as const, id: p.id, name: p.full_name || 'Member', sub: 'Not sharing a location' })),
        ...((sps.data ?? []) as { id: string; name: string; kind: MappableSpace['kind'] }[])
          .filter((s) => !pinnedSpaces.has(s.id))
          .map((s) => ({ type: 'space' as const, id: s.id, name: s.name, sub: `${KIND_LABEL[s.kind]} · no location yet` })),
      ]);
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q, people, spaces]);

  const needle = q.trim().toLowerCase();
  const eventHits = needle.length < 2 ? [] : events.filter(({ post }) =>
    (post.title ?? '').toLowerCase().includes(needle) || post.body.toLowerCase().includes(needle)).slice(0, 5);
  const spaceHits = needle.length < 2 ? [] : spaces.filter((s) =>
    s.name.toLowerCase().includes(needle)).slice(0, 5);
  // People are pre-filtered by the privacy rules (mappable_members only
  // returns members visible to THIS viewer) — search can't leak anyone.
  const peopleHits = needle.length < 2 ? [] : people.filter((m) =>
    (m.full_name ?? '').toLowerCase().includes(needle)).slice(0, 5);

  return (
    <div className="mapv__search">
      <div className="mapv__search-row">
        <Icon name="search" size={15} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events, places, people, or anywhere…"
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        />
        <button className="mapv__search-x" onClick={onClose} aria-label="Close search">
          <Icon name="close" size={14} />
        </button>
      </div>
      {(eventHits.length > 0 || spaceHits.length > 0 || peopleHits.length > 0 || offMap.length > 0 || geoRows.length > 0) && (
        <ul className="mapv__search-list">
          {eventHits.map(({ post, lat, lng }) => (
            <li key={'e' + post.id}>
              <button onClick={() => { onFly(lng, lat, 13, `evt:${post.id}`); onClose(); }}>
                <Icon name="rsvp" size={14} /> <span>{post.title || 'Event'}</span>
                <em>{whenLabel(post)}</em>
              </button>
            </li>
          ))}
          {spaceHits.map((s) => (
            <li key={'s' + s.id}>
              <button onClick={() => { onFly(s.lng!, s.lat!, 13, `spc:${s.id}`); onClose(); }}>
                <Icon name="location" size={14} /> <span>{s.name}</span>
                <em>{KIND_LABEL[s.kind]}</em>
              </button>
            </li>
          ))}
          {peopleHits.map((m) => (
            <li key={'p' + m.id}>
              <button onClick={() => {
                if (m.lat == null || m.lng == null) { onClose(); navigate(`/members/${m.id}`); return; }
                onFly(m.lng, m.lat, m.level !== 'exact' ? 11 : 13, `usr:${m.id}`); onClose();
              }}>
                <Icon name="profile" size={14} /> <span>{m.full_name ?? 'Member'}</span>
                <em>{(m.level !== 'exact' ? areaLabel(m.place) : m.place) ?? 'Member'}</em>
              </button>
            </li>
          ))}
          {offMap.map((h) => (
            <li key={h.type + h.id}>
              <button
                className="mapv__search-offmap"
                onClick={() => { onClose(); navigate(h.type === 'profile' ? `/members/${h.id}` : `/spaces/${h.id}`); }}
              >
                <Icon name={h.type === 'profile' ? 'profile' : 'location'} size={14} />
                <span>{h.name}</span>
                <em>{h.sub}</em>
              </button>
            </li>
          ))}
          {geoRows.map((g, i) => (
            <li key={'g' + i}>
              <button onClick={() => { onFly(g.lng, g.lat, 12); onClose(); }}>
                <Icon name="globe" size={14} /> <span>Go to {g.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="mapv__search-smart" onClick={() => navigate('/search?from=maps')}>
        <Icon name="sliders" size={13} /> Smart search — filters, trust, distance…
      </button>
    </div>
  );
}

/** Add-a-Place sheet: give any space you administer a real address (picked
 *  suggestions pin it), or create a new place/organization right here. */
function AddPlaceSheet({ me, onClose, onSaved }: {
  me: string;
  onClose: () => void;
  onSaved: (geo: GeoPoint | null) => void;
}) {
  type View = 'list' | 'edit' | 'create';
  const navigate = useNavigate();
  const [view, setView] = useState<View>('list');
  const [mine, setMine] = useState<MappableSpace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<MappableSpace | null>(null);
  const [locText, setLocText] = useState('');
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<SpaceKind>('place');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) { setLoaded(true); return; }
    let live = true;
    (async () => {
      const rows = await listMyAdminSpaces(me);
      if (live) { setMine(rows); setLoaded(true); }
    })();
    return () => { live = false; };
  }, [me]);

  function startEdit(s: MappableSpace) {
    setEditing(s);
    setLocText(s.location ?? '');
    setLocGeo(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
    setView('edit');
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true); setError('');
    try {
      await setSpaceLocation(editing.id, locText, locGeo);
      onSaved(locGeo);
      onClose();
    } catch (e) {
      setError((e as Error)?.message || 'Could not save. Please try again.');
      setBusy(false);
    }
  }

  async function saveNew() {
    if (!me || !newName.trim()) { setError('Give it a name first.'); return; }
    setBusy(true); setError('');
    try {
      await createSpaceWithLocation(me, newName, newKind, locText, locGeo);
      onSaved(locGeo);
      onClose();
    } catch (e) {
      setError((e as Error)?.message || 'Could not create it. Please try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mapv__scrim" onClick={onClose} />
      <div className="mapv__sheet" role="dialog" aria-label="Add a place">
        <div className="mapv__sheet-head">
          <h3>
            {view === 'list' && 'Put a place on the map'}
            {view === 'edit' && editing?.name}
            {view === 'create' && 'New place'}
          </h3>
          <button className="mapv__search-x" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
        </div>

        {error && <p className="mapv__sheet-err">{error}</p>}

        {view === 'list' && (
          <>
            {!loaded && <p className="mapv__sheet-muted">Loading…</p>}
            {loaded && mine.length === 0 && (
              <p className="mapv__sheet-muted">
                You don&rsquo;t run any organizations, communities, groups, or places yet — create your first place below.
              </p>
            )}
            {mine.map((s) => (
              <button key={s.id} className="mapv__sheet-row" onClick={() => startEdit(s)}>
                <span className="mapv__sheet-avatar" style={{ background: colorFor(s.id) }}>{monogramFor(s.name)}</span>
                <span className="mapv__sheet-body">
                  <span className="mapv__sheet-name">{s.name}</span>
                  <span className="mapv__sheet-sub">
                    {KIND_LABEL[s.kind]} · {s.lat != null ? (s.location ?? 'Pinned') : (s.location ? `${s.location} (not pinned)` : 'No location yet')}
                  </span>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
            <button className="mapv__sheet-new" onClick={() => { setLocText(''); setLocGeo(null); setView('create'); }}>
              <Icon name="plus" size={14} /> New place
            </button>
          </>
        )}

        {view === 'edit' && (
          <>
            <label className="mapv__sheet-label">Location</label>
            <LocationField
              className="cmp__input"
              value={locText}
              geo={locGeo}
              onChange={(t, g) => { setLocText(t); setLocGeo(g); }}
            />
            <p className="mapv__sheet-hint">Pick a suggestion to put it on the map — free text saves, but won&rsquo;t pin.</p>
            <div className="mapv__sheet-actions">
              <button className="btn btn-primary" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="btn" onClick={() => setView('list')} disabled={busy}>Back</button>
            </div>
            {editing && (
              <button className="mapv__sheet-profile" onClick={() => navigate(`/spaces/${editing.id}`)}>
                Open full profile <Icon name="chevron-right" size={13} />
              </button>
            )}
          </>
        )}

        {view === 'create' && (
          <>
            <label className="mapv__sheet-label">Name</label>
            <input className="cmp__input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name your place" />
            <label className="mapv__sheet-label">What is it?</label>
            <div className="mapv__sheet-kinds">
              {(['place', 'organization'] as SpaceKind[]).map((k) => (
                <button
                  key={k}
                  className={'mapv__layer' + (newKind === k ? ' is-on' : '')}
                  onClick={() => setNewKind(k)}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="mapv__sheet-label">Location</label>
            <LocationField
              className="cmp__input"
              value={locText}
              geo={locGeo}
              onChange={(t, g) => { setLocText(t); setLocGeo(g); }}
            />
            <p className="mapv__sheet-hint">Pick a suggestion to put it on the map — free text saves, but won&rsquo;t pin.</p>
            <div className="mapv__sheet-actions">
              <button className="btn btn-primary" onClick={saveNew} disabled={busy || !me}>{busy ? 'Creating…' : 'Create'}</button>
              <button className="btn" onClick={() => setView('list')} disabled={busy}>Back</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
