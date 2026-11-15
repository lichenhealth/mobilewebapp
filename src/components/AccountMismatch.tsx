import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

/** A notification email's link carries ?for=<recipient id>. When the browser is
 *  signed into a DIFFERENT Lichen account, say so plainly and offer the way to
 *  the right one (founder 2026-11-15: a booking email opened in a browser still
 *  signed into an old test account landed on that account's onboarding).
 *  The hint survives the gate's redirects in sessionStorage for this tab. */
const KEY = 'lichen.linkFor';
const UUID = /^[0-9a-f-]{36}$/i;

export default function AccountMismatch() {
  const { user } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [hint, setHint] = useState<{ id: string; path: string } | null>(() => {
    try { const raw = sessionStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });

  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const f = q.get('for');
    if (!f || !UUID.test(f)) return;
    q.delete('for');
    const rest = q.toString();
    const path = loc.pathname + (rest ? `?${rest}` : '') + loc.hash;
    const h = { id: f, path };
    setHint(h);
    try { sessionStorage.setItem(KEY, JSON.stringify(h)); } catch { /* fine */ }
    nav(path, { replace: true });
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || !hint) return null;
  if (user.id === hint.id) {
    try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
    return null;
  }

  const switchAccount = async () => {
    try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
    await supabase.auth.signOut({ scope: 'local' });
    nav(`/login?next=${encodeURIComponent(hint.path)}`, { replace: true });
  };
  const dismiss = () => { try { sessionStorage.removeItem(KEY); } catch { /* fine */ } setHint(null); };

  return (
    <div className="acctmis" role="alert">
      <p>
        That link was sent to a different Lichen account. You&rsquo;re signed in here as{' '}
        <strong>{user.email ?? 'another account'}</strong>.
      </p>
      <div className="acctmis__row">
        <button type="button" className="btn btn-primary acctmis__btn" onClick={switchAccount}>Sign in to the right account</button>
        <button type="button" className="acctmis__x" onClick={dismiss}>Stay here</button>
      </div>
    </div>
  );
}
