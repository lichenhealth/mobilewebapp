import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { postToAssistantFeed } from '../lib/assistantFeedApi';
import type { FeedPost } from '../lib/postsApi';
import './ShareToClaudeSheet.css';

/** "Share to Claude": the post lands in your feed with it, and you can add
 *  context before it goes — founder, 2026-08-09. */
export default function ShareToClaudeSheet({ post, onClose }: { post: FeedPost | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  if (!post) return null;
  const title = post.title || post.body.slice(0, 80);

  async function send() {
    if (sending) return;
    setSending(true);
    try {
      await postToAssistantFeed(note.trim() || `I wanted to share this with you: "${title}"`, post!.id);
      onClose();
      navigate('/assistant/feed');
    } catch (e) {
      console.error(e);
      setSending(false);
    }
  }

  return (
    <div className="sharesheet__scrim" onClick={onClose}>
      <div className="sharesheet" onClick={(e) => e.stopPropagation()}>
        <header className="sharesheet__head">
          <h2>Share to Claude</h2>
          <button onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <p className="sharesheet__ref">{title}</p>
        <textarea
          className="sharesheet__note"
          autoFocus
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add context (optional) — what would you like Claude to know about this?"
        />
        <button className="btn btn-primary sharesheet__send" onClick={() => void send()} disabled={sending}>
          {sending ? 'Sending…' : 'Share'}
        </button>
      </div>
    </div>
  );
}
