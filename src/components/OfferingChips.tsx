import type { OfferingMeta } from '../lib/collectionsApi';
import './OfferingChips.css';

/** The legible "offering" of a course/path, as small chips: level · format ·
 *  length · price · who-it's-for. Falls back to lesson count for length. */
export default function OfferingChips({ meta, lessonCount, itemWord = 'lesson' }: { meta: OfferingMeta; lessonCount?: number; itemWord?: string }) {
  const chips: { key: string; label: string }[] = [];
  if (meta.level) chips.push({ key: 'level', label: meta.level });
  if (meta.format) chips.push({ key: 'format', label: meta.format });
  if (meta.length) chips.push({ key: 'length', label: meta.length });
  else if (lessonCount != null) chips.push({ key: 'length', label: `${lessonCount} ${itemWord}${lessonCount === 1 ? '' : 's'}` });
  if (meta.price) chips.push({ key: 'price', label: meta.price });
  if (meta.forWhom) chips.push({ key: 'for', label: `For ${meta.forWhom}` });
  if (chips.length === 0) return null;
  return (
    <div className="offer-chips">
      {chips.map((c) => <span key={c.key} className={`offer-chip offer-chip--${c.key}`}>{c.label}</span>)}
    </div>
  );
}
