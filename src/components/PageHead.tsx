import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from './Icon';
import './PageHead.css';

/** THE NON-SECTION HEADER (founder 2026-10-21, from the room drive's "← Back
 *  to the room" chip: "drive needs to have the back button and the hamburger
 *  upper left, lets sunset back to the room and other text that does this on
 *  mobile especially … design audit the entire platform and update for
 *  consistency"): a non-section screen wears TWO icon circles upper-left —
 *  ☰ (the menu, via the same shell event the chat thread uses; hidden at
 *  ≥1024px where the docked rail stands, and for signed-out visitors, who
 *  have no menu) and ← (back). The worded chip survives ONLY where its words
 *  are load-bearing: scope escapes (ScopeBack's "← Back to Veterans" + clear
 *  filter are two distinct acts), Compose's popup-close, and a builder's
 *  mode exit. A named destination keeps its MEANING here — the caller passes
 *  it as `onBack` — only the words retire. */
export function PageHead({ onBack, fallback = '/home', menu = false }: {
  /** Where ← goes. Default: history-back, `fallback` on a cold landing. */
  onBack?: () => void;
  fallback?: string;
  /** ☰ renders ONLY on TopBar-less screens (the room drive) — everywhere
   *  else the TopBar above already carries the hamburger, and two ☰ on one
   *  screen is the one-back mistake in a new hat. */
  menu?: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const back = onBack ?? (() => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallback);
  });
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
