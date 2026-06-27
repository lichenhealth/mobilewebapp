import { useState, useMemo } from 'react';
import './CategoryPicker.css';

export type Category = {
  id: string;
  domain: 'good' | 'service';
  name: string;
  sort: number;
};

type Props = {
  domain: 'good' | 'service';
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
};

export default function CategoryPicker({ domain, categories, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const pool = useMemo(
    () =>
      categories
        .filter((c) => c.domain === domain)
        .sort((a, b) => a.sort - b.sort),
    [categories, domain],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  }, [pool, query]);

  const selectedSet = new Set(selected);
  const chosen = pool.filter((c) => selectedSet.has(c.id));
  const noun = domain === 'good' ? 'goods' : 'services';

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div className="cat">
      <button type="button" className="cat__toggle" onClick={() => setOpen((o) => !o)}>
        <span>{chosen.length ? `${chosen.length} ${noun} selected` : `Choose ${noun}`}</span>
        <span className="cat__chev">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {chosen.length > 0 && (
        <div className="cat__chips">
          {chosen.map((c) => (
            <button key={c.id} type="button" className="cat__chip" onClick={() => toggle(c.id)}>
              {c.name} <span className="cat__chip-x">{'\u00D7'}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="cat__panel">
          <input
            className="cat__search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${noun}\u2026`}
            autoFocus
          />
          <div className="cat__list">
            {filtered.length === 0 && <p className="cat__empty">No matches.</p>}
            {filtered.map((c) => {
              const on = selectedSet.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={'cat__item' + (on ? ' is-on' : '')}
                  onClick={() => toggle(c.id)}
                >
                  <span className="cat__box">{on ? '\u2713' : ''}</span>
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="cat__done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
