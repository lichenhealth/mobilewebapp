import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { MyceliumMark } from './MyceliumMark';
import './WeaveMark.css';

/** The 1-click web gesture: the mycelium mark as a toggle, shown beside an
 *  entity's name wherever content surfaces one. On = in your web (peach).
 *  Pure membership — no endorsement, invisible to the entity (weaving is
 *  silent by design; trust stays the shield in the engagement row). */
export function WeaveMark({
  on,
  onToggle,
  entityName,
  size = 22,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  /** For the accessible label: "Weave Tango into your web" */
  entityName: string;
  size?: number;
}) {
  const [active, setActive] = useState(on);
  // Follow the parent when it holds real state (e.g. trusting auto-weaves,
  // so a directory's shield tap must light the mark beside it).
  useEffect(() => { setActive(on); }, [on]);

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    const next = !active;
    setActive(next);
    onToggle(next);
  };

  return (
    <button
      className={'weave-mark' + (active ? ' is-on' : '')}
      onClick={toggle}
      aria-pressed={active}
      aria-label={active
        ? `${entityName} is in your web — remove`
        : `Weave ${entityName} into your web`}
      title={active ? 'In your web' : 'Weave into your web'}
    >
      <MyceliumMark size={size} label="" />
    </button>
  );
}
