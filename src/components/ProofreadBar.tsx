// The quiet line under a writing box that offers Gmail-style fixes
// (founder 2026-11-19). It checks by itself a moment after the member stops
// typing, shows each mistake as a chip ("teh → the"), and changes nothing
// until they tap — one chip, or "Fix all". Silent when the writing is clean,
// when the box is short, or when the 'writing' AI switch is off.
import { useEffect, useRef, useState } from 'react';
import { applySuggestion, proofread, type Suggestion } from '../lib/proofread';
import { aiDoorOn } from './AssistantDoor';
import './ProofreadBar.css';

export default function ProofreadBar({ text, onApply, minLength = 15, delay = 2200 }: {
  text: string;
  onApply: (next: string) => void;
  minLength?: number;
  delay?: number;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [hidden, setHidden] = useState(false);
  const lastChecked = useRef('');
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    // Suggestions whose words are gone (they typed over them) step aside at once.
    setItems((cur) => cur.filter((s) => text.includes(s.original)));
    if (!aiDoorOn('writing')) return;
    const t = text.trim();
    if (t.length < minLength || text === lastChecked.current) return;
    const timer = window.setTimeout(async () => {
      const asked = textRef.current;
      lastChecked.current = asked;
      const got = await proofread(asked);
      // Only show what still fits the text on screen.
      if (textRef.current !== asked) return;
      setItems(got.filter((s) => asked.includes(s.original)));
      setHidden(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [text, minLength, delay]);

  if (hidden || !items.length) return null;

  const take = (s: Suggestion) => {
    const next = applySuggestion(textRef.current, s);
    lastChecked.current = next;   // a taken fix is not a reason to re-check
    setItems((cur) => cur.filter((x) => x !== s && next.includes(x.original)));
    onApply(next);
  };
  const takeAll = () => {
    let next = textRef.current;
    for (const s of items) next = applySuggestion(next, s);
    lastChecked.current = next;
    setItems([]);
    onApply(next);
  };

  return (
    <div className="proof" role="group" aria-label="Spelling and grammar suggestions">
      <span className="proof__lead">{items.length === 1 ? '1 suggestion' : `${items.length} suggestions`}</span>
      {items.map((s, i) => (
        <button key={i} type="button" className="proof__chip" onClick={() => take(s)}
          data-tip={s.note || s.kind} aria-label={`Change “${s.original}” to “${s.replacement}”`}>
          <s className="proof__from">{s.original}</s>
          <span className="proof__arrow" aria-hidden>→</span>
          <span className="proof__to">{s.replacement || '(remove)'}</span>
        </button>
      ))}
      {items.length > 1 && <button type="button" className="proof__all" onClick={takeAll}>Fix all</button>}
      <button type="button" className="proof__x" onClick={() => setHidden(true)} aria-label="Hide suggestions">×</button>
    </div>
  );
}
