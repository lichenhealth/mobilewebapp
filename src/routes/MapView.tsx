import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navPref, outsideOrder, rememberNavApp } from '../lib/navApp';
import { loadMyHome } from '../lib/locationApi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN, geocodeSuggest, type GeoPoint, type GeoSuggestion } from '../lib/geoApi';
import { supabase } from '../lib/supabase';
import { areaLabel } from '../lib/locationApi';
import { Icon, iconSvgMarkup, type IconName } from '../components/Icon';
import ScopeBack from '../components/ScopeBack';
import AssistantDoor from '../components/AssistantDoor';
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
import { loadMappableMembers, loadBizLocationPins, type MappableMember, type BizLocationPin } from '../lib/locationApi';
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

type LayerKey = 'events' | 'travel' | 'places' | 'orgs' | 'communities' | 'groups' | 'people';
// Each layer wears the mark that section wears everywhere else, so a pin and
// its filter read as the same thing (founder 2026-08-15).
const LAYERS: { key: LayerKey; label: string; icon: IconName }[] = [
  { key: 'events', label: 'Events', icon: 'rsvp' },
  // Travel pins (founder 2026-10-06): a stay or a ride's starting point,
  // offered with a real address, shows where it IS — the Places interplay.
  { key: 'travel', label: 'Travel', icon: 'plane' },
  { key: 'places', label: 'Places', icon: 'location' },
  { key: 'orgs', label: 'Orgs', icon: 'globe' },
  { key: 'communities', label: 'Communities', icon: 'user-multiple' },
  { key: 'groups', label: 'Groups', icon: 'groups' },
  { key: 'people', label: 'People', icon: 'member-heart' },
];
/** The pin's glyph, drawn straight from Icon.tsx so map and app never drift. */
const LAYER_ICON: Record<LayerKey, IconName> = {
  events: 'rsvp', travel: 'plane', places: 'location', orgs: 'globe',
  communities: 'user-multiple', groups: 'groups', people: 'member-heart',
};
const KIND_LAYER: Record<SpaceKind, LayerKey> = {
  place: 'places', organization: 'orgs', community: 'communities', group: 'groups',
};

// ── NAVIGATION, BUILT INTO MAPS (founder 2026-11-17: "let's build navigation
// into maps more seamlessly" + "a prompt for getting directions… load it as
// the start address and let you type the destination, or reverse the order"
// + "you also can 'add stop' as you would in google") ─────────────────────
export interface NavPoint { lng: number; lat: number; label: string; addr?: string; here?: boolean }
export type NavMode = 'driving' | 'walking' | 'cycling';
const HERE: NavPoint = { lng: 0, lat: 0, label: 'Your location', here: true };
const MAX_POINTS = 10;
const enc = encodeURIComponent;

/** Metres between two [lng, lat] points. */
function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Metres from a point to the nearest segment of a line (flat-earth, fine at street scale). */
function metresToLine(p: [number, number], line: [number, number][]): number {
  if (line.length < 2) return Infinity;
  const kx = 111320 * Math.cos(p[1] * Math.PI / 180), ky = 110540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
    const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** Where this device is right now — the browser's own prompt is the consent. */
function getHere(timeout = 8000): Promise<[number, number] | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(null), timeout);
    navigator.geolocation.getCurrentPosition(
      (p) => { window.clearTimeout(t); resolve([p.coords.longitude, p.coords.latitude]); },
      () => { window.clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeout - 500, maximumAge: 60000 },
    );
  });
}
/** The one route address: /maps?route=<lng,lat;…>&names=a|b&addrs=a|b&here=1&mode=. */
export function routeUrl(points: NavPoint[], mode: NavMode = 'driving'): string {
  const clean = (t: string) => t.replace(/\|/g, ' ').slice(0, 90);
  return `/maps?route=${points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')}`
    + `&names=${enc(points.map((p) => clean(p.label)).join('|'))}`
    + `&addrs=${enc(points.map((p) => clean(p.addr ?? '')).join('|'))}`
    + (points[0]?.here ? '&here=1' : '') + (mode !== 'driving' ? `&mode=${mode}` : '');
}
/** A Lichen place the From/To boxes can offer by name. */
interface PlaceHit { key: string; label: string; sub: string; lng: number; lat: number; addr?: string }

/** A pin's popup: its words, then its doors. */
function makePopup(rows: { cls: string; text: string }[], actions: { label: string; onClick: () => void; cls?: string }[]) {
  const el = document.createElement('div');
  el.className = 'mapv__popup';
  rows.filter((r) => r.text).forEach((r) => {
    const p = document.createElement('p');
    p.className = r.cls;
    p.textContent = r.text;
    el.appendChild(p);
  });
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'mapv__popup-acts';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = a.cls ?? 'mapv__popup-open';
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      row.appendChild(btn);
    });
    el.appendChild(row);
  }
  return new mapboxgl.Popup({ offset: 26, closeButton: false, maxWidth: '280px' }).setDOMContent(el);
}

