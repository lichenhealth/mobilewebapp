import { useEffect, useRef } from 'react';

// Cloudflare Turnstile — the bot bouncer (founder 2026-07-28). Invisible to
// humans, poison to signup bots. DORMANT until SITE_KEY is set: the widget
// renders nothing and auth calls pass no token, so nothing changes until the
// founder's Cloudflare keys exist AND the Supabase dashboard toggle is on.
// The site key is public by design (like the Mapbox pk / Supabase anon key).
export const TURNSTILE_SITE_KEY = '';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        theme?: string;
      }) => string;
      remove: (id: string) => void;
    };
  }
}

export default function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let widgetId: string | undefined;
    let live = true;
    const render = () => {
      if (!live || !window.turnstile || !box.current) return;
      widgetId = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => onToken(t),
        'expired-callback': () => onToken(null),
        theme: 'light',
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { live = false; if (widgetId) window.turnstile?.remove(widgetId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="turnstile-box" />;
}
