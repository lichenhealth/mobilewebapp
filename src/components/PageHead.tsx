import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from './Icon';
import { useTopBackFor, useTopBarMounted } from '../lib/topBack';
import './PageHead.css';

/** THE NON-SECTION BACK (founder 2026-10-21, two passes the same day: first
 *  "lets sunset back to the room and other text that does this" — worded
 *  chips became this component's ← circle — then, from a course page whose
 *  arrow sat in the body: "didn't we decide to have it next to the hamburger
 *  menu overall as a rule for the entire platform?"): a screen mounts
 *  PageHead with its back (a NAMED destination keeps its meaning via
 *  `onBack`), and the arrow renders beside the ☰ in the TopBar — the same
 *  slot section screens always had — via the topBack broadcast. Only on a
 *  TopBar-LESS screen (guest pages, full-bleed) does PageHead draw its own
 *  circles here in the body, with ☰ via the `menu` prop. */
export function PageHead({ onBack, fallback = '/home', menu = false }: {
  /** Where ← goes. Default: history-back, `fallback` on a cold landing. */
  onBack?: () => void;
  fallback?: string;
  /** ☰ renders ONLY on TopBar-less screens — everywhere else the TopBar
   *  carries the hamburger, and two ☰ is the one-back mistake in a new hat. */
  menu?: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const back = onBack ?? (() => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallback);
  });
  useTopBackFor(back);
  const topBarUp = useTopBarMounted();
  // The TopBar is standing — the arrow renders up there, nothing here.
  if (topBarUp) return null;
  return (
    <div className="pagehead">
      {menu && user && (
        <button
          className="pagehead__btn pagehead__btn--menu"
          aria-label="Open menu"
          onClick={() => window.dispatchEvent(new Event('lichen:open-menu'))}
        >
          <Icon name="menu" size={18} />
        </button>
      )}
      <button className="pagehead__btn" aria-label="Back" onClick={back}>
        <Icon name="arrow-left" size={18} />
      </button>
    </div>
  );
}