export default function MapView() {
  const navigate = useNavigate();
  // ?space= / ?member= / ?event= — arrive pointed AT something (founder
  // 2026-08-15: a space's Place door dropped you on a map of everything
  // nearby, with no way to tell which pin was theirs). Flies to that pin
  // and opens its own popup, so the answer is on screen.
  const [mapParams] = useSearchParams();
  const focusSpace = mapParams.get('space');
  const focusMember = mapParams.get('member');
  const focusEvent = mapParams.get('event');
  const { user } = useAuth();
  const me = user?.id ?? '';
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [eventPins, setEventPins] = useState<EventPin[]>([]);
  const [travelPins, setTravelPins] = useState<EventPin[]>([]);
  const [spacePins, setSpacePins] = useState<MappableSpace[]>([]);
  const [ready, setReady] = useState(false);
  // THE LAYERS SPEAK HOME'S FEED GRAMMAR (founder 2026-11-02: "there should
  // be a feed button to the left that is orange, with all the filters white,
  // just like the homepage, so you know you're seeing all by default, and
  // filtering to the airplane, for example, will show only travel map
  // destinations"): an empty selection = EVERYTHING (the lit Feed door);
  // picking layers narrows to just those, multi-select, and tapping Feed
  // clears back to all. The derived record keeps every downstream
  // visible-pin read unchanged.
  const [layerSel, setLayerSel] = useState<Set<LayerKey>>(new Set());
  const layers = useMemo(() => {
    const all = layerSel.size === 0;
    return Object.fromEntries(
      LAYERS.map((l) => [l.key, all || layerSel.has(l.key)]),
    ) as Record<LayerKey, boolean>;
  }, [layerSel]);
  const [peoplePins, setPeoplePins] = useState<MappableMember[]>([]);
  const [bizPins, setBizPins] = useState<BizLocationPin[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPrefill, setSheetPrefill] = useState<{ text: string; geo: GeoPoint } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // THE DIRECTIONS BOX (founder 2026-11-17): From · stops · To, reversible.
  const [dirInit, setDirInit] = useState<(NavPoint | null)[] | null>(null);
  const openDirections = useCallback((init: (NavPoint | null)[]) => {
    setSearchOpen(false); setSheetOpen(false); setDirInit(init);
  }, []);
  const dirRef = useRef(openDirections);
  dirRef.current = openDirections;
  const [, setParams] = useSearchParams();
  const tempPinRef = useRef<mapboxgl.Marker | null>(null);

  const reloadSpaces = useCallback(async () => {
    setSpacePins(await loadMappableSpaces());
  }, []);

  // ── data: upcoming in-person events + pinned places/orgs ──────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const today = todayISO();
      const [feed, spaces, people, biz] = await Promise.all([loadFeed(), loadMappableSpaces(), loadMappableMembers(), loadBizLocationPins()]);
      const mappable = feed
        .filter((p) => postAreas(p).includes('events'))
        .filter((p) => {
          const ev = p.linked_event;
          if (!ev || ev.lat == null || ev.lng == null) return false;
          return !!ev.recurrence || (ev.end_date ?? ev.start_date) >= today;
        })
        .map((p) => ({ post: p, lat: p.linked_event!.lat!, lng: p.linked_event!.lng! }));
      // Travel posts with a real pin (founder 2026-10-06): a stay's address,
      // or where a ride leaves from — Compose geocodes details.geo whenever
      // the member picked an In-person place.
      const travel = feed
        .filter((p) => postAreas(p).includes('travel') && !postAreas(p).includes('events'))
        .filter((p) => {
          const g = (p.details as { geo?: { lat?: unknown; lng?: unknown } } | null)?.geo;
          return typeof g?.lat === 'number' && typeof g?.lng === 'number';
        })
        .map((p) => {
          const g = (p.details as { geo: { lat: number; lng: number } }).geo;
          return { post: p, lat: g.lat, lng: g.lng };
        });
      if (live) { setEventPins(mappable); setTravelPins(travel); setSpacePins(spaces); setPeoplePins(people); setBizPins(biz); setReady(true); }
    })();
    return () => { live = false; };
  }, []);

  const visibleEvents = useMemo(() => (layers.events ? eventPins : []), [eventPins, layers]);
  const visibleTravel = useMemo(() => (layers.travel ? travelPins : []), [travelPins, layers]);
  // A pin on the map already means "somewhere you can go", so the Places
  // layer shows every pinned space regardless of kind (founder 2026-08-06:
  // "organizations can show up in a places search... if they have an HQ").
  // Its own kind layer still shows it too — one pin, two ways to find it.
  const visibleSpaces = useMemo(
    () => spacePins.filter((s) => layers[KIND_LAYER[s.kind]] || layers.places),
    [spacePins, layers],
  );
  const visiblePeople = useMemo(() => (layers.people ? peoplePins : []), [peoplePins, layers]);
  // Goods & Services addresses ride the Places layer — a pin already means
  // "somewhere you can go", and a member's farm stand is exactly that.
  const visibleBiz = useMemo(() => (layers.places ? bizPins : []), [bizPins, layers]);

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
    // Every pin offers a way there (founder 2026-11-17).
    const dirAction = (dest: NavPoint) => ({
      label: 'Directions', cls: 'mapv__popup-dir',
      onClick: () => dirRef.current([HERE, dest]),
    });

    /** A pin that says WHAT it is (founder 2026-08-15). The teardrop is
     *  rotated 45°, so the glyph rides in a counter-rotated child to stay
     *  upright. Markup is built by hand (not React) because mapbox markers
     *  take a raw DOM element — the paths still come from ICON_SVG, so map
     *  and app can't drift. */
    const makePin = (extraClass: string, layer: LayerKey, label: string) => {
      const el = document.createElement('button');
      el.className = 'mapv__pin' + (extraClass ? ' ' + extraClass : '');
      el.setAttribute('aria-label', label);
      const glyph = document.createElement('span');
      glyph.className = 'mapv__pin-glyph';
      glyph.innerHTML = iconSvgMarkup(LAYER_ICON[layer], 15);
      el.appendChild(glyph);
      return el;
    };

    visibleEvents.forEach(({ post, lat, lng }) => {
      const el = makePin('', 'events', post.title ?? 'Event');
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: post.title || 'Event' },
            { cls: 'mapv__popup-when', text: whenLabel(post) },
            { cls: 'mapv__popup-loc', text: typeof post.details?.location === 'string' ? post.details.location : '' },
          ],
          [
            { label: 'Open event', onClick: () => navigate(`/events/${post.id}`) },
            dirAction({ lng, lat, label: post.title || 'Event', addr: typeof post.details?.location === 'string' ? post.details.location : '' }),
          ],
        ))
        .addTo(map);
      next.set(`evt:${post.id}`, marker);
    });

    visibleTravel.forEach(({ post, lat, lng }) => {
      const d = (post.details ?? {}) as { travelKind?: unknown; routeFrom?: unknown; routeTo?: unknown; location?: unknown; sleeps?: unknown };
      const kind = d.travelKind === 'ride' ? 'Ride / transport' : d.travelKind === 'flight' ? 'Flight' : d.travelKind === 'stay' ? 'Stay' : 'Travel';
      const routeLine = [d.routeFrom, d.routeTo].filter((x) => typeof x === 'string' && x).join(' → ');
      const el = makePin('mapv__pin--space', 'travel', post.title ?? 'Travel');
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: post.title || 'Travel' },
            { cls: 'mapv__popup-when', text: typeof d.sleeps === 'number' ? `${kind} · sleeps ${d.sleeps}` : kind },
            { cls: 'mapv__popup-loc', text: routeLine || (typeof d.location === 'string' ? d.location : '') },
          ],
          [
            { label: 'Open the offer', onClick: () => navigate(`/posts/${post.id}`) },
            dirAction({ lng, lat, label: post.title || 'Travel', addr: typeof d.location === 'string' ? d.location : '' }),
          ],
        ))
        .addTo(map);
      next.set(`trv:${post.id}`, marker);
    });

    visibleSpaces.forEach((s) => {
      const el = makePin('mapv__pin--space', KIND_LAYER[s.kind], s.name);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([s.lng!, s.lat!])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: s.name },
            { cls: 'mapv__popup-when', text: KIND_LABEL[s.kind] },
            { cls: 'mapv__popup-loc', text: s.location ?? '' },
          ],
          [
            { label: 'View profile', onClick: () => navigate(`/spaces/${s.id}`) },
            dirAction({ lng: s.lng!, lat: s.lat!, label: s.name, addr: s.location ?? '' }),
          ],
        ))
        .addTo(map);
      next.set(`spc:${s.id}`, marker);
    });

    visiblePeople.forEach((m) => {
      if (m.lat == null || m.lng == null) return; // state-level: findable, not pinnable
      const name = m.full_name ?? 'Member';
      const el = makePin('mapv__pin--person', 'people', name);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([m.lng, m.lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: name },
            { cls: 'mapv__popup-when', text: m.level !== 'exact' ? 'Member · approximate' : 'Member' },
            { cls: 'mapv__popup-loc', text: (m.level !== 'exact' ? areaLabel(m.place) : m.place) ?? '' },
          ],
          m.level === 'exact'
            ? [{ label: 'View profile', onClick: () => navigate(`/members/${m.id}`) }, dirAction({ lng: m.lng, lat: m.lat, label: name, addr: m.place ?? '' })]
            : [{ label: 'View profile', onClick: () => navigate(`/members/${m.id}`) }],
        ))
        .addTo(map);
      next.set(`usr:${m.id}`, marker);
    });

    // A member's goods & services spots (founder 2026-08-11) — place-style
    // pins whose door opens the member behind them.
    visibleBiz.forEach((b) => {
      const el = makePin('mapv__pin--person', 'people', b.label || b.location);
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([b.lng, b.lat])
        .setPopup(makePopup(
          [
            { cls: 'mapv__popup-title', text: b.label || 'Goods & services' },
            { cls: 'mapv__popup-when', text: b.owner_name ? `Goods & services · ${b.owner_name}` : 'Goods & services' },
            { cls: 'mapv__popup-loc', text: b.location },
          ],
          [
            { label: 'View member', onClick: () => navigate(`/members/${b.profile_id}`) },
            dirAction({ lng: b.lng, lat: b.lat, label: b.label || b.location, addr: b.location }),
          ],
        ))
        .addTo(map);
      next.set(`biz:${b.id}`, marker);
    });

    markersRef.current = next;

    // A route on screen owns the camera — fitting every pin would zoom back
    // out over it (founder 2026-11-17: the route "didn't actually populate").
    if (next.size > 0 && !new URLSearchParams(window.location.search).get('route')) {
      const bounds = new mapboxgl.LngLatBounds();
      visibleEvents.forEach(({ lat, lng }) => bounds.extend([lng, lat]));
      visibleSpaces.forEach((s) => bounds.extend([s.lng!, s.lat!]));
      visiblePeople.forEach((m) => { if (m.lat != null && m.lng != null) bounds.extend([m.lng, m.lat]); });
      visibleBiz.forEach((b) => bounds.extend([b.lng, b.lat]));
      map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 600 });
    }
  }, [visibleEvents, visibleTravel, visibleSpaces, visiblePeople, visibleBiz, navigate]);

  // Wait for the marker to exist (they're rebuilt whenever pins/layers
  // change), then fly once. `done` keeps a later re-render from yanking the
  // map back while someone is panning around.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current) return;
    if (focusSpace) {
      const sp = spacePins.find((x) => x.id === focusSpace);
      if (sp?.lat != null && sp?.lng != null) {
        focusedOnce.current = true;
        window.setTimeout(() => flyTo(sp.lng!, sp.lat!, 14, `spc:${sp.id}`), 350);
      }
      return;
    }
    if (focusMember) {
      const biz = bizPins.find((b) => b.profile_id === focusMember);
      if (biz) {
        focusedOnce.current = true;
        window.setTimeout(() => flyTo(biz.lng, biz.lat, 14, `biz:${biz.id}`), 350);
        return;
      }
      const per = peoplePins.find((m) => m.id === focusMember);
      if (per?.lat != null && per?.lng != null) {
        focusedOnce.current = true;
        window.setTimeout(() => flyTo(per.lng!, per.lat!, 14, `usr:${per.id}`), 350);
      }
      return;
    }
    if (focusEvent) {
      const ev = eventPins.find((e) => e.post.id === focusEvent);
      if (ev) {
        focusedOnce.current = true;
        window.setTimeout(() => flyTo(ev.lng, ev.lat, 14, `evt:${ev.post.id}`), 350);
      }
    }
  }, [focusSpace, focusMember, focusEvent, spacePins, peoplePins, bizPins, eventPins, flyTo]);

  /** A searched address that isn't on Lichen gets a + teardrop (founder
   *  2026-11-17: "nothing happens… Do the map pin teardrop with a '+' button
   *  and you can either get directions or add place"). */
  const dropPin = useCallback((g: GeoSuggestion) => {
    const map = mapRef.current;
    if (!map) return;
    tempPinRef.current?.remove();
    const el = document.createElement('button');
    el.className = 'mapv__pin mapv__pin--drop';
    el.setAttribute('aria-label', g.label);
    const glyph = document.createElement('span');
    glyph.className = 'mapv__pin-glyph';
    glyph.innerHTML = iconSvgMarkup('plus', 15);
    el.appendChild(glyph);
    const point: NavPoint = { lng: g.lng, lat: g.lat, label: g.label, addr: g.label };
    const popup = makePopup(
      [{ cls: 'mapv__popup-title', text: g.label }, { cls: 'mapv__popup-when', text: 'Not on Lichen yet' }],
      [
        { label: 'Directions to here', cls: 'mapv__popup-dir', onClick: () => { popup.remove(); dirRef.current([HERE, point]); } },
        { label: 'Start from here', cls: 'mapv__popup-dir', onClick: () => { popup.remove(); dirRef.current([point, null]); } },
        { label: 'Add as a place', onClick: () => { popup.remove(); setSheetPrefill({ text: g.label, geo: { lat: g.lat, lng: g.lng } }); setSearchOpen(false); setDirInit(null); setSheetOpen(true); } },
      ],
    );
    tempPinRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([g.lng, g.lat]).setPopup(popup).addTo(map);
    map.flyTo({ center: [g.lng, g.lat], zoom: 14, duration: 900 });
    window.setTimeout(() => { if (!popup.isOpen()) tempPinRef.current?.togglePopup(); }, 950);
  }, []);
  useEffect(() => () => { tempPinRef.current?.remove(); }, []);

  /** Lichen places the From/To boxes know by name. */
  const places = useMemo<PlaceHit[]>(() => [
    ...spacePins.filter((x) => x.lat != null && x.lng != null).map((x) => ({ key: 'spc:' + x.id, label: x.name, sub: KIND_LABEL[x.kind], lng: x.lng!, lat: x.lat!, addr: x.location ?? '' })),
    ...bizPins.map((b) => ({ key: 'biz:' + b.id, label: b.label || b.location, sub: b.owner_name ? `Goods & services · ${b.owner_name}` : 'Goods & services', lng: b.lng, lat: b.lat, addr: b.location })),
    ...eventPins.map(({ post, lat, lng }) => ({ key: 'evt:' + post.id, label: post.title || 'Event', sub: whenLabel(post) || 'Event', lng, lat, addr: typeof post.details?.location === 'string' ? post.details.location : '' })),
    ...peoplePins.filter((m) => m.level === 'exact' && m.lat != null && m.lng != null).map((m) => ({ key: 'usr:' + m.id, label: m.full_name ?? 'Member', sub: 'Member', lng: m.lng!, lat: m.lat!, addr: m.place ?? '' })),
  ], [spacePins, bizPins, eventPins, peoplePins]);

  const totalPins = eventPins.length + travelPins.length + spacePins.length + peoplePins.length + bizPins.length;

  return (
    <div className="mapv">
      <ScopeBack />
      {/* Home's stacked anatomy (founder 2026-11-01: "can the home screen
          setup be used for maps, too? design in-consistency to remedy" —
          superseding this bar's one-line tools|divider|lenses shape): the
          tools row — Search · + · AI — on its own line with the bone-edge
          seam under it, then the layer lenses below, wrapping full-width. */}
      <div className="mapv__bar">
        <div className="mapv__tools">
          <button
            className={'mapv__bar-btn' + (searchOpen ? ' is-on' : '')}
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Search the map" data-tip="Search"
          >
            <Icon name="search" size={16} />
          </button>
          <button
            className={'mapv__bar-btn' + (dirInit ? ' is-on' : '')}
            onClick={() => (dirInit ? setDirInit(null) : openDirections([HERE, null]))}
            aria-label="Directions" data-tip="Directions"
          >
            <Icon name="car" size={16} />
          </button>
          <div className="mapv__add-wrap">
            <button
              className={'mapv__bar-btn' + (sheetOpen ? ' is-on' : '')}
              onClick={() => { setSheetPrefill(null); setSheetOpen((o) => !o); setSearchOpen(false); setDirInit(null); }}
              aria-label="Add a place" data-tip="Add a place"
            >
              <Icon name="plus" size={16} />
            </button>
            {sheetOpen && (
              <AddPlaceSheet
                key={sheetPrefill?.text ?? 'blank'}
                me={me}
                prefill={sheetPrefill}
                onClose={() => { setSheetOpen(false); setSheetPrefill(null); }}
                onSaved={async (geo) => {
                  await reloadSpaces();
                  tempPinRef.current?.remove(); tempPinRef.current = null;
                  if (geo) flyTo(geo.lng, geo.lat, 13);
                }}
              />
            )}
          </div>
          <AssistantDoor section="maps" size={34} label="Your assistant — what's near you and worth knowing" />
        </div>
        <div className="mapv__layers" role="toolbar" aria-label="Map layers">
          {/* The lit Feed door = everything, Home's grammar (founder
              2026-11-02) — selecting any layer unlights it and narrows. */}
          <button
            className={'mapv__layer' + (layerSel.size === 0 ? ' is-on' : '')}
            onClick={() => setLayerSel(new Set())}
            aria-pressed={layerSel.size === 0}
            aria-label="Everything"
            data-tip="Everything"
          >
            <Icon name="newsfeed" size={16} />
          </button>
          {LAYERS.map((l) => {
            const on = layerSel.has(l.key);
            return (
              <button
                key={l.key}
                className={'mapv__layer' + (on ? ' is-on' : '')}
                onClick={() => setLayerSel((cur) => {
                  const next = new Set(cur);
                  if (next.has(l.key)) next.delete(l.key); else next.add(l.key);
                  return next;
                })}
                aria-pressed={on}
                aria-label={l.label}
                data-tip={l.label}
              >
                <Icon name={l.icon} size={16} />
              </button>
            );
          })}
        </div>
      </div>

      {searchOpen && (
        <MapSearch
          events={eventPins}
          spaces={spacePins}
          people={peoplePins}
          onFly={flyTo}
          onPlace={dropPin}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {dirInit && (
        <DirPanel
          key={JSON.stringify(dirInit)}
          init={dirInit}
          places={places}
          mode0={(mapParams.get('mode') as NavMode) || 'driving'}
          onGo={(pts, mode) => { setDirInit(null); tempPinRef.current?.remove(); tempPinRef.current = null; navigate(routeUrl(pts, mode)); }}
          onClose={() => setDirInit(null)}
        />
      )}

      <div className="mapv__frame">
        <div ref={mapEl} className="mapv__map" />
        {mapParams.get('route') && (
          <RouteCard
            mapRef={mapRef}
            spec={mapParams.get('route')!}
            names={mapParams.get('names')?.split('|') ?? [mapParams.get('from') ?? '', mapParams.get('to') ?? '']}
            addrs={mapParams.get('addrs')?.split('|') ?? []}
            here={mapParams.get('here') === '1' || /your (location|home)|where you are/i.test(mapParams.get('from') ?? '') && mapParams.get('from') !== 'your home'}
            mode={(mapParams.get('mode') as NavMode) || 'driving'}
            started={mapParams.get('start') === 'lichen'}
            onMode={(m) => setParams((cur) => { const n = new URLSearchParams(cur); if (m === 'driving') n.delete('mode'); else n.set('mode', m); return n; }, { replace: true })}
            onEdit={openDirections}
            onClose={() => navigate('/maps', { replace: true })}
          />
        )}
        {ready && totalPins === 0 && !mapParams.get('route') && (
          <div className="mapv__empty">
            <Icon name="maps" size={20} />
            <p>Nothing on the map yet — add a place with the + button, or pick a real address when you post an event.</p>
          </div>
        )}
      </div>

    </div>
  );
}

/** NAVIGATION IN LICHEN MAPS (founder 2026-11-17: "can we build navigation
 *  in as well, so it will swap me over to maps and then give me driving
 *  directions to the facial?"). /maps?route=<lng,lat;lng,lat>&to=&from=
 *  draws the live-traffic route and lists every turn; Start hands the same
 *  route to the phone's own navigator for voice guidance. */
type RouteStep = { text: string; dist: number; dur: number; at: [number, number]; arrive: boolean };
type RouteInfo = { mins: number; miles: number; steps: RouteStep[]; geom: [number, number][]; traffic: boolean };
const MODES: { key: NavMode; label: string }[] = [
  { key: 'driving', label: 'Drive' }, { key: 'walking', label: 'Walk' }, { key: 'cycling', label: 'Bike' },
];
const dist = (m: number) => (m < 160 ? `${Math.round(m * 3.281 / 10) * 10} ft` : `${(m / 1609.34).toFixed(1)} mi`);
const fmtMins = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)} hr${mins % 60 ? ` ${mins % 60} min` : ''}` : `${Math.max(1, mins)} min`);

async function fetchRoute(coords: [number, number][], mode: NavMode): Promise<{ route: { duration: number; distance: number; geometry: { coordinates: [number, number][] }; legs: { steps: { maneuver: { instruction?: string; location: [number, number]; type?: string }; distance: number; duration: number }[] }[] }; traffic: boolean } | null> {
  // Live traffic only takes three points (Mapbox's limit) — a longer trip
  // rides plain driving times and says so.
  const first = mode === 'walking' ? 'walking' : mode === 'cycling' ? 'cycling' : coords.length <= 3 ? 'driving-traffic' : 'driving';
  // A dropped connection or a busy server gets one more try a beat later
  // (founder 2026-11-17: "have default protocols to do the necessary pings").
  const tryOne = async (profile: string) => {
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords.map((c) => c.join(',')).join(';')}`
      + `?steps=true&geometries=geojson&overview=full&radiuses=${coords.map(() => 'unlimited').join(';')}&access_token=${MAPBOX_TOKEN}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url);
        if (r.ok) return (await r.json())?.routes?.[0] ?? null;
        if (r.status < 500 && r.status !== 429) return null;   // a real "no route"
      } catch { /* network — try once more */ }
      if (attempt === 0) await new Promise((res) => window.setTimeout(res, 1200));
    }
    return null;
  };
  const a = await tryOne(first);
  if (a) return { route: a, traffic: first === 'driving-traffic' };
  if (first === 'driving-traffic') { const b = await tryOne('driving'); if (b) return { route: b, traffic: false }; }
  return null;
}

function RouteCard({ mapRef, spec, names, addrs, here, mode, started, onMode, onEdit, onClose }: {
  mapRef: React.MutableRefObject<mapboxgl.Map | null>; spec: string; names: string[]; addrs: string[];
  here: boolean; mode: NavMode;
  /** They already chose Lichen Maps (the brain's door) — skip the choice. */
  started: boolean;
  onMode: (m: NavMode) => void;
  onEdit: (pts: (NavPoint | null)[]) => void;
  onClose: () => void;
}) {
  const pts = spec.split(';').map((p) => p.split(',').map(Number)) as [number, number][];
  const valid = pts.length >= 2 && pts.length <= MAX_POINTS && pts.every((p) => p.length === 2 && p.every((n) => Number.isFinite(n)));
  const last = pts.length - 1;
  const nameAt = (i: number) => (names[i] || '').trim() || (i === 0 ? 'Start' : i === last ? 'your destination' : `Stop ${i}`);
  const [info, setInfo] = useState<RouteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  // ── live navigation (Go mode) ──
  const [nav, setNav] = useState(false);
  const [cur, setCur] = useState(0);
  const [toNext, setToNext] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [note, setNote] = useState('');
  const [arrived, setArrived] = useState(false);
  const stepsRef = useRef<RouteStep[]>([]);
  const geomRef = useRef<[number, number][]>([]);
  const curRef = useRef(0);
  const legsRef = useRef(0);
  const offRef = useRef(0);
  const reroutingRef = useRef(false);
  const spokenRef = useRef<Set<number>>(new Set());
  const mutedRef = useRef(false);
  const watchRef = useRef<number | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const meRef = useRef<mapboxgl.Marker | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  mutedRef.current = muted;

  const speak = (text: string) => {
    if (mutedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* voice is a nicety */ }
  };

  /** Draw a route on the map, retrying until the map's style is ready. */
  const draw = (geom: [number, number][], stops: [number, number][], fit: boolean) => {
    let tries = 0;
    const attempt = () => {
      const map = mapRef.current;
      if (!(map && map.isStyleLoaded())) { if (++tries < 60) window.setTimeout(attempt, 250); return; }
      try {
        const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: geom } };
        const src = map.getSource('lichen-route') as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(data);
        else {
          map.addSource('lichen-route', { type: 'geojson', data });
          map.addLayer({ id: 'lichen-route', type: 'line', source: 'lichen-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#E07B4F', 'line-width': 5, 'line-opacity': 0.9 } });
        }
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = stops.map((p, i) => {
          const el = document.createElement('div');
          el.className = 'mapv__stopdot' + (i === 0 ? ' is-start' : '');
          el.textContent = i === 0 ? '' : i === stops.length - 1 ? '' : String(i);
          return new mapboxgl.Marker(i === 0 ? { element: el } : (i === stops.length - 1 ? { color: '#E07B4F' } : { element: el })).setLngLat(p).addTo(map);
        });
        if (fit) {
          const b = new mapboxgl.LngLatBounds();
          for (const c of geom) b.extend(c);
          map.fitBounds(b, { padding: { top: 60, bottom: 260, left: 40, right: 40 }, duration: 800 });
        }
      } catch { if (++tries < 60) window.setTimeout(attempt, 250); }
    };
    attempt();
  };

  const apply = (res: NonNullable<Awaited<ReturnType<typeof fetchRoute>>>, stops: [number, number][], fit: boolean) => {
    const steps: RouteStep[] = res.route.legs.flatMap((l) => l.steps.map((st) => ({
      text: st.maneuver.instruction ?? '', dist: st.distance, dur: st.duration, at: st.maneuver.location, arrive: st.maneuver.type === 'arrive',
    })));
    stepsRef.current = steps;
    geomRef.current = res.route.geometry.coordinates;
    setInfo({ mins: Math.round(res.route.duration / 60), miles: Math.round((res.route.distance / 1609.34) * 10) / 10, steps, geom: res.route.geometry.coordinates, traffic: res.traffic });
    draw(res.route.geometry.coordinates, stops, fit);
  };

  useEffect(() => {
    if (!valid) { setErr('That route link is incomplete.'); return; }
    let live = true;
    setInfo(null); setErr(null);
    void (async () => {
      try {
        // A route that starts from "your location" was pinned when it was
        // asked for — maybe an hour ago in the brain. Ask the device again
        // and start from where they actually are now.
        let use = pts;
        if (here) {
          const now = await getHere(5000);
          if (!live) return;
          if (now && metres(now, pts[0]) > 250) use = [now, ...pts.slice(1)];
        }
        const res = await fetchRoute(use, mode);
        if (!live) return;
        if (!res) { setErr('The route didn’t load — check your connection and try again.'); return; }
        apply(res, use, true);
      } catch { if (live) setErr('The route didn’t load — check your connection and try again.'); }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, mode, retry]);

  // Clear the line and pins when the card goes.
  useEffect(() => () => {
    stopNav();
    markersRef.current.forEach((m) => m.remove());
    const map = mapRef.current;
    if (map?.getLayer('lichen-route')) map.removeLayer('lichen-route');
    if (map?.getSource('lichen-route')) map.removeSource('lichen-route');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopNav() {
    if (watchRef.current != null) { navigator.geolocation?.clearWatch(watchRef.current); watchRef.current = null; }
    void wakeRef.current?.release().catch(() => {}); wakeRef.current = null;
    meRef.current?.remove(); meRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
  }

  async function reroute(from: [number, number]) {
    if (reroutingRef.current) return;
    reroutingRef.current = true;
    setNote('Finding a new way…');
    const remaining = pts.slice(1 + legsRef.current);
    const res = await fetchRoute([from, ...remaining], mode).catch(() => null);
    reroutingRef.current = false;
    offRef.current = 0;
    if (!res) { setNote('Couldn’t find a new way just now — keep going, trying again soon.'); return; }
    curRef.current = 0; setCur(0); spokenRef.current = new Set();
    apply(res, [from, ...remaining], false);
    setNote('New route ✓');
    speak(stepsRef.current[1]?.text ?? '');
  }

  function onPos(p: GeolocationPosition) {
    const here: [number, number] = [p.coords.longitude, p.coords.latitude];
    const map = mapRef.current;
    if (map) {
      if (!meRef.current) {
        const el = document.createElement('div');
        el.className = 'mapv__me';
        meRef.current = new mapboxgl.Marker({ element: el }).setLngLat(here).addTo(map);
      } else meRef.current.setLngLat(here);
      const moving = (p.coords.speed ?? 0) > 1.5 && p.coords.heading != null && !Number.isNaN(p.coords.heading);
      map.easeTo({ center: here, zoom: Math.max(map.getZoom(), 15.5), bearing: moving ? p.coords.heading! : map.getBearing(), duration: 700 });
    }
    const steps = stepsRef.current;
    if (!steps.length) return;
    setNote((n) => (n.startsWith('Can’t see') ? '' : n));
    const thr = mode === 'driving' ? 30 : 15;
    // Pass every maneuver we're at (or have skipped past): a stop's arrival
    // and the next leg's departure share one spot, so one reading can clear
    // several steps (the simulated drive got stuck at "in 0 ft").
    let c = curRef.current;
    let moved = false;
    for (let guard = 0; guard < 6; guard++) {
      let jump = -1;
      for (let j = c + 1; j <= Math.min(c + 4, steps.length - 1); j++) {
        if (metres(here, steps[j].at) < thr) jump = j;
      }
      if (jump < 0) break;
      for (let j = c + 1; j <= jump; j++) {
        if (steps[j].arrive && j < steps.length - 1) {
          legsRef.current += 1;
          speak(`You've reached ${nameAt(legsRef.current)}.`);
        }
      }
      c = jump; moved = true;
    }
    if (moved) { curRef.current = c; setCur(c); }
    if (c >= steps.length - 1) {
      setArrived(true); setNote(''); setToNext(null);
      speak(`You've arrived at ${nameAt(last)}.`);
      stopNav();
      return;
    }
    const next = steps[c + 1];
    const d = metres(here, next.at);
    setToNext(d);
    const near = mode === 'driving' ? 160 : 60;
    if (d < near && !spokenRef.current.has(c + 1)) { spokenRef.current.add(c + 1); speak(next.text); }
    else if (moved && d > 500) speak(`Continue for ${dist(d)}, then ${next.text.charAt(0).toLowerCase()}${next.text.slice(1)}`);
    // Off the line for three readings in a row → a fresh route from here.
    const off = metresToLine(here, geomRef.current) > (mode === 'driving' ? 70 : 40);
    offRef.current = off ? offRef.current + 1 : 0;
    if (offRef.current >= 3) void reroute(here);
  }

  async function startNav() {
    if (!info) return;
    if (!navigator.geolocation) { setNote('This device can’t share where it is.'); return; }
    setNav(true); setArrived(false); setOpen(false); setNote('');
    curRef.current = 0; setCur(0); legsRef.current = 0; offRef.current = 0; spokenRef.current = new Set();
    try { wakeRef.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* the screen may dim */ }
    speak(`Starting. ${info.steps[0]?.text ?? ''}`);
    watchRef.current = navigator.geolocation.watchPosition(onPos, (e) => {
      // Only a refusal is worth saying; a slow fix just waits for the next one.
      if (e.code === 1) setNote('Can’t see where you are — allow location for Lichen in your browser settings.');
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function endNav() {
    stopNav();
    setNav(false); setArrived(false); setToNext(null); setNote('');
    if (info) draw(info.geom, pts, true);
    const map = mapRef.current;
    map?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
  }

  // Outside apps: real addresses when we have them, "your location" left
  // for the app to fill (founder 2026-11-17), coordinates as the fallback.
  const arg = (i: number) => { const a = (addrs[i] || '').trim(); return a && /\d/.test(a) ? a : `${pts[i][1]},${pts[i][0]}`; };
  const mids = pts.slice(1, -1).map((_, k) => k + 1);
  const gm = mode === 'walking' ? 'walking' : mode === 'cycling' ? 'bicycling' : 'driving';
  const google = valid ? `https://www.google.com/maps/dir/?api=1${here ? '' : `&origin=${enc(arg(0))}`}&destination=${enc(arg(last))}`
    + (mids.length ? `&waypoints=${enc(mids.map(arg).join('|'))}` : '') + `&travelmode=${gm}&dir_action=navigate` : '';
  const apple = !valid ? '' : mids.length
    ? `https://maps.apple.com/directions?${here ? '' : `source=${enc(arg(0))}&`}destination=${enc(arg(last))}${mids.map((i) => `&waypoint=${enc(arg(i))}`).join('')}&mode=${mode === 'walking' ? 'walking' : mode === 'cycling' ? 'cycling' : 'driving'}`
    : `https://maps.apple.com/?${here ? '' : `saddr=${enc(arg(0))}&`}daddr=${enc(arg(last))}&dirflg=${mode === 'walking' ? 'w' : 'd'}`;
  const outside = outsideOrder().map((k) => (k === 'apple'
    ? { key: 'apple' as const, name: 'Apple Maps', href: apple }
    : { key: 'google' as const, name: 'Google Maps', href: google }));
  const pref = navPref();
  useEffect(() => { if (started || pref === 'lichen') setOpen(true); }, [pref, started]);
  const editPoints = (): NavPoint[] => pts.map((p, i) => (i === 0 && here
    ? HERE
    : { lng: p[0], lat: p[1], label: nameAt(i), addr: addrs[i] || undefined }));

  if (nav && info) {
    const steps = info.steps;
    const next = steps[cur + 1];
    const leftMins = Math.round(steps.slice(cur + 1).reduce((a, s) => a + s.dur, 0) / 60);
    const leftMi = steps.slice(cur + 1).reduce((a, s) => a + s.dist, 0) / 1609.34;
    return (
      <div className="mapv__route mapv__route--nav">
        <div className="mapv__nav-next">
          <p className="mapv__nav-turn">{arrived ? `You've arrived at ${nameAt(last)}` : next?.text || 'Head to the route'}</p>
          {!arrived && toNext != null && <p className="mapv__nav-in">in {dist(toNext)}</p>}
        </div>
        {!arrived && <p className="mapv__route-sum"><strong>{fmtMins(leftMins)}</strong> · {leftMi.toFixed(1)} mi left · to {nameAt(last)}</p>}
        {note && <p className="mapv__nav-note">{note}</p>}
        <div className="mapv__nav-acts">
          <button type="button" className="mapv__route-app" onClick={() => setMuted((m) => !m)}>{muted ? 'Unmute' : 'Mute voice'}</button>
          <button type="button" className={'mapv__route-app' + (open ? ' is-on' : '')} onClick={() => setOpen((v) => !v)}>Turns</button>
          <button type="button" className="mapv__route-app mapv__route-end" onClick={endNav}>{arrived ? 'Done' : 'End'}</button>
        </div>
        {open && (
          <ol className="mapv__route-steps">
            {steps.slice(cur + 1).map((st, i) => <li key={i}><span>{st.text}</span>{st.dist > 0 && <span className="mapv__route-dist">{dist(st.dist)}</span>}</li>)}
          </ol>
        )}
        <p className="mapv__route-fine">Keep Lichen open on screen — a phone browser pauses navigation when it locks or you switch apps. For spoken turns with the screen off, use Apple Maps or Google Maps.</p>
      </div>
    );
  }

  return (
    <div className="mapv__route">
      <div className="mapv__route-head">
        <div>
          <p className="mapv__route-to">To {nameAt(last)}{mids.length ? ` · ${mids.length} stop${mids.length > 1 ? 's' : ''}` : ''}</p>
          {info && <p className="mapv__route-sum"><strong>{fmtMins(info.mins)}</strong> · {info.miles} mi{info.traffic ? ' · live traffic' : ''} · from {here ? 'where you are' : nameAt(0) === 'their home' ? 'your home' : nameAt(0)}</p>}
          {!info && !err && <p className="mapv__route-sum">Finding the way…</p>}
          {err && <p className="mapv__route-sum">{err}{valid && <> <button className="mapv__route-edit" onClick={() => setRetry((n) => n + 1)}>Try again</button></>}</p>}
        </div>
        <button type="button" className="mapv__route-x" onClick={onClose} aria-label="Close the route">×</button>
      </div>
      {valid && (
        <div className="mapv__route-modes">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={'mapv__mode' + (mode === m.key ? ' is-on' : '')} aria-pressed={mode === m.key} onClick={() => onMode(m.key)}>{m.label}</button>
          ))}
          <button type="button" className="mapv__route-edit" onClick={() => onEdit(editPoints())}>Edit stops</button>
        </div>
      )}
      {valid && started && (
        <div className="mapv__route-go">
          <button type="button" className="mapv__route-start" disabled={!info} onClick={() => { rememberNavApp('lichen'); void startNav(); }}>Start</button>
        </div>
      )}
      {valid && !started && (
        <div className="mapv__route-go" role="group" aria-label="Start in">
          <span className="mapv__route-golbl">Start in:</span>
          <button type="button" className="mapv__route-app mapv__route-app--lichen" disabled={!info}
            onClick={() => { rememberNavApp('lichen'); void startNav(); }}>
            Lichen Maps
          </button>
          {outside.map((x) => (
            <a key={x.key} className="mapv__route-app" href={x.href} target="_blank" rel="noreferrer" onClick={() => rememberNavApp(x.key)}>
              {x.name} ↗
            </a>
          ))}
        </div>
      )}
      {info && info.steps.length > 0 && (
        <button type="button" className="mapv__route-turns" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'See all'} {info.steps.length} turns</button>
      )}
      {open && info && (
        <ol className="mapv__route-steps">
          {info.steps.map((st, i) => <li key={i}><span>{st.text}</span>{st.dist > 0 && <span className="mapv__route-dist">{dist(st.dist)}</span>}</li>)}
        </ol>
      )}
      <p className="mapv__route-fine">
        Lichen Maps follows you and speaks each turn while Lichen stays open. Apple Maps and Google Maps take the same route{mids.length ? ', stops included' : ''} with turn-by-turn that keeps going with the screen off.
        {mids.length > 1 && mode === 'driving' ? ' Live traffic covers trips with one stop; this one uses normal driving times.' : ''}
      </p>
    </div>
  );
}

