import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { locationInfo } from '../lib/linkify';
import { geocodeSuggest, type GeoPoint, type GeoSuggestion } from '../lib/geoApi';
import './LocationField.css';

/** Composer location input with Mapbox address autocomplete.
 *
 *  Coordinates come ONLY from picking a suggestion — free-typed text (and
 *  video links, which skip suggestions entirely) stays text-only, and any
 *  manual edit after a pick clears the coordinates so the text and the map
 *  pin can never disagree. */
export default function LocationField({
  value, geo, onChange, placeholder, className,
}: {
  value: string;
  geo: GeoPoint | null;
  onChange: (text: string, geo: GeoPoint | null) => void;
  placeholder?: string;
  className?: string;   // the host form's input class (cmp__input / cedit__input)
}) {
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const skipNextLookup = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounced lookup — skipped for URLs (video links stay first-class) and
  // right after a pick (the input change a pick causes isn't a new query).
  useEffect(() => {
    if (skipNextLookup.current) { skipNextLookup.current = false; return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const t = value.trim();
    const isUrl = /^https?:\/\//i.test(t) || /^www\./i.test(t);
    if (t.length < 3 || isUrl || locationInfo(t)?.type === 'video') {
      setSuggestions([]); setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const results = await geocodeSuggest(t);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 300);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [value]);

  // Close the dropdown on outside taps.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(s: GeoSuggestion) {
    skipNextLookup.current = true;
    setSuggestions([]); setOpen(false);
    onChange(s.label, { lat: s.lat, lng: s.lng });
  }

  return (
    <div className="locfield" ref={wrapRef}>
      <input
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value, null)}   // edits always clear geo
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder={placeholder ?? 'Address, place, or video link'}
        autoComplete="off"
      />
      {geo && (
        <span className="locfield__pinned" title="On the map">
          <Icon name="location" size={12} /> pinned
        </span>
      )}
      {open && suggestions.length > 0 && (
        <ul className="locfield__list" role="listbox">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button type="button" className="locfield__option" onClick={() => pick(s)}>
                <Icon name="location" size={13} />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
