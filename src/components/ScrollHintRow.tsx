import { ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './ScrollHintRow.css';

/** Horizontal-scroll wrapper with an honesty chip: when content continues
 *  past the right edge, a chevron floats there — rows should never look
 *  merely cut off. Tapping it nudges the row along; it disappears at the
 *  end. Pass the row's own classes via className (they land on the inner
 *  scroller so existing padding/gap CSS keeps applying). */
export function ScrollHintRow({ className, role, ariaLabel, children }: {
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollWidth - el.scrollLeft - el.clientWidth > 8);
  };

  // No deps: re-measure after every render so chip/filter changes are caught.
  useEffect(update);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);

  return (
    <div className="scrollrow">
      <div className={className} ref={ref} role={role} aria-label={ariaLabel}>{children}</div>
      {more && (
        <button
          className="scrollrow__hint"
          aria-label="Scroll for more"
          onClick={() => ref.current?.scrollBy({ left: 180, behavior: 'smooth' })}
        >
          <Icon name="chevron-right" size={13} />
        </button>
      )}
    </div>
  );
}
