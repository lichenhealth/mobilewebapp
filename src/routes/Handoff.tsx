import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { setVoiceOn, setWakeAlways } from '../lib/voice';

/** /handoff?c=<code>&to=<path> — the browser side of "open in Safari, still
 *  signed in" (2026-11-26). Trades the one-time code for a sign-in, switches
 *  voice on as asked, and lands on the same screen. */
export default function Handoff() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('Signing you in…');
  useEffect(() => {
    const to = sp.get('to') ?? '/home';
    const safeTo = to.startsWith('/') && !to.startsWith('//') ? to : '/home';
    const finish = () => {
      if (sp.get('voice') === '1') setVoiceOn(true);
      if (sp.get('wake') === '1') setWakeAlways(true);
      navigate(safeTo, { replace: true });
    };
    void (async () => {
      const { data } = await supabase.functions.invoke('voice-handoff', { body: { mode: 'claim', code: sp.get('c') ?? '' } });
      if (data?.token_hash) {
        const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.token_hash });
        if (!error) { finish(); return; }
      }
      // An already-signed-in browser just carries on.
      const { data: s } = await supabase.auth.getSession();
      if (s.session) { finish(); return; }
      setMsg('That link expired. Sign in once here and you’ll stay signed in.');
      window.setTimeout(() => navigate(`/login?next=${encodeURIComponent(safeTo)}`, { replace: true }), 1800);
    })();
  }, [sp, navigate]);
  return <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--ink-muted)' }}>{msg}</div>;
}
