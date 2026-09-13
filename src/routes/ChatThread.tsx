import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChatConversation from '../components/ChatConversation';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import './ChatThread.css';

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();

  /** A CONCIERGE ROOM ISN'T CHAT (founder 2026-09-13: "it isn't chat, it's
   *  concierge with chat skinned in") — a care room reached by link or bell
   *  lands in Concierge's own Chat tab, where it lives, not in the chat
   *  shell (whose inbox deliberately excludes care rooms, so the desktop
   *  split view would show it beside a list it isn't in).
   *  undefined = still checking, null = an ordinary chat. */
  const [careDest, setCareDest] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!id || !user?.id) return;
    let live = true;
    void supabase.from('chats').select('kind, patient_id').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const c = data as { kind?: string; patient_id?: string | null } | null;
        if (c?.kind === 'care_team') {
          setCareDest(c.patient_id && c.patient_id !== user.id
            ? `/concierge/client/${c.patient_id}/chat`
            : '/concierge/chat');
        } else {
          setCareDest(null);
        }
      });
    return () => { live = false; };
  }, [id, user?.id]);
  useEffect(() => {
    if (careDest) navigate(careDest, { replace: true });
  }, [careDest, navigate]);

  /** THIS ROUTE IS THE PHONE'S (founder 2026-08-15, "chat layout is wonky"):
   *  `.thread` is a fixed, viewport-centred 430px takeover — right on a
   *  phone, wrong beside a sidebar, where it floats a phone column through
   *  the middle of the page and lines up with nothing. Desktop has its own
   *  chat: the split view. So land there instead, carrying the way back, and
   *  leave this route to the width it was drawn for. */
  useEffect(() => {
    if (!id) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    // WATCH the query, never sample it once: a cold load can run this effect
    // before layout has a width to report, and a window that grows past the
    // breakpoint later deserves the same answer as one that started there.
    const go = () => {
      if (!mq.matches) return;
      // Hold the split-view hop until we know this isn't a Concierge room —
      // a care room redirects to Concierge instead (above), and racing both
      // navigations lands on whichever resolved last.
      if (careDest !== null) return;
      const from = params.get('from');
      const about = params.get('about');
      navigate(`/chat?open=${id}${from ? `&from=${encodeURIComponent(from)}` : ''}${about ? `&about=${encodeURIComponent(about)}` : ''}`, { replace: true });
    };
    go();
    mq.addEventListener('change', go);
    return () => mq.removeEventListener('change', go);
  }, [id, params, navigate, careDest]);

  /** BACK MEANS WHERE YOU CAME FROM (founder 2026-08-15): a course's cohort
   *  chat used to dump you in the main inbox, because this route always went
   *  to `/chat`. Same doctrine as ScopeBack and TopBar's back — an explicit
   *  `?from=` wins (it survives a refresh, so a shared link still knows its
   *  way home), otherwise step back through history, and only a cold landing
   *  with nothing behind it falls through to the inbox. */
  function back() {
    const from = params.get('from');
    if (from && from.startsWith('/')) { navigate(from); return; }
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/chat');
  }

  return (
    <div className="thread">
      <ChatConversation chatId={id} me={user?.id ?? ''} onBack={back} />
    </div>
  );
}
