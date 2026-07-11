import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '../lib/geoApi';
import { Icon } from '../components/Icon';
import { formatDateShort, localDate, todayISO } from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import { recurrenceLabel } from '../lib/recurrence';
import {
  loadFeed, postAreas, EVENT_CATEGORIES, EVENT_MODES,
  type FeedPost, type EventCategory, type EventMode,
} from '../lib/postsApi';
import './MapView.css';

mapboxgl.accessToken = MAPBOX_TOKEN;

/** A mappable pin: an upcoming in-person event whose composer autocomplete
 *  was picked (linked event carries lat/lng). Video-link and free-typed
 *  locations never reach the map — that's deliberate, not a gap. */
interface Pin {
  post: FeedPost;
  lat: number;
  lng: number;
}

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

const TABS = ['All', ...EVENT_CATEGORIES.map((c) => c.label)];

export default function MapView() {
  const navigate = useNavigate();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('All');
  const [modes, setModes] = useState<EventMode[]>([]);

  // ── data: upcoming in-person events with coordinates ──────────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      const today = todayISO();
      const feed = (await loadFeed()).filter((p) => postAreas(p).includes('events'));
      const mappable = feed
        .filter((p) => {
          const ev = p.linked_event;
          if (!ev || ev.lat == null || ev.lng == null) return false;
          return !!ev.recurrence || (ev.end_date ?? ev.start_date) >= today;
        })
        .map((p) => ({ post: p, lat: p.linked_event!.lat!, lng: p.linked_event!.lng! }));
      if (live) { setPins(mappable); setReady(true); }
    })();
    return () => { live = false; };
  }, []);

  const visible = useMemo(() => {
    const cat = EVENT_CATEGORIES.find((c) => c.label === tab)?.value as EventCategory | undefined;
    return pins
      .filter((x) => tab === 'All' || x.post.event_category === cat)
      .filter((x) => modes.length === 0 || (x.post.event_mode != null && modes.includes(x.post.event_mode)));
  }, [pins, tab, modes]);

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

  // ── markers follow the filtered pin set ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = visible.map(({ post, lat, lng }) => {
      const el = document.createElement('button');
      el.className = 'mapv__pin';
      el.setAttribute('aria-label', post.title ?? 'Event');

      const popupEl = document.createElement('div');
      popupEl.className = 'mapv__popup';
      popupEl.innerHTML =
        `<p class="mapv__popup-title"></p>` +
        `<p class="mapv__popup-when"></p>` +
        `<p class="mapv__popup-loc"></p>` +
        `<button class="mapv__popup-open">Open event</button>`;
      (popupEl.querySelector('.mapv__popup-title') as HTMLElement).textContent =
        post.title || 'Event';
      (popupEl.querySelector('.mapv__popup-when') as HTMLElement).textContent = whenLabel(post);
      (popupEl.querySelector('.mapv__popup-loc') as HTMLElement).textContent =
        typeof post.details?.location === 'string' ? post.details.location : '';
      (popupEl.querySelector('.mapv__popup-open') as HTMLElement)
        .addEventListener('click', () => navigate(`/events/${post.id}`));

      return new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup({ offset: 26, closeButton: false, maxWidth: '260px' }).setDOMContent(popupEl))
        .addTo(map);
    });

    // First pins → frame them (one-time-ish; refitting on every filter is jarring)
    if (visible.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      visible.forEach(({ lat, lng }) => bounds.extend([lng, lat]));
      map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 600 });
    }
  }, [visible, navigate]);

  const toggleMode = (m: EventMode) =>
    setModes((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <div className="mapv">
      {/* Filters float above the map, matching the Events feed vocabulary */}
      <div className="mapv__filters">
        <div className="mapv__tabs h-scroll">
          {TABS.map((t) => (
            <button key={t} className={'mapv__chip' + (tab === t ? ' is-on' : '')} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
          <span className="mapv__chip-gap" />
          {EVENT_MODES.map((m) => (
            <button
              key={m.value}
              className={'mapv__chip' + (modes.includes(m.value) ? ' is-on' : '')}
              onClick={() => toggleMode(m.value)}
            >
              <Icon name={m.icon} size={11} /> {m.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={mapEl} className="mapv__map" />

      {ready && pins.length === 0 && (
        <div className="mapv__empty">
          <Icon name="maps" size={20} />
          <p>No mappable events yet — pick a real address when you post one, and it lands here.</p>
        </div>
      )}
    </div>
  );
}
