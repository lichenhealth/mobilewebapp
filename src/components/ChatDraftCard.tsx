import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import './KnockReply.css';

/** A Lichen message the assistant drafted (founder 2026-11-19: "is this true,
 *  re: chat messages?" — the brain said it couldn't send one). The model never
 *  sends to another person; the PERSON reads, edits and taps Send, which posts
 *  into their own direct chat with that member through their own session. */
export default function ChatDraftCard({ profileId, name, body }: { profileId: string; name: string; body: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState(body);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'dismissed'>('idle');
  const [chatId, setChatId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const first = name.split(' ')[0] || name;

  async function send() {
    if (!user || !text.trim()) return;
    setState('sending'); setErr('');
    try {
      const id = await ensureDirectChat(profileId);
      const { error } = await supabase.from('chat_messages').insert({ chat_id: id, sender_id: user.id, body: text.trim() });
      if (error) throw error;
      setChatId(id); setState('sent');
    } catch (e) { setState('idle'); setErr((e as Error).message || 'That didn’t go through.'); }
  }

  if (state === 'dismissed') return <p className="kreply__hint">Not sent.</p>;
  if (state === 'sent') return (
    <p className="kreply__done">Sent to {first} ✓ {chatId && (
      <button type="button" className="kreply__notnow" onClick={() => navigate(`/chat/${chatId}`)}>Open the chat ›</button>
    )}</p>
  );
  return (
    <div className="kreply kreply--open kreply--card">
      <p className="kreply__hint"><strong>Message to {name}</strong> · in your Lichen chat</p>
      <textarea className="kreply__box input" rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
        value={text} onChange={(e) => setText(e.target.value)} />
      {err && <p className="kreply__err">{err}</p>}
      <div className="kreply__acts">
        <span className="kreply__spacer" />
        <button type="button" className="kreply__notnow" onClick={() => setState('dismissed')}>Not now</button>
        <button type="button" className="btn btn-primary" disabled={state === 'sending' || !text.trim()} onClick={() => void send()}>
          {state === 'sending' ? 'Sending…' : `Send to ${first}`}
        </button>
      </div>
    </div>
  );
}
