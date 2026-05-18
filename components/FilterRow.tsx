import { useState } from 'react';
import './FilterRow.css';

export interface FilterRowProps {
  options: string[];
  value?: string;
  onChange?: (v: string) => void;
}

export default function FilterRow({ options, value, onChange }: FilterRowProps) {
  const [internal, setInternal] = useState(value ?? options[0]);
  const active = value ?? internal;
  const set = (v: string) => {
    if (!value) setInternal(v);
    onChange?.(v);
  };

  return (
    <div className="filter-row h-scroll" role="tablist">
      {options.map((opt) => {
        const isActive = opt === active;
        return (
          <button
            key={opt}
            role="tab"
            aria-selected={isActive}
            className={'filter-row__tab' + (isActive ? ' is-active' : '')}
            onClick={() => set(opt)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
