import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { COMPANION_NAME, type CompanionMsg } from '../lib/companion';
import './BrainCompanion.css';

/** THE BRAIN THAT FOLLOWS YOU (founder 2026-11-27: "your brain should just
 *  be there with you everywhere and at all times… I'm in the Thanksgiving
 *  recipe and I want to tell the brain to make edits to my shopping list…
 *  it just needs to follow us around the platform"; she chose the panel
 *  STAYS OPEN as she moves). One brain circle on every screen; a tap opens
 *  a panel — a side panel on a computer, a sheet on a phone — holding the
 *  real conversation screen in a same-origin frame that stays mounted while
 *  the main app changes underneath it. Each send carries the page the member
 *  is on (assistantFeedApi reads it through companion.ts), and any door the
 *  brain hands out opens in the main window, not the panel. */

const OPEN_KEY = 'lichen.brainOpen';
const AT_KEY = 'lichen.companionAt';
const FRESH = '/assistant/feed?thread=general&convo=new';
const GAP_MS = 6 * 3600 * 1000;   // CONVO_GAP_MS — a conversation older than this starts fresh

function startUrl(): string {
  try {
    const v = JSON.parse(localStorage.getItem(AT_KEY) ?? 'null') as { url?: string; at?: number } | null;
    if (v?.url?.startsWith('/assistant') && v.at && Date.now() - v.at < GAP_MS) return v.url;
  } catch { /* ignore */ }
  return FRESH;
}

export default function BrainCompanion() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } });
  // The frame mounts on first open and then stays mounted (hidden when shut),
  // so the conversation is still there the next time.
  const [src, setSrc] = useState<string | null>(() => (open ? startUrl() : null));
  const [frameKey, setFrameKey] = useState(0);
  const at = useRef<string>(src ?? FRESH);

  useEffect(() => { try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* ignore */ } }, [open]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as CompanionMsg | null;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'lichen:navigate' && typeof m.path === 'string' && m.path.startsWith('/')) navigate(m.path);
      if (m.type === 'lichen:companion-at' && typeof m.url === 'string') {
        at.current = m.url;
        try { localStorage.setItem(AT_KEY, JSON.stringify({ url: m.url, at: Date.now() })); } catch { /* ignore */ }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate]);

  // A computer makes room for the side panel instead of covering the page.
  const onBrainScreen = pathname.startsWith('/assistant');
  const showing = open && !onBrainScreen;
  useEffect(() => {
    document.body.classList.toggle('has-brain-panel', showing);
    return () => document.body.classList.remove('has-brain-panel');
  }, [showing]);

  // The brain's own screens already ARE the brain — no second one on top.
  if (onBrainScreen) return null;

  const openPanel = () => { if (!src) { const u = startUrl(); setSrc(u); at.current = u; } setOpen(true); };
  const fresh = () => { setSrc(FRESH); at.current = FRESH; setFrameKey((k) => k + 1); };
  const expand = () => { setOpen(false); navigate(at.current || FRESH); };
  const chatThread = /^\/chat\/[^/]+$/.test(pathname);

  return (
    <>
      {!open && (
        <button type="button" className={'brainc__fab' + (chatThread ? ' brainc__fab--high' : '')}
          onClick={openPanel} aria-label="Talk with your brain" title="Your brain — ask or do anything, from here">
          <Icon name="brain" size={22} />
        </button>
      )}
      {src && open && (
        // Phones: a tap anywhere above the sheet closes it (the conversation stays).
        <div className="brainc__veil" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
      {src && (
        <aside className={'brainc' + (open ? ' is-open' : '')} aria-label="Your brain" aria-hidden={!open}>
          <div className="brainc__head">
            <img className="brainc__face" src="/claude-avatar.svg" alt="" />
            <div className="brainc__who">
              <strong>Claude</strong>
              <span>Here with you on every page</span>
            </div>
            <button type="button" className="brainc__btn" onClick={fresh} title="New conversation" aria-label="New conversation">
              <Icon name="plus" size={16} />
            </button>
            <button type="button" className="brainc__btn" onClick={expand} title="Open full screen" aria-label="Open full screen">
              <Icon name="arrow-up" size={16} />
            </button>
            <button type="button" className="brainc__btn" onClick={() => setOpen(false)} title="Close — it stays here" aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>
          <iframe key={frameKey} className="brainc__frame" name={COMPANION_NAME} title="Your brain"
            src={src} allow="microphone; autoplay; clipboard-write" />
        </aside>
      )}
    </>
  );
}
