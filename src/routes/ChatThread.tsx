import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChatConversation from '../components/ChatConversation';
import { useAuth } from '../auth/AuthProvider';
import './ChatThread.css';

export default function ChatThread() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();

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
