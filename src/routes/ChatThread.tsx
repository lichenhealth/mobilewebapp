import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChatConversation from '../components/ChatConversation';
import { useAuth } from '../auth/AuthProvider';
import './ChatThread.css';

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();

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
      const from = params.get('from');
      const about = params.get('about');
      navigate(`/chat?open=${id}${from ? `&from=${encodeURIComponent(from)}` : ''}${about ? `&about=${encodeURIComponent(about)}` : ''}`, { replace: true });
    };
    go();
    mq.addEventListener('change', go);
    return () => mq.removeEventListener('change', go);
  }, [id, params, navigate]);

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
