import { useEffect, useMemo, useRef, useState } from 'react';
import './TimeZonePick.css';

/** The booking pages' timezone picker (founder 2026-11-01, two passes the
 *  same hour: "a drop down that lets you change time zones before you
 *  book", then — the native select dumping 400 raw zones — "Let's have a
 *  search box with type ahead, then the default time, then an alphabetical
 *  order scroll"). A pill button opens a small panel: search first, the
 *  LEAD zones (the provider's and the viewer's own, labeled) under it,
 *  then every IANA zone alphabetically. Display-only — stored minutes stay
 *  provider-local by doctrine. */
export default function TimeZonePick({ value, zones, lead, onChange }: {
  value: string;
  zones: string[];                                 // alphabetical full list
  lead: { zone: string; label: string }[];         // provider + viewer, labeled
  onChange: (z: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    inputRef.current?.focus();
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const leadHits = needle
    ? lead.filter((l) => (l.zone.replace(/_/g, ' ') + ' ' + l.label).toLowerCase().includes(needle))
    : lead;
  const hits = useMemo(() => {
    const rest = zones.filter((z) => !lead.some((l) => l.zone === z));
    if (!needle) return rest;
    return rest.filter((z) => z.replace(/_/g, ' ').toLowerCase().includes(needle)
      || z.toLowerCase().includes(needle.replace(/\s+/g, '_')));
  }, [zones, lead, needle]);

  const pick = (z: string) => { onChange(z); setOpen(false); setQ(''); };

  return (
    <span className="tzpick" ref={boxRef}>
      <button type="button" className="tzpick__btn" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open} aria-label="Time zone">
        {value.replace(/_/g, ' ')}
      </button>
      {open && (
        <div className="tzpick__pop" role="listbox" aria-label="Pick a time zone">
          <input
            ref={inputRef}
            className="tzpick__search"
            placeholder="Search time zones"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
          />
          <div className="tzpick__list">
            {leadHits.map((l) => (
              <button type="button" key={l.zone} role="option" aria-selected={l.zone === value}
                className={'tzpick__row' + (l.zone === value ? ' is-on' : '')} onClick={() => pick(l.zone)}>
                {l.zone.replace(/_/g, ' ')} <em>{l.label}</em>
              </button>
            ))}
            {leadHits.length > 0 && hits.length > 0 && <div className="tzpick__seam" />}
            {hits.map((z) => (
              <button type="button" key={z} role="option" aria-selected={z === value}
                className={'tzpick__row' + (z === value ? ' is-on' : '')} onClick={() => pick(z)}>
                {z.replace(/_/g, ' ')}
              </button>
            ))}
            {leadHits.length + hits.length === 0 && <p className="tzpick__none">No zone matches that.</p>}
          </div>
        </div>
      )}
    </span>
  );
}
