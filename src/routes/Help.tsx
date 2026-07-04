import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ensureHelpChat } from '../lib/chatApi';
import './Placeholder.css';

/** /help — opens (find-or-create) the member's Help room with the Lichen
 *  support account and drops straight into the chat thread. */
export default function Help() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const chatId = await ensureHelpChat();
        if (alive) navigate(`/chat/${chatId}`, { replace: true });
      } catch (e) {
        // Supabase RPC errors are plain objects with .message, not Error instances.
        const msg = e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
        if (alive) setError(msg);
      }
    })();
    return () => { alive = false; };
  }, [navigate]);

  return (
    <div className="placeholder">
      <div className="placeholder__mark" aria-hidden="true">
        <Icon name="info" size={28} strokeWidth={1.3} />
      </div>
      <p className="eyebrow">Lichen · Help</p>
      {error ? (
        <>
          <p className="placeholder__body">We couldn't open your help chat right now.</p>
          <p className="placeholder__hint">
            {error} — you can always email{' '}
            <a href="mailto:connect@lichen.health">connect@lichen.health</a>.
          </p>
        </>
      ) : (
        <p className="placeholder__body">Opening your help chat…</p>
      )}
    </div>
  );
}