/** THE DIRECTIONS BOX (founder 2026-11-17): From · stops · To. Any row takes
 *  your location, Home, a Lichen place by name, or any address; ⇅ reverses
 *  the order and + Add stop slips a stop in before the destination. */
function DirPanel({ init, places, mode0, onGo, onClose }: {
  init: (NavPoint | null)[];
  places: PlaceHit[];
  mode0: NavMode;
  onGo: (pts: NavPoint[], mode: NavMode) => void;
  onClose: () => void;
}) {
  const start = init.length >= 2 ? init : [HERE, null];
  const [rows, setRows] = useState<(NavPoint | null)[]>(start);
  const [texts, setTexts] = useState<string[]>(start.map((r) => r?.label ?? ''));
  const [active, setActive] = useState<number>(() => { const i = start.findIndex((r) => !r); return i; });
  const [geo, setGeo] = useState<GeoSuggestion[]>([]);
  const [home, setHome] = useState<NavPoint | null>(null);
  const [mode, setMode] = useState<NavMode>(mode0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    void loadMyHome().then((h) => { if (h.geo) setHome({ lng: h.geo.lng, lat: h.geo.lat, label: 'Home', addr: h.location }); });
  }, []);
  useEffect(() => { if (active >= 0) inputs.current[active]?.focus(); }, [active, rows.length]);
  const q = active >= 0 ? (texts[active] ?? '').trim() : '';
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (q.length < 3 || (active >= 0 && rows[active])) { setGeo([]); return; }
    debounce.current = window.setTimeout(() => { void geocodeSuggest(q).then(setGeo); }, 300);
    return () => { if (debounce.current) window.clearTimeout(debounce.current); };
  }, [q, active, rows]);

  const needle = q.toLowerCase();
  const sugg: { key: string; label: string; sub: string; pick: NavPoint }[] = [];
  if (active >= 0 && !rows[active]) {
    if (!needle || /^(you|my|cur|here|loc)/.test(needle)) sugg.push({ key: 'here', label: 'Your location', sub: 'Where this device is', pick: HERE });
    if (home && (!needle || 'home'.startsWith(needle))) sugg.push({ key: 'home', label: 'Home', sub: home.addr || 'Your saved home', pick: home });
    if (needle.length >= 2) {
      for (const p of places) {
        if (sugg.length > 8) break;
        if (p.label.toLowerCase().includes(needle)) sugg.push({ key: p.key, label: p.label, sub: p.sub, pick: { lng: p.lng, lat: p.lat, label: p.label, addr: p.addr } });
      }
    }
    geo.forEach((g, i) => sugg.push({ key: 'g' + i, label: g.label, sub: 'Address', pick: { lng: g.lng, lat: g.lat, label: g.label, addr: g.label } }));
  }

  const pick = (i: number, p: NavPoint) => {
    const r = rows.slice(); r[i] = p; setRows(r);
    const t = texts.slice(); t[i] = p.label; setTexts(t);
    setErr(''); setGeo([]);
    const nextEmpty = r.findIndex((x) => !x);
    setActive(nextEmpty);
  };
  const edit = (i: number, v: string) => {
    const r = rows.slice(); r[i] = null; setRows(r);
    const t = texts.slice(); t[i] = v; setTexts(t);
    setActive(i);
  };
  const swap = () => { setRows((r) => r.slice().reverse()); setTexts((t) => t.slice().reverse()); setActive(-1); };
  const addStop = () => {
    if (rows.length >= MAX_POINTS) return;
    const at = rows.length - 1;
    setRows((r) => [...r.slice(0, at), null, ...r.slice(at)]);
    setTexts((t) => [...t.slice(0, at), '', ...t.slice(at)]);
    setActive(at);
  };
  const remove = (i: number) => {
    if (rows.length <= 2) { edit(i, ''); return; }
    setRows((r) => r.filter((_, k) => k !== i));
    setTexts((t) => t.filter((_, k) => k !== i));
    setActive(-1);
  };

  async function go() {
    if (rows.some((r) => !r)) { setErr('Pick a place for every row — start, stops and destination.'); setActive(rows.findIndex((r) => !r)); return; }
    let pts = rows as NavPoint[];
    if (pts.some((p) => p.here)) {
      setBusy(true);
      const at = await getHere();
      setBusy(false);
      if (!at) { setErr('Lichen can’t see where you are — allow location for Lichen, or type a starting address.'); return; }
      pts = pts.map((p) => (p.here ? { ...p, lng: at[0], lat: at[1] } : p));
    }
    onGo(pts, mode);
  }

  const role = (i: number) => (i === 0 ? 'From' : i === rows.length - 1 ? 'To' : `Stop ${i}`);
  return (
    <div className="mapv__dir">
      <div className="mapv__dir-head">
        <p className="mapv__dir-title">Directions</p>
        <button type="button" className="mapv__search-x" onClick={onClose} aria-label="Close directions"><Icon name="close" size={14} /></button>
      </div>
      <div className="mapv__dir-body">
        <ol className="mapv__dir-rows">
          {rows.map((r, i) => (
            <li key={i} className={'mapv__dir-row' + (active === i ? ' is-active' : '')}>
              <span className="mapv__dir-role">{role(i)}</span>
              <input
                ref={(el) => { inputs.current[i] = el; }}
                value={texts[i] ?? ''}
                placeholder={i === 0 ? 'Starting point' : i === rows.length - 1 ? 'Where to?' : 'Add a stop'}
                onFocus={() => setActive(i)}
                onChange={(e) => edit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose();
                  if (e.key === 'Enter') { e.preventDefault(); if (!rows[i] && sugg[0]) pick(i, sugg[0].pick); else void go(); }
                }}
                className={r?.here ? 'is-here' : ''}
                autoComplete="off"
              />
              {(i > 0 && i < rows.length - 1) || (r && rows.length > 2) ? (
                <button type="button" className="mapv__dir-x" onClick={() => remove(i)} aria-label={`Remove ${role(i)}`}><Icon name="close" size={12} /></button>
              ) : null}
            </li>
          ))}
        </ol>
        <button type="button" className="mapv__dir-swap" onClick={swap} aria-label="Reverse the order" data-tip="Reverse">⇅</button>
      </div>
      {sugg.length > 0 && (
        <ul className="mapv__search-list mapv__dir-sugg">
          {sugg.map((sg) => (
            <li key={sg.key}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(active, sg.pick)}>
                <Icon name={sg.key === 'here' ? 'location' : sg.key === 'home' ? 'home' : sg.key.startsWith('g') ? 'globe' : 'location'} size={14} />
                <span>{sg.label}</span><em>{sg.sub}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mapv__dir-foot">
        {rows.length < MAX_POINTS && <button type="button" className="mapv__dir-add" onClick={addStop}>+ Add stop</button>}
        <div className="mapv__route-modes">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={'mapv__mode' + (mode === m.key ? ' is-on' : '')} aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <button type="button" className="mapv__route-start" disabled={busy} onClick={() => void go()}>{busy ? 'Finding you…' : 'Get directions'}</button>
      </div>
      {err && <p className="mapv__dir-err">{err}</p>}
    </div>
  );
}

/** Search v1 — finds what's mappable: pins by name, anywhere via geocoding.
 *  This overlay is where the two full search modes mount later (freeform
 *  smart queries + the Advanced Search criteria panel — CLAUDE.md thread #4). */
function MapSearch({ events, spaces, people, onFly, onPlace, onClose }: {
  events: EventPin[];
  spaces: MappableSpace[];
  people: MappableMember[];
  onFly: (lng: number, lat: number, zoom?: number, markerKey?: string) => void;
  /** An address not on Lichen — drops the + pin. */
  onPlace: (g: GeoSuggestion) => void;
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
              <button onClick={() => { onPlace(g); onClose(); }}>
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
function AddPlaceSheet({ me, prefill, onClose, onSaved }: {
  me: string;
  /** An address searched on the map (founder 2026-11-17: the + pin's "Add as a place"). */
  prefill?: { text: string; geo: GeoPoint } | null;
  onClose: () => void;
  onSaved: (geo: GeoPoint | null) => void;
}) {
  type View = 'list' | 'edit' | 'create';
  const navigate = useNavigate();
  const [view, setView] = useState<View>(prefill ? 'create' : 'list');
  const [mine, setMine] = useState<MappableSpace[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<MappableSpace | null>(null);
  const [locText, setLocText] = useState(prefill?.text ?? '');
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(prefill?.geo ?? null);
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
    // A searched address rides into whichever place you pick for it.
    setLocText(prefill?.text ?? s.location ?? '');
    setLocGeo(prefill?.geo ?? (s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null));
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
            <button className="mapv__sheet-new" onClick={() => { setLocText(prefill?.text ?? ''); setLocGeo(prefill?.geo ?? null); setView('create'); }}>
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
